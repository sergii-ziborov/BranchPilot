import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { CommandRunner } from '../electron/lib/commandRunner'
import { toBranchPilotError } from '../electron/lib/errors'
import { RepositoryService } from '../electron/lib/repositoryService'
import { SettingsStore } from '../electron/lib/settingsStore'

const tempRoots: string[] = []

describe('local repository workflows', () => {
  afterEach(() => {
    for (const root of tempRoots.splice(0)) {
      rmSync(root, { force: true, recursive: true })
    }
  })

  it('opens a repository, previews a diff, stages, and commits local work', async () => {
    const repoPath = createRepository()
    const service = createService()

    writeFileSync(path.join(repoPath, 'tracked.txt'), 'initial\nworkflow change\n')

    const opened = await service.openRepository(repoPath)
    expect(opened.status.counts.unstaged).toBe(1)

    const diff = await service.getDiff({
      repoPath,
      filePath: 'tracked.txt',
      staged: false
    })
    expect(diff.text).toContain('+workflow change')

    const staged = await service.stageFile({ repoPath, filePath: 'tracked.txt' })
    expect(staged.status.counts.staged).toBe(1)

    const committed = await service.commit({
      repoPath,
      title: 'Commit workflow change',
      description: 'Covers the local open, diff, stage, and commit path.'
    })

    expect(committed.status.counts.changed).toBe(0)
    expect(git(repoPath, ['log', '-1', '--pretty=%s'])).toBe('Commit workflow change')
    expect(git(repoPath, ['status', '--porcelain'])).toBe('')
  })

  it('blocks branch switching when dirty work would be overwritten', async () => {
    const repoPath = createRepository()
    const service = createService()

    git(repoPath, ['switch', '--quiet', '-c', 'feature/switch-target'])
    writeFileSync(path.join(repoPath, 'tracked.txt'), 'feature branch content\n')
    git(repoPath, ['add', 'tracked.txt'])
    git(repoPath, ['commit', '-m', 'Feature branch content'])

    git(repoPath, ['switch', '--quiet', 'main'])
    writeFileSync(path.join(repoPath, 'tracked.txt'), 'dirty main content\n')

    try {
      await service.branches.switchBranch(repoPath, 'feature/switch-target')
      throw new Error('Expected dirty branch switch to fail')
    } catch (error) {
      expect(toBranchPilotError(error).code).toBe('git_dirty_worktree')
    }
    expect(git(repoPath, ['branch', '--show-current'])).toBe('main')
    expect(readFileSync(path.join(repoPath, 'tracked.txt'), 'utf8')).toBe('dirty main content\n')
  })

  it('drives a merge conflict workflow through accept theirs and continue', async () => {
    const repoPath = createRepository()
    const service = createService()

    git(repoPath, ['switch', '--quiet', '-c', 'feature/conflict-workflow'])
    writeFileSync(path.join(repoPath, 'tracked.txt'), 'feature conflict content\n')
    git(repoPath, ['add', 'tracked.txt'])
    git(repoPath, ['commit', '-m', 'Feature conflict content'])

    git(repoPath, ['switch', '--quiet', 'main'])
    writeFileSync(path.join(repoPath, 'tracked.txt'), 'main conflict content\n')
    git(repoPath, ['add', 'tracked.txt'])
    git(repoPath, ['commit', '-m', 'Main conflict content'])

    const conflicted = await service.merge.mergeBranch({
      repoPath,
      branchName: 'feature/conflict-workflow'
    })
    expect(conflicted.status.merge.operation).toBe('merge')
    expect(conflicted.status.merge.files[0]).toMatchObject({
      path: 'tracked.txt',
      type: 'both modified'
    })

    const resolved = await service.merge.acceptTheirs({ repoPath, filePath: 'tracked.txt' })
    expect(resolved.status.counts.conflicted).toBe(0)
    expect(readFileSync(path.join(repoPath, 'tracked.txt'), 'utf8')).toBe('feature conflict content\n')

    const continued = await service.merge.continueMergeOperation(repoPath)
    expect(continued.status.merge.operation).toBe('none')
    expect(continued.status.counts.changed).toBe(0)
    expect(git(repoPath, ['log', '-1', '--pretty=%s'])).toContain('feature/conflict-workflow')
  })
})

function createService() {
  const settingsDir = mkdtempSync(path.join(tmpdir(), 'branchpilot-workflow-settings-test-'))
  tempRoots.push(settingsDir)

  return new RepositoryService(
    new CommandRunner(),
    new SettingsStore(path.join(settingsDir, 'settings.json'))
  )
}

function createRepository() {
  const repoPath = mkdtempSync(path.join(tmpdir(), 'branchpilot-workflow-test-'))
  tempRoots.push(repoPath)

  git(repoPath, ['init', '-b', 'main'])
  git(repoPath, ['config', 'user.name', 'BranchPilot Workflow Test'])
  git(repoPath, ['config', 'user.email', 'workflow@example.com'])
  writeFileSync(path.join(repoPath, 'tracked.txt'), 'initial\n')
  git(repoPath, ['add', 'tracked.txt'])
  git(repoPath, ['commit', '-m', 'Initial commit'])

  return repoPath
}

function git(cwd: string, args: string[]) {
  return execFileSync('/usr/bin/git', args, {
    cwd,
    encoding: 'utf8'
  }).trim()
}
