import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { CommandRunner, type CommandRunOptions, type CommandRunResult } from '../electron/lib/commandRunner'
import { toBranchPilotError } from '../electron/lib/errors'
import { RepositoryService } from '../electron/lib/repositoryService'
import { SettingsStore } from '../electron/lib/settingsStore'

const tempRoots: string[] = []

describe('RepositoryService', () => {
  afterEach(() => {
    for (const root of tempRoots.splice(0)) {
      rmSync(root, { force: true, recursive: true })
    }
  })

  it('opens a repository and tracks staged/unstaged/untracked files', async () => {
    const repoPath = createTempRepository()
    const service = createService()

    writeFileSync(path.join(repoPath, 'tracked.txt'), 'changed\n')
    writeFileSync(path.join(repoPath, 'new.txt'), 'new\n')
    git(repoPath, ['add', 'tracked.txt'])

    const snapshot = await service.openRepository(repoPath)

    expect(realpathSync(snapshot.summary.rootPath)).toBe(realpathSync(repoPath))
    expect(snapshot.status.counts.staged).toBe(1)
    expect(snapshot.status.counts.untracked).toBe(1)
    expect(snapshot.status.changes.map((change) => change.path)).toContain('tracked.txt')
    expect(snapshot.status.changes.map((change) => change.path)).toContain('new.txt')
  })

  it('pins recent repositories and keeps pinned entries first', async () => {
    const firstRepoPath = createTempRepository()
    const secondRepoPath = createTempRepository()
    const firstRepoRoot = realpathSync(firstRepoPath)
    const secondRepoRoot = realpathSync(secondRepoPath)
    const service = createService()

    await service.openRepository(firstRepoPath)
    await service.openRepository(secondRepoPath)

    let recentRepositories = await service.setRepositoryPinned({
      repoPath: firstRepoPath,
      pinned: true
    })

    expect(recentRepositories[0]).toMatchObject({
      path: firstRepoRoot,
      pinned: true
    })
    expect(recentRepositories[1]).toMatchObject({
      path: secondRepoRoot,
      pinned: false
    })

    await service.openRepository(secondRepoPath)
    recentRepositories = await service.getRecentRepositories()

    expect(recentRepositories[0]).toMatchObject({
      path: firstRepoRoot,
      pinned: true
    })

    recentRepositories = await service.setRepositoryPinned({
      repoPath: firstRepoPath,
      pinned: false
    })

    expect(recentRepositories[0]).toMatchObject({
      path: secondRepoRoot,
      pinned: false
    })
    expect(recentRepositories[1]).toMatchObject({
      path: firstRepoRoot,
      pinned: false
    })
  })

  it('clones a repository by URL and opens the cloned checkout', async () => {
    const sourceRepoPath = createTempRepository()
    const targetParentPath = mkdtempSync(path.join(tmpdir(), 'branchpilot-clone-parent-'))
    tempRoots.push(targetParentPath)
    const service = createService()

    const snapshot = await service.cloneRepository({
      remoteUrl: sourceRepoPath,
      targetParentPath,
      targetName: 'cloned-project'
    })
    const targetPath = path.join(targetParentPath, 'cloned-project')

    expect(realpathSync(snapshot.summary.rootPath)).toBe(realpathSync(targetPath))
    expect(snapshot.summary.currentBranch).toBe('main')
    expect(readFileSync(path.join(targetPath, 'tracked.txt'), 'utf8')).toBe('initial\n')
    expect((await service.getRecentRepositories())[0]).toMatchObject({
      path: realpathSync(targetPath),
      name: 'cloned-project'
    })

    await expect(service.cloneRepository({
      remoteUrl: sourceRepoPath,
      targetParentPath,
      targetName: 'cloned-project'
    })).rejects.toMatchObject({ code: 'clone_target_exists' })
    await expect(service.cloneRepository({
      remoteUrl: sourceRepoPath,
      targetParentPath,
      targetName: '../unsafe'
    })).rejects.toMatchObject({ code: 'invalid_clone_target' })
  })

  it('builds a repository dashboard from recent repositories', async () => {
    const dirtyRepoPath = createTempRepository()
    const activeRepoPath = createTempRepository()
    const dirtyRepoRoot = realpathSync(dirtyRepoPath)
    const activeRepoRoot = realpathSync(activeRepoPath)
    const service = createService()

    git(dirtyRepoPath, ['switch', '--quiet', '-c', 'stale/topic'])
    writeFileSync(path.join(dirtyRepoPath, 'stale.txt'), 'stale branch\n')
    git(dirtyRepoPath, ['add', 'stale.txt'])
    gitWithEnv(dirtyRepoPath, ['commit', '-m', 'Old branch work'], {
      GIT_AUTHOR_DATE: '2024-01-01T00:00:00Z',
      GIT_COMMITTER_DATE: '2024-01-01T00:00:00Z'
    })
    git(dirtyRepoPath, ['switch', '--quiet', 'main'])
    writeFileSync(path.join(dirtyRepoPath, 'tracked.txt'), 'dirty\n')

    await service.openRepository(dirtyRepoPath)
    await service.openRepository(activeRepoPath)
    await service.setRepositoryPinned({
      repoPath: dirtyRepoPath,
      pinned: true
    })

    const dashboard = await service.getRepositoryDashboard(activeRepoPath)
    const dirtyRepo = dashboard.repositories.find((repo) => repo.path === dirtyRepoRoot)
    const activeRepo = dashboard.repositories.find((repo) => repo.path === activeRepoRoot)

    expect(dashboard.totals.repositories).toBe(2)
    expect(dashboard.totals.dirty).toBe(1)
    expect(dashboard.totals.staleBranches).toBe(1)
    expect(dirtyRepo).toMatchObject({
      pinned: true,
      state: 'dirty',
      changed: 1
    })
    expect(activeRepo).toMatchObject({
      active: true,
      state: 'clean'
    })
    expect(dashboard.staleBranches[0]).toMatchObject({
      repoPath: dirtyRepoRoot,
      repoName: path.basename(dirtyRepoRoot),
      name: 'stale/topic'
    })
    expect(dashboard.staleBranches[0].daysSinceCommit).toBeGreaterThan(30)
  })

  it('uses lightweight repository reads for dashboard scans', async () => {
    const repoPath = createTempRepository()
    const activeRepoPath = createTempRepository()
    const runner = new RecordingCommandRunner()
    const service = createService(runner)

    git(repoPath, ['switch', '--quiet', '-c', 'old/topic'])
    git(repoPath, ['config', 'branch.old/topic.description', 'Expensive dashboard detail'])
    gitWithEnv(repoPath, ['commit', '--allow-empty', '-m', 'Old topic work'], {
      GIT_AUTHOR_DATE: '2024-01-01T00:00:00Z',
      GIT_COMMITTER_DATE: '2024-01-01T00:00:00Z'
    })

    await service.openRepository(repoPath)
    await service.openRepository(activeRepoPath)

    runner.reset()
    const dashboard = await service.getRepositoryDashboard(activeRepoPath)
    const commandLines = runner.calls.map((call) => call.args.join(' '))

    expect(dashboard.totals.repositories).toBe(2)
    expect(commandLines.some((line) => line.startsWith('lfs '))).toBe(false)
    expect(commandLines.some((line) => line.startsWith('submodule '))).toBe(false)
    expect(commandLines.some((line) => line.startsWith('tag '))).toBe(false)
    expect(commandLines.some((line) => line.startsWith('worktree '))).toBe(false)
    expect(commandLines.some((line) => line.includes('branch.old/topic.description'))).toBe(false)
  })

  it('uses status-only snapshot refreshes after staging when a full snapshot is cached', async () => {
    const repoPath = createTempRepository()
    const runner = new RecordingCommandRunner()
    const service = createService(runner)
    const openedSnapshot = await service.openRepository(repoPath)

    writeFileSync(path.join(repoPath, 'new.txt'), 'new\n')

    runner.reset()
    const snapshot = await service.stageFile({
      repoPath,
      filePath: 'new.txt'
    })
    const commandLines = runner.calls.map((call) => call.args.join(' '))

    expect(snapshot.status.counts.staged).toBe(1)
    expect(snapshot.branches).toEqual(openedSnapshot.branches)
    expect(snapshot.tags).toEqual(openedSnapshot.tags)
    expect(snapshot.worktrees).toEqual(openedSnapshot.worktrees)
    expect(snapshot.submodules).toEqual(openedSnapshot.submodules)
    expect(snapshot.lfs).toEqual(openedSnapshot.lfs)
    expect(commandLines.some((line) => line.startsWith('lfs '))).toBe(false)
    expect(commandLines.some((line) => line.startsWith('submodule '))).toBe(false)
    expect(commandLines.some((line) => line.startsWith('tag '))).toBe(false)
    expect(commandLines.some((line) => line.startsWith('worktree '))).toBe(false)
  })

  it('commits staged changes with a multiline message', async () => {
    const repoPath = createTempRepository()
    const service = createService()

    writeFileSync(path.join(repoPath, 'tracked.txt'), 'changed\n')
    git(repoPath, ['add', 'tracked.txt'])

    const snapshot = await service.commit({
      repoPath,
      title: 'Update tracked file',
      description: 'Adds a second line of commit context.'
    })

    expect(snapshot.status.counts.staged).toBe(0)
    const subject = git(repoPath, ['log', '-1', '--pretty=%s'])
    expect(subject).toBe('Update tracked file')
  })

  it('amends the last commit with confirmation and a multiline message', async () => {
    const repoPath = createTempRepository()
    const service = createService()
    const originalHead = git(repoPath, ['rev-parse', 'HEAD'])

    await expect(service.amendCommit({
      repoPath,
      title: 'Blocked amend',
      description: '',
      confirmed: false
    })).rejects.toMatchObject({
      code: 'confirmation_required'
    })

    const snapshot = await service.amendCommit({
      repoPath,
      title: 'Amended initial commit',
      description: 'Keeps the tree and rewrites the commit message.',
      confirmed: true
    })

    expect(snapshot.status.counts.changed).toBe(0)
    expect(git(repoPath, ['rev-parse', 'HEAD'])).not.toBe(originalHead)
    expect(git(repoPath, ['log', '-1', '--pretty=%s'])).toBe('Amended initial commit')
    expect(git(repoPath, ['log', '-1', '--pretty=%b'])).toContain('Keeps the tree')
  })

  it('reverts a selected commit with confirmation', async () => {
    const repoPath = createTempRepository()
    const service = createService()

    writeFileSync(path.join(repoPath, 'tracked.txt'), 'changed for revert\n')
    git(repoPath, ['add', 'tracked.txt'])
    git(repoPath, ['commit', '-m', 'Change tracked file'])
    const commitToRevert = git(repoPath, ['rev-parse', 'HEAD'])

    await expect(service.revertCommit({
      repoPath,
      commitSha: commitToRevert,
      confirmed: false
    })).rejects.toMatchObject({
      code: 'confirmation_required'
    })

    const snapshot = await service.revertCommit({
      repoPath,
      commitSha: commitToRevert,
      confirmed: true
    })

    expect(snapshot.status.counts.changed).toBe(0)
    expect(readFileSync(path.join(repoPath, 'tracked.txt'), 'utf8')).toBe('initial\n')
    expect(git(repoPath, ['log', '-1', '--pretty=%s'])).toBe('Revert "Change tracked file"')
  })

  it('cherry-picks a selected commit with confirmation', async () => {
    const repoPath = createTempRepository()
    const service = createService()

    git(repoPath, ['switch', '--quiet', '-c', 'feature/pick'])
    writeFileSync(path.join(repoPath, 'picked.txt'), 'picked\n')
    git(repoPath, ['add', 'picked.txt'])
    git(repoPath, ['commit', '-m', 'Add picked file'])
    const commitToPick = git(repoPath, ['rev-parse', 'HEAD'])

    git(repoPath, ['switch', '--quiet', 'main'])

    await expect(service.cherryPickCommit({
      repoPath,
      commitSha: commitToPick,
      confirmed: false
    })).rejects.toMatchObject({
      code: 'confirmation_required'
    })

    const snapshot = await service.cherryPickCommit({
      repoPath,
      commitSha: commitToPick,
      confirmed: true
    })

    expect(snapshot.status.counts.changed).toBe(0)
    expect(readFileSync(path.join(repoPath, 'picked.txt'), 'utf8')).toBe('picked\n')
    expect(git(repoPath, ['log', '-1', '--pretty=%s'])).toBe('Add picked file')
  })

  it('stages and unstages individual hunks', async () => {
    const repoPath = createTempRepository()
    const service = createService()

    writeFileSync(path.join(repoPath, 'tracked.txt'), [
      'line 1',
      'line 2',
      'line 3',
      'line 4',
      'line 5',
      'line 6',
      'line 7',
      'line 8',
      'line 9',
      'line 10',
      'line 11',
      'line 12',
      ''
    ].join('\n'))
    git(repoPath, ['add', 'tracked.txt'])
    git(repoPath, ['commit', '-m', 'Expand tracked fixture'])

    writeFileSync(path.join(repoPath, 'tracked.txt'), [
      'line 1',
      'line 2 changed',
      'line 3',
      'line 4',
      'line 5',
      'line 6',
      'line 7',
      'line 8',
      'line 9',
      'line 10 changed',
      'line 11',
      'line 12',
      ''
    ].join('\n'))

    const unstagedDiff = await service.getDiff({ repoPath, filePath: 'tracked.txt', staged: false })
    expect(unstagedDiff.files[0].hunks).toHaveLength(2)

    await service.stageHunk({
      repoPath,
      filePath: 'tracked.txt',
      patch: unstagedDiff.files[0].hunks[0].patch
    })

    const cachedAfterStage = git(repoPath, ['diff', '--cached', '--', 'tracked.txt'])
    const unstagedAfterStage = git(repoPath, ['diff', '--', 'tracked.txt'])

    expect(cachedAfterStage).toContain('line 2 changed')
    expect(cachedAfterStage).not.toContain('line 10 changed')
    expect(unstagedAfterStage).toContain('line 10 changed')
    expect(unstagedAfterStage).not.toContain('line 2 changed')

    const stagedDiff = await service.getDiff({ repoPath, filePath: 'tracked.txt', staged: true })
    await service.unstageHunk({
      repoPath,
      filePath: 'tracked.txt',
      patch: stagedDiff.files[0].hunks[0].patch
    })

    expect(git(repoPath, ['diff', '--cached', '--', 'tracked.txt'])).toBe('')
    expect(git(repoPath, ['diff', '--', 'tracked.txt'])).toContain('line 2 changed')
    expect(git(repoPath, ['diff', '--', 'tracked.txt'])).toContain('line 10 changed')
  })

  it('can ignore whitespace-only changes when previewing a diff', async () => {
    const repoPath = createTempRepository()
    const service = createService()

    writeFileSync(path.join(repoPath, 'tracked.txt'), 'initial  \n')

    const defaultDiff = await service.getDiff({ repoPath, filePath: 'tracked.txt', staged: false })
    const whitespaceIgnoredDiff = await service.getDiff({
      repoPath,
      filePath: 'tracked.txt',
      staged: false,
      ignoreWhitespace: true
    })

    expect(defaultDiff.text).toContain('+initial  ')
    expect(whitespaceIgnoredDiff.text).toBe('')
    expect(whitespaceIgnoredDiff.files).toEqual([])
  })

  it('reports stale hunk patches as readable Git patch failures', async () => {
    const repoPath = createTempRepository()
    const service = createService()

    writeFileSync(path.join(repoPath, 'tracked.txt'), 'initial\nchanged\n')
    const diff = await service.getDiff({ repoPath, filePath: 'tracked.txt', staged: false })
    const patch = diff.files[0].hunks[0].patch

    await service.stageHunk({ repoPath, filePath: 'tracked.txt', patch })

    try {
      await service.stageHunk({ repoPath, filePath: 'tracked.txt', patch })
      throw new Error('Expected stale hunk patch to fail')
    } catch (error) {
      expect(toBranchPilotError(error).code).toBe('git_patch_failed')
    }
  })

  it('truncates large untracked file previews without treating them as parsed diffs', async () => {
    const repoPath = createTempRepository()
    const service = createService()

    writeFileSync(path.join(repoPath, 'large-untracked.txt'), `${'x'.repeat(400_000)}\n`)

    const diff = await service.getDiff({
      repoPath,
      filePath: 'large-untracked.txt',
      staged: false
    })

    expect(diff.tooLarge).toBe(true)
    expect(diff.binary).toBe(false)
    expect(diff.text.length).toBeLessThan(360_000)
    expect(diff.files).toEqual([])
  })

  it('truncates large tracked file diffs before parsing', async () => {
    const repoPath = createTempRepository()
    const service = createService()

    writeFileSync(path.join(repoPath, 'tracked.txt'), `${'x'.repeat(400_000)}\n`)

    const diff = await service.getDiff({
      repoPath,
      filePath: 'tracked.txt',
      staged: false
    })

    expect(diff.tooLarge).toBe(true)
    expect(diff.binary).toBe(false)
    expect(diff.text.length).toBeLessThanOrEqual(350_000)
    expect(diff.files).toEqual([])
  })

  it('rejects absolute and parent-directory file paths before file Git actions', async () => {
    const repoPath = createTempRepository()
    const service = createService()

    await expect(service.getDiff({
      repoPath,
      filePath: '../tracked.txt',
      staged: false
    })).rejects.toMatchObject({ code: 'invalid_path' })

    await expect(service.stageFile({
      repoPath,
      filePath: path.join(repoPath, 'tracked.txt')
    })).rejects.toMatchObject({ code: 'invalid_path' })
  })

  it('exports and applies a working tree patch with confirmation', async () => {
    const repoPath = createTempRepository()
    const patchRoot = mkdtempSync(path.join(tmpdir(), 'branchpilot-patch-test-'))
    tempRoots.push(patchRoot)
    const patchPath = path.join(patchRoot, 'tracked-change.patch')
    const service = createService()

    writeFileSync(path.join(repoPath, 'tracked.txt'), 'initial\npatched\n')

    const exported = await service.exportPatch({
      repoPath,
      scope: 'working-tree',
      outputPath: patchPath
    })

    expect(exported).toMatchObject({
      path: patchPath,
      fileName: 'tracked-change.patch',
      scope: 'working-tree'
    })
    expect(exported.bytes).toBeGreaterThan(0)
    expect(readFileSync(patchPath, 'utf8')).toContain('+patched')

    git(repoPath, ['restore', '--', 'tracked.txt'])

    await expect(service.applyPatch({
      repoPath,
      patchPath,
      confirmed: false
    })).rejects.toMatchObject({
      code: 'confirmation_required'
    })

    await expect(service.applyPatch({
      repoPath,
      patchPath: path.join(patchRoot, 'missing.patch'),
      confirmed: true
    })).rejects.toMatchObject({
      code: 'patch_not_found'
    })

    const snapshot = await service.applyPatch({
      repoPath,
      patchPath,
      confirmed: true
    })

    expect(snapshot.status.counts.changed).toBe(1)
    expect(readFileSync(path.join(repoPath, 'tracked.txt'), 'utf8')).toBe('initial\npatched\n')
  })

  it('creates, lists, applies, and drops stashes with untracked files', async () => {
    const repoPath = createTempRepository()
    const service = createService()

    writeFileSync(path.join(repoPath, 'tracked.txt'), 'stashed tracked\n')
    writeFileSync(path.join(repoPath, 'untracked.txt'), 'stashed untracked\n')

    const stashed = await service.createStash({
      repoPath,
      message: 'Save WIP fixture',
      includeUntracked: true
    })

    expect(stashed.status.counts.changed).toBe(0)
    expect(git(repoPath, ['status', '--porcelain'])).toBe('')

    const stashes = await service.listStashes(repoPath)
    expect(stashes[0].ref).toBe('stash@{0}')
    expect(stashes[0].message).toContain('Save WIP fixture')

    const applied = await service.applyStash({ repoPath, stashRef: stashes[0].ref })
    expect(applied.status.counts.changed).toBe(2)
    expect(readFileSync(path.join(repoPath, 'tracked.txt'), 'utf8')).toBe('stashed tracked\n')
    expect(readFileSync(path.join(repoPath, 'untracked.txt'), 'utf8')).toBe('stashed untracked\n')

    await expect(service.dropStash({
      repoPath,
      stashRef: stashes[0].ref,
      confirmed: false
    })).rejects.toMatchObject({ code: 'confirmation_required' })

    await service.dropStash({
      repoPath,
      stashRef: stashes[0].ref,
      confirmed: true
    })

    expect(await service.listStashes(repoPath)).toEqual([])
  })

  it('reports conflicts when applying a stash over incompatible work', async () => {
    const repoPath = createTempRepository()
    const service = createService()

    writeFileSync(path.join(repoPath, 'tracked.txt'), 'stashed\n')
    await service.createStash({
      repoPath,
      message: 'Conflicting stash',
      includeUntracked: true
    })

    writeFileSync(path.join(repoPath, 'tracked.txt'), 'committed local\n')
    git(repoPath, ['add', 'tracked.txt'])
    git(repoPath, ['commit', '-m', 'Conflicting local change'])

    try {
      await service.applyStash({ repoPath, stashRef: 'stash@{0}' })
      throw new Error('Expected stash apply to conflict')
    } catch (error) {
      expect(toBranchPilotError(error).code).toBe('git_conflict')
    }
  })

  it('reads commit history, commit details, and commit file diffs', async () => {
    const repoPath = createTempRepository()
    const service = createService()

    writeFileSync(path.join(repoPath, 'tracked.txt'), 'history change\n')
    git(repoPath, ['add', 'tracked.txt'])
    git(repoPath, ['commit', '-m', 'Update history fixture'])
    git(repoPath, ['branch', 'feature/history'])

    const history = await service.getHistory(repoPath)
    expect(history[0]).toMatchObject({
      subject: 'Update history fixture',
      authorName: 'BranchPilot Test',
      authorEmail: 'branchpilot@example.com'
    })

    const details = await service.getCommitDetails({
      repoPath,
      commitSha: history[0].sha
    })
    expect(details.files).toEqual([
      {
        path: 'tracked.txt',
        rawStatus: 'M',
        status: 'modified'
      }
    ])
    expect(details.containingBranches).toEqual(expect.arrayContaining(['main', 'feature/history']))

    const diff = await service.getCommitFileDiff({
      repoPath,
      commitSha: history[0].sha,
      filePath: 'tracked.txt'
    })
    expect(diff.text).toContain('+history change')
  })

  it('reads and updates repository-local Git identity', async () => {
    const repoPath = createTempRepository()
    const service = createService()

    const before = await service.getGitConfig(repoPath)
    expect(before.localUserName).toBe('BranchPilot Test')
    expect(before.localUserEmail).toBe('branchpilot@example.com')
    expect(before.defaultBranch).toBe('main')
    expect(before.defaultBranchSource).toBe('local')

    const after = await service.setLocalGitIdentity({
      repoPath,
      name: 'BranchPilot Local',
      email: 'local@example.com'
    })

    expect(after.localUserName).toBe('BranchPilot Local')
    expect(after.localUserEmail).toBe('local@example.com')
    expect(git(repoPath, ['config', '--local', '--get', 'user.name'])).toBe('BranchPilot Local')
  })

  it('adds updates and removes remotes with confirmation', async () => {
    const repoPath = createTempRepository()
    const service = createService()
    const firstUrl = 'https://github.com/example/project.git'
    const secondUrl = 'git@github.com:example/project.git'

    expect((await service.getGitConfig(repoPath)).remotes).toEqual([])

    const added = await service.addRemote({
      repoPath,
      name: 'origin',
      url: firstUrl
    })

    expect(added.remotes).toEqual([
      {
        name: 'origin',
        fetchUrl: firstUrl,
        pushUrl: firstUrl
      }
    ])
    await expect(service.addRemote({
      repoPath,
      name: 'origin',
      url: firstUrl
    })).rejects.toMatchObject({ code: 'remote_exists' })

    const updated = await service.setRemoteUrl({
      repoPath,
      name: 'origin',
      url: secondUrl
    })

    expect(updated.remotes).toEqual([
      {
        name: 'origin',
        fetchUrl: secondUrl,
        pushUrl: secondUrl
      }
    ])
    git(repoPath, ['update-ref', 'refs/remotes/origin/trunk', 'HEAD'])
    git(repoPath, ['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/trunk'])
    expect(await service.getGitConfig(repoPath)).toMatchObject({
      defaultBranch: 'trunk',
      defaultBranchSource: 'remote',
      defaultBranchRemote: 'origin'
    })
    await expect(service.addRemote({
      repoPath,
      name: '-bad',
      url: firstUrl
    })).rejects.toMatchObject({ code: 'invalid_remote' })
    await expect(service.addRemote({
      repoPath,
      name: 'upstream',
      url: ''
    })).rejects.toMatchObject({ code: 'invalid_remote_url' })
    await expect(service.removeRemote({
      repoPath,
      name: 'origin',
      confirmed: false
    })).rejects.toMatchObject({ code: 'confirmation_required' })

    const removed = await service.removeRemote({
      repoPath,
      name: 'origin',
      confirmed: true
    })

    expect(removed.remotes).toEqual([])
    await expect(service.setRemoteUrl({
      repoPath,
      name: 'origin',
      url: firstUrl
    })).rejects.toMatchObject({ code: 'git_no_remote' })
  })

  it('lists and updates configured submodules', async () => {
    const repoPath = createTempRepository()
    const childRepoPath = createTempRepository()
    const service = createService()

    writeFileSync(path.join(childRepoPath, 'child.txt'), 'child\n')
    git(childRepoPath, ['add', 'child.txt'])
    git(childRepoPath, ['commit', '-m', 'Add child fixture'])
    git(repoPath, ['config', 'protocol.file.allow', 'always'])
    git(repoPath, ['-c', 'protocol.file.allow=always', 'submodule', 'add', childRepoPath, 'libs/child'])
    git(repoPath, ['commit', '-m', 'Add child submodule'])

    const snapshot = await service.openRepository(repoPath)
    expect(snapshot.submodules).toHaveLength(1)
    expect(snapshot.submodules[0]).toMatchObject({
      path: 'libs/child',
      absolutePath: path.join(realpathSync(repoPath), 'libs/child'),
      url: childRepoPath,
      status: 'initialized'
    })
    expect(snapshot.submodules[0].head).toMatch(/^[a-f0-9]{40}$/)

    git(repoPath, ['submodule', 'deinit', '-f', '--', 'libs/child'])
    expect((await service.listSubmodules(repoPath))[0]).toMatchObject({
      path: 'libs/child',
      status: 'uninitialized'
    })

    await expect(service.updateSubmodule({
      repoPath,
      path: 'libs/missing',
      init: true,
      recursive: false
    })).rejects.toMatchObject({
      code: 'submodule_not_found'
    })

    const updated = await service.updateSubmodule({
      repoPath,
      path: 'libs/child',
      init: true,
      recursive: false
    })

    expect(updated.submodules[0]).toMatchObject({
      path: 'libs/child',
      status: 'initialized'
    })
    expect(readFileSync(path.join(repoPath, 'libs/child/child.txt'), 'utf8')).toBe('child\n')
  })

  it('detects Git LFS patterns and reports missing git-lfs before pulling', async () => {
    const repoPath = createTempRepository()
    const service = createService()

    writeFileSync(path.join(repoPath, '.gitattributes'), [
      '# BranchPilot LFS fixture',
      '*.psd filter=lfs diff=lfs merge=lfs -text',
      'assets/*.zip filter=lfs diff=lfs merge=lfs -text',
      ''
    ].join('\n'))
    git(repoPath, ['add', '.gitattributes'])
    git(repoPath, ['commit', '-m', 'Configure LFS patterns'])

    const snapshot = await service.openRepository(repoPath)

    expect(snapshot.lfs.trackedPatterns).toEqual([
      {
        pattern: '*.psd',
        sourcePath: '.gitattributes',
        line: 2
      },
      {
        pattern: 'assets/*.zip',
        sourcePath: '.gitattributes',
        line: 3
      }
    ])
    expect(snapshot.lfs.fileCount).toBe(snapshot.lfs.files.length)

    const summary = await service.getGitLfsSummary(repoPath)
    expect(summary.trackedPatterns).toHaveLength(2)

    if (!summary.installed) {
      await expect(service.pullGitLfs(repoPath)).rejects.toMatchObject({
        code: 'git_lfs_missing'
      })
    }
  })

  it('detects and aborts a real merge conflict', async () => {
    const repoPath = createConflictedRepository()
    const service = createService()

    const conflicted = await service.openRepository(repoPath)
    expect(conflicted.status.merge.operation).toBe('merge')
    expect(conflicted.status.counts.conflicted).toBe(1)
    expect(conflicted.status.merge.files[0].path).toBe('conflict.txt')

    const aborted = await service.abortMergeOperation(repoPath)
    expect(aborted.status.merge.operation).toBe('none')
    expect(aborted.status.counts.conflicted).toBe(0)
  })

  it('resolves merge conflicts with ours and theirs file choices', async () => {
    const oursRepo = createConflictedRepository()
    const theirsRepo = createConflictedRepository()
    const service = createService()

    const ours = await service.acceptOurs({ repoPath: oursRepo, filePath: 'conflict.txt' })
    expect(ours.status.counts.conflicted).toBe(0)
    expect(readFileSync(path.join(oursRepo, 'conflict.txt'), 'utf8')).toBe('main\n')

    const theirs = await service.acceptTheirs({ repoPath: theirsRepo, filePath: 'conflict.txt' })
    expect(theirs.status.counts.conflicted).toBe(0)
    expect(readFileSync(path.join(theirsRepo, 'conflict.txt'), 'utf8')).toBe('feature\n')
  })

  it('merges a clean local branch into the current branch', async () => {
    const repoPath = createTempRepository()
    const service = createService()

    git(repoPath, ['switch', '--quiet', '-c', 'feature/clean-merge'])
    writeFileSync(path.join(repoPath, 'feature.txt'), 'feature\n')
    git(repoPath, ['add', 'feature.txt'])
    git(repoPath, ['commit', '-m', 'Feature clean merge'])
    git(repoPath, ['switch', '--quiet', 'main'])

    const merged = await service.mergeBranch({
      repoPath,
      branchName: 'feature/clean-merge'
    })

    expect(merged.status.merge.operation).toBe('none')
    expect(merged.status.counts.changed).toBe(0)
    expect(readFileSync(path.join(repoPath, 'feature.txt'), 'utf8')).toBe('feature\n')
  })

  it('returns a refreshed snapshot when merge creates conflicts', async () => {
    const repoPath = createMergeConflictReadyRepository()
    const service = createService()

    const conflicted = await service.mergeBranch({
      repoPath,
      branchName: 'feature/conflict'
    })

    expect(conflicted.status.merge.operation).toBe('merge')
    expect(conflicted.status.counts.conflicted).toBe(1)
    expect(conflicted.status.merge.files[0].path).toBe('tracked.txt')
  })

  it('continues a merge after conflicts are resolved', async () => {
    const repoPath = createMergeConflictReadyRepository()
    const service = createService()

    await service.mergeBranch({
      repoPath,
      branchName: 'feature/conflict'
    })
    writeFileSync(path.join(repoPath, 'tracked.txt'), 'resolved\n')
    await service.markResolved({ repoPath, filePath: 'tracked.txt' })

    const continued = await service.continueMergeOperation(repoPath)

    expect(continued.status.merge.operation).toBe('none')
    expect(continued.status.counts.changed).toBe(0)
    expect(git(repoPath, ['log', '-1', '--pretty=%s'])).toContain('feature/conflict')
  })

  it('blocks invalid merge starts and continue without active operations', async () => {
    const repoPath = createTempRepository()
    const service = createService()

    git(repoPath, ['branch', 'feature/blocked'])

    await expect(service.mergeBranch({
      repoPath,
      branchName: 'main'
    })).rejects.toMatchObject({ code: 'invalid_branch' })

    git(repoPath, ['checkout', '--quiet', '--detach', 'HEAD'])
    await expect(service.mergeBranch({
      repoPath,
      branchName: 'feature/blocked'
    })).rejects.toMatchObject({ code: 'git_detached_head' })

    git(repoPath, ['switch', '--quiet', 'main'])
    await expect(service.continueMergeOperation(repoPath)).rejects.toMatchObject({ code: 'no_merge_operation' })
  })

  it('blocks starting a merge while another operation is active', async () => {
    const repoPath = createConflictedRepository()
    const service = createService()

    await expect(service.mergeBranch({
      repoPath,
      branchName: 'feature'
    })).rejects.toMatchObject({ code: 'git_operation_active' })
  })

  it('publishes a branch and sets upstream against a bare remote', async () => {
    const { repoPath, remotePath } = createRemoteBackedRepository()
    const service = createService()

    const snapshot = await service.publishBranch({ repoPath })

    expect(snapshot.summary.upstream).toBe('origin/main')
    expect(git(repoPath, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'])).toBe('origin/main')
    expect(git(remotePath, ['log', '-1', '--pretty=%s', 'main'])).toBe('Initial commit')
  })

  it('blocks branch sync operations from detached HEAD', async () => {
    const { repoPath } = createRemoteBackedRepository()
    const service = createService()

    git(repoPath, ['checkout', '--quiet', '--detach', 'HEAD'])

    await expect(service.publishBranch({ repoPath, branch: 'main' })).rejects.toMatchObject({ code: 'git_detached_head' })
    await expect(service.pull(repoPath)).rejects.toMatchObject({ code: 'git_detached_head' })
    await expect(service.push(repoPath)).rejects.toMatchObject({ code: 'git_detached_head' })
  })

  it('pushes commits when upstream exists and blocks push before publish', async () => {
    const { repoPath, remotePath } = createRemoteBackedRepository()
    const service = createService()

    await expect(service.push(repoPath)).rejects.toMatchObject({ code: 'git_no_upstream' })
    await service.publishBranch({ repoPath })

    writeFileSync(path.join(repoPath, 'tracked.txt'), 'pushed\n')
    git(repoPath, ['add', 'tracked.txt'])
    git(repoPath, ['commit', '-m', 'Push update'])

    const snapshot = await service.push(repoPath)

    expect(snapshot.summary.ahead).toBe(0)
    expect(git(remotePath, ['log', '-1', '--pretty=%s', 'main'])).toBe('Push update')
  })

  it('fetches and pulls fast-forward changes from upstream', async () => {
    const { repoPath, remotePath } = createRemoteBackedRepository()
    const service = createService()

    await service.publishBranch({ repoPath })
    const clonePath = cloneRemote(remotePath)
    writeFileSync(path.join(clonePath, 'tracked.txt'), 'remote\n')
    git(clonePath, ['add', 'tracked.txt'])
    git(clonePath, ['commit', '-m', 'Remote update'])
    git(clonePath, ['push', '--quiet'])

    const fetched = await service.fetch(repoPath)
    expect(fetched.summary.behind).toBe(1)

    const pulled = await service.pull(repoPath)

    expect(pulled.summary.behind).toBe(0)
    expect(readFileSync(path.join(repoPath, 'tracked.txt'), 'utf8')).toBe('remote\n')
  })

  it('reports a clean user-facing error when pull cannot fast-forward', async () => {
    const { repoPath, remotePath } = createRemoteBackedRepository()
    const service = createService()

    await service.publishBranch({ repoPath })
    const clonePath = cloneRemote(remotePath)
    writeFileSync(path.join(clonePath, 'tracked.txt'), 'remote\n')
    git(clonePath, ['add', 'tracked.txt'])
    git(clonePath, ['commit', '-m', 'Remote update'])
    git(clonePath, ['push', '--quiet'])

    writeFileSync(path.join(repoPath, 'tracked.txt'), 'local\n')
    git(repoPath, ['add', 'tracked.txt'])
    git(repoPath, ['commit', '-m', 'Local update'])

    try {
      await service.pull(repoPath)
      throw new Error('Expected pull to fail')
    } catch (error) {
      expect(toBranchPilotError(error).code).toBe('git_pull_not_fast_forward')
    }
  })

  it('creates, switches, and safely deletes local branches', async () => {
    const repoPath = createTempRepository()
    const service = createService()

    const created = await service.createBranch(repoPath, 'feature/work', 'Tracks the generated branch purpose.')
    expect(created.summary.currentBranch).toBe('feature/work')
    expect(created.branches.find((branch) => branch.name === 'feature/work')?.description).toBe('Tracks the generated branch purpose.')

    const switched = await service.switchBranch(repoPath, 'main')
    expect(switched.summary.currentBranch).toBe('main')

    await expect(service.deleteBranch(repoPath, 'feature/work', false, false)).rejects.toMatchObject({
      code: 'confirmation_required'
    })
    await expect(service.deleteBranch(repoPath, 'feature/work', true, true)).rejects.toMatchObject({
      code: 'unsupported_force_delete'
    })

    const deleted = await service.deleteBranch(repoPath, 'feature/work', false, true)
    expect(deleted.branches.map((branch) => branch.name)).not.toContain('feature/work')
  })

  it('updates and clears local branch descriptions', async () => {
    const repoPath = createTempRepository()
    const service = createService()

    await service.createBranch(repoPath, 'feature/described')

    const updated = await service.updateBranchDescription(
      repoPath,
      'feature/described',
      'Documents the user-facing purpose of the branch.'
    )
    expect(updated.branches.find((branch) => branch.name === 'feature/described')?.description)
      .toBe('Documents the user-facing purpose of the branch.')

    const cleared = await service.updateBranchDescription(repoPath, 'feature/described', '  ')
    expect(cleared.branches.find((branch) => branch.name === 'feature/described')?.description).toBeUndefined()

    await expect(service.updateBranchDescription(repoPath, 'feature/missing', 'No branch.')).rejects.toMatchObject({
      code: 'invalid_branch'
    })
  })

  it('compares local branches without switching worktrees', async () => {
    const repoPath = createTempRepository()
    const service = createService()

    await service.createBranch(repoPath, 'feature/compare')
    writeFileSync(path.join(repoPath, 'feature.txt'), 'feature\n')
    git(repoPath, ['add', 'feature.txt'])
    git(repoPath, ['commit', '-m', 'Feature compare work'])

    await service.switchBranch(repoPath, 'main')
    writeFileSync(path.join(repoPath, 'main.txt'), 'main\n')
    git(repoPath, ['add', 'main.txt'])
    git(repoPath, ['commit', '-m', 'Main compare work'])

    const comparison = await service.compareBranch({
      repoPath,
      targetBranch: 'feature/compare'
    })

    expect(comparison).toMatchObject({
      baseBranch: 'main',
      targetBranch: 'feature/compare',
      baseOnlyCommits: 1,
      targetOnlyCommits: 1,
      tooLarge: false
    })
    expect(comparison.files).toEqual([
      {
        path: 'feature.txt',
        rawStatus: 'A',
        status: 'added'
      }
    ])
    expect(comparison.summaryText).toContain('feature.txt')
    expect(git(repoPath, ['branch', '--show-current'])).toBe('main')
    await expect(service.compareBranch({
      repoPath,
      targetBranch: 'main'
    })).rejects.toMatchObject({ code: 'same_branch' })
  })

  it('creates lightweight and annotated tags and deletes tags with confirmation', async () => {
    const repoPath = createTempRepository()
    const service = createService()

    const lightweight = await service.createTag({
      repoPath,
      tagName: 'v0.1.0'
    })
    expect(lightweight.tags.find((tag) => tag.name === 'v0.1.0')).toMatchObject({
      targetShortSha: git(repoPath, ['rev-parse', '--short', 'HEAD'])
    })

    const annotated = await service.createTag({
      repoPath,
      tagName: 'release/v0.1.1',
      message: 'Release v0.1.1'
    })
    expect(annotated.tags.find((tag) => tag.name === 'release/v0.1.1')?.subject).toBe('Release v0.1.1')

    await expect(service.deleteTag({
      repoPath,
      tagName: 'v0.1.0',
      confirmed: false
    })).rejects.toMatchObject({
      code: 'confirmation_required'
    })

    const deleted = await service.deleteTag({
      repoPath,
      tagName: 'v0.1.0',
      confirmed: true
    })
    expect(deleted.tags.map((tag) => tag.name)).not.toContain('v0.1.0')
    expect(deleted.tags.map((tag) => tag.name)).toContain('release/v0.1.1')
  })

  it('creates, lists, and removes linked worktrees with confirmation', async () => {
    const repoPath = createTempRepository()
    const worktreeParent = mkdtempSync(path.join(tmpdir(), 'branchpilot-worktree-test-'))
    tempRoots.push(worktreeParent)
    const targetPath = path.join(worktreeParent, 'repo-experiment')
    const service = createService()

    const initialWorktrees = await service.listWorktrees(repoPath)
    expect(initialWorktrees).toHaveLength(1)
    expect(initialWorktrees[0]).toMatchObject({
      path: realpathSync(repoPath),
      branch: 'main',
      current: true
    })

    await expect(service.createWorktree({
      repoPath,
      branchName: 'main',
      baseRef: 'main',
      targetPath
    })).rejects.toMatchObject({
      code: 'branch_exists'
    })

    const created = await service.createWorktree({
      repoPath,
      branchName: 'experiment/worktree',
      baseRef: 'main',
      targetPath
    })

    expect(created.worktrees).toHaveLength(2)
    const createdWorktree = created.worktrees.find((worktree) => realpathSync(worktree.path) === realpathSync(targetPath))
    expect(createdWorktree).toMatchObject({
      branch: 'experiment/worktree',
      current: false
    })
    expect(git(targetPath, ['branch', '--show-current'])).toBe('experiment/worktree')
    expect(readFileSync(path.join(targetPath, 'tracked.txt'), 'utf8')).toBe('initial\n')

    await expect(service.removeWorktree({
      repoPath,
      targetPath,
      confirmed: false
    })).rejects.toMatchObject({
      code: 'confirmation_required'
    })

    await expect(service.removeWorktree({
      repoPath,
      targetPath: repoPath,
      confirmed: true
    })).rejects.toMatchObject({
      code: 'current_worktree'
    })

    await expect(service.removeWorktree({
      repoPath,
      targetPath,
      confirmed: true,
      force: true
    })).rejects.toMatchObject({
      code: 'unsupported_force_remove'
    })

    const removed = await service.removeWorktree({
      repoPath,
      targetPath,
      confirmed: true
    })

    expect(removed.worktrees).toHaveLength(1)
    expect(existsSync(targetPath)).toBe(false)
  })

  it('blocks deleting the current branch and reports unmerged safe-delete failures', async () => {
    const repoPath = createTempRepository()
    const service = createService()

    await expect(service.deleteBranch(repoPath, 'main', false, true)).rejects.toMatchObject({ code: 'git_current_branch' })

    await service.createBranch(repoPath, 'feature/unmerged')
    writeFileSync(path.join(repoPath, 'tracked.txt'), 'unmerged\n')
    git(repoPath, ['add', 'tracked.txt'])
    git(repoPath, ['commit', '-m', 'Unmerged work'])
    await service.switchBranch(repoPath, 'main')

    try {
      await service.deleteBranch(repoPath, 'feature/unmerged', false, true)
      throw new Error('Expected delete to fail')
    } catch (error) {
      expect(toBranchPilotError(error).code).toBe('git_branch_not_merged')
    }
  })
})

function createTempRepository() {
  const repoPath = mkdtempSync(path.join(tmpdir(), 'branchpilot-test-'))
  tempRoots.push(repoPath)

  git(repoPath, ['init', '-b', 'main'])
  git(repoPath, ['config', 'user.name', 'BranchPilot Test'])
  git(repoPath, ['config', 'user.email', 'branchpilot@example.com'])
  writeFileSync(path.join(repoPath, 'tracked.txt'), 'initial\n')
  git(repoPath, ['add', 'tracked.txt'])
  git(repoPath, ['commit', '-m', 'Initial commit'])

  return repoPath
}

function createConflictedRepository() {
  const repoPath = createTempRepository()

  git(repoPath, ['switch', '--quiet', '-c', 'feature'])
  writeFileSync(path.join(repoPath, 'conflict.txt'), 'feature\n')
  git(repoPath, ['add', 'conflict.txt'])
  git(repoPath, ['commit', '-m', 'Feature change'])

  git(repoPath, ['switch', '--quiet', 'main'])
  writeFileSync(path.join(repoPath, 'conflict.txt'), 'main\n')
  git(repoPath, ['add', 'conflict.txt'])
  git(repoPath, ['commit', '-m', 'Main change'])

  const merge = spawnSync('/usr/bin/git', ['merge', 'feature'], {
    cwd: repoPath,
    encoding: 'utf8'
  })

  expect(merge.status).toBe(1)

  return repoPath
}

function createMergeConflictReadyRepository() {
  const repoPath = createTempRepository()

  git(repoPath, ['switch', '--quiet', '-c', 'feature/conflict'])
  writeFileSync(path.join(repoPath, 'tracked.txt'), 'feature\n')
  git(repoPath, ['add', 'tracked.txt'])
  git(repoPath, ['commit', '-m', 'Feature conflict change'])

  git(repoPath, ['switch', '--quiet', 'main'])
  writeFileSync(path.join(repoPath, 'tracked.txt'), 'main\n')
  git(repoPath, ['add', 'tracked.txt'])
  git(repoPath, ['commit', '-m', 'Main conflict change'])

  return repoPath
}

function createRemoteBackedRepository() {
  const repoPath = createTempRepository()
  const remotePath = mkdtempSync(path.join(tmpdir(), 'branchpilot-remote-test-'))
  tempRoots.push(remotePath)

  git(remotePath, ['init', '--bare'])
  git(repoPath, ['remote', 'add', 'origin', remotePath])

  return { repoPath, remotePath }
}

function cloneRemote(remotePath: string) {
  const clonePath = mkdtempSync(path.join(tmpdir(), 'branchpilot-clone-test-'))
  tempRoots.push(clonePath)

  git(tmpdir(), ['clone', '--quiet', '--branch', 'main', remotePath, clonePath])
  git(clonePath, ['config', 'user.name', 'BranchPilot Clone'])
  git(clonePath, ['config', 'user.email', 'clone@example.com'])

  return clonePath
}

function createService(runner: CommandRunner = new CommandRunner()) {
  const settingsDir = mkdtempSync(path.join(tmpdir(), 'branchpilot-settings-test-'))
  tempRoots.push(settingsDir)

  return new RepositoryService(
    runner,
    new SettingsStore(path.join(settingsDir, 'settings.json'))
  )
}

class RecordingCommandRunner extends CommandRunner {
  calls: Array<{ command: string; args: string[]; options: CommandRunOptions }> = []

  async run(command: string, args: string[], options: CommandRunOptions = {}): Promise<CommandRunResult> {
    this.calls.push({ command, args, options })
    return super.run(command, args, options)
  }

  reset() {
    this.calls = []
  }
}

function git(cwd: string, args: string[]) {
  return execFileSync('/usr/bin/git', args, {
    cwd,
    encoding: 'utf8'
  }).trim()
}

function gitWithEnv(cwd: string, args: string[], env: Record<string, string>) {
  return execFileSync('/usr/bin/git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      ...env
    }
  }).trim()
}
