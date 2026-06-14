import { mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { toBranchPilotError } from '../electron/lib/errors'
import {
  cleanupTempRoots,   createService, createTempRepository,
  git, gitWithEnv, RecordingCommandRunner, tempRoots
} from './support/repositoryServiceTestSupport'

describe('RepositoryService', () => {
  afterEach(cleanupTempRoots)

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
    expect(snapshot.remoteBranches).toEqual(openedSnapshot.remoteBranches)
    expect(snapshot.tags).toEqual(openedSnapshot.tags)
    expect(snapshot.worktrees).toEqual(openedSnapshot.worktrees)
    expect(snapshot.submodules).toEqual(openedSnapshot.submodules)
    expect(snapshot.lfs).toEqual(openedSnapshot.lfs)
    expect(commandLines.some((line) => line.startsWith('lfs '))).toBe(false)
    expect(commandLines.some((line) => line.startsWith('submodule '))).toBe(false)
    expect(commandLines.some((line) => line.startsWith('tag '))).toBe(false)
    expect(commandLines.some((line) => line.startsWith('branch -r '))).toBe(false)
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

  it('commits staged changes with co-author trailers', async () => {
    const repoPath = createTempRepository()
    const service = createService()

    writeFileSync(path.join(repoPath, 'tracked.txt'), 'coauthored change\n')
    git(repoPath, ['add', 'tracked.txt'])

    await service.commit({
      repoPath,
      title: 'Update with coauthors',
      description: 'Adds commit trailers through BranchPilot.',
      coAuthors: [
        'Ada Lovelace <ada@example.com>',
        'Co-authored-by: Grace Hopper <grace@example.com>'
      ].join('\n')
    })

    const body = git(repoPath, ['log', '-1', '--pretty=%b'])
    expect(body).toContain('Adds commit trailers through BranchPilot.')
    expect(body).toContain('Co-authored-by: Ada Lovelace <ada@example.com>')
    expect(body).toContain('Co-authored-by: Grace Hopper <grace@example.com>')
  })

  it('rejects invalid co-author lines before committing', async () => {
    const repoPath = createTempRepository()
    const service = createService()

    writeFileSync(path.join(repoPath, 'tracked.txt'), 'invalid coauthor\n')
    git(repoPath, ['add', 'tracked.txt'])

    await expect(service.commit({
      repoPath,
      title: 'Invalid coauthor',
      description: '',
      coAuthors: 'Not an email'
    })).rejects.toMatchObject({
      code: 'invalid_co_author'
    })
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
      coAuthors: 'Alan Turing <alan@example.com>',
      confirmed: true
    })

    expect(snapshot.status.counts.changed).toBe(0)
    expect(git(repoPath, ['rev-parse', 'HEAD'])).not.toBe(originalHead)
    expect(git(repoPath, ['log', '-1', '--pretty=%s'])).toBe('Amended initial commit')
    expect(git(repoPath, ['log', '-1', '--pretty=%b'])).toContain('Keeps the tree')
    expect(git(repoPath, ['log', '-1', '--pretty=%b'])).toContain('Co-authored-by: Alan Turing <alan@example.com>')
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

})
