import { execFileSync } from 'node:child_process'
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
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
