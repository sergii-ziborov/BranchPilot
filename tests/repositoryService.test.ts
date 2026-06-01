import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { CommandRunner } from '../electron/lib/commandRunner'
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
