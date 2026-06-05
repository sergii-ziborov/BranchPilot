import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { CommandRunner } from '../electron/lib/commandRunner'
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

    const after = await service.setLocalGitIdentity({
      repoPath,
      name: 'BranchPilot Local',
      email: 'local@example.com'
    })

    expect(after.localUserName).toBe('BranchPilot Local')
    expect(after.localUserEmail).toBe('local@example.com')
    expect(git(repoPath, ['config', '--local', '--get', 'user.name'])).toBe('BranchPilot Local')
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

    const deleted = await service.deleteBranch(repoPath, 'feature/work', false)
    expect(deleted.branches.map((branch) => branch.name)).not.toContain('feature/work')
  })

  it('blocks deleting the current branch and reports unmerged safe-delete failures', async () => {
    const repoPath = createTempRepository()
    const service = createService()

    await expect(service.deleteBranch(repoPath, 'main', false)).rejects.toMatchObject({ code: 'git_current_branch' })

    await service.createBranch(repoPath, 'feature/unmerged')
    writeFileSync(path.join(repoPath, 'tracked.txt'), 'unmerged\n')
    git(repoPath, ['add', 'tracked.txt'])
    git(repoPath, ['commit', '-m', 'Unmerged work'])
    await service.switchBranch(repoPath, 'main')

    try {
      await service.deleteBranch(repoPath, 'feature/unmerged', false)
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

function createService() {
  const settingsDir = mkdtempSync(path.join(tmpdir(), 'branchpilot-settings-test-'))
  tempRoots.push(settingsDir)

  return new RepositoryService(
    new CommandRunner(),
    new SettingsStore(path.join(settingsDir, 'settings.json'))
  )
}

function git(cwd: string, args: string[]) {
  return execFileSync('/usr/bin/git', args, {
    cwd,
    encoding: 'utf8'
  }).trim()
}
