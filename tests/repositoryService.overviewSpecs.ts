import { mkdirSync, mkdtempSync, readFileSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import {
  createService,
  createTempRepository,
  git,
  gitWithEnv,
  RecordingCommandRunner,
  tempRoots
} from './support/repositoryServiceTestSupport'

function readText(filePath: string): string {
  return readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n')
}

export function registerRepositoryOverviewSpecs() {
  it('opens a repository and tracks staged/unstaged/untracked files', async () => {
    const repoPath = createTempRepository()
    const service = createService()

    writeFileSync(path.join(repoPath, 'tracked.txt'), 'changed\n')
    writeFileSync(path.join(repoPath, 'new.txt'), 'new\n')
    git(repoPath, ['add', 'tracked.txt'])

    const snapshot = await service.openRepository(repoPath)

    expect(realpathSync.native(snapshot.summary.rootPath)).toBe(realpathSync.native(repoPath))
    expect(snapshot.status.counts.staged).toBe(1)
    expect(snapshot.status.counts.untracked).toBe(1)
    expect(snapshot.status.changes.map((change) => change.path)).toContain('tracked.txt')
    expect(snapshot.status.changes.map((change) => change.path)).toContain('new.txt')
  })

  it('expands untracked directories into file changes', async () => {
    const repoPath = createTempRepository()
    const service = createService()

    mkdirSync(path.join(repoPath, 'mockups'))
    writeFileSync(path.join(repoPath, 'mockups', 'wireframe.html'), '<!doctype html>\n')

    const snapshot = await service.openRepository(repoPath)
    const paths = snapshot.status.changes.map((change) => change.path)

    expect(paths).toContain('mockups/wireframe.html')
    expect(paths).not.toContain('mockups/')
    expect(paths).not.toContain('/mockups')
  })

  it('drops staged new files that were deleted outside BranchPilot before refresh', async () => {
    const repoPath = createTempRepository()
    const service = createService()

    const addedPath = path.join(repoPath, 'added-then-deleted.txt')
    writeFileSync(addedPath, 'temporary\n')
    git(repoPath, ['add', 'added-then-deleted.txt'])
    unlinkSync(addedPath)

    const snapshot = await service.openRepository(repoPath)

    expect(snapshot.status.changes.map((change) => change.path)).not.toContain('added-then-deleted.txt')
    expect(snapshot.status.counts.changed).toBe(0)
    expect(git(repoPath, ['status', '--porcelain'])).toBe('')
  })

  it('pins recent repositories and keeps pinned entries first', async () => {
    const firstRepoPath = createTempRepository()
    const secondRepoPath = createTempRepository()
    const firstRepoRoot = realpathSync.native(firstRepoPath)
    const secondRepoRoot = realpathSync.native(secondRepoPath)
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
    const runner = new RecordingCommandRunner()
    const service = createService(runner)
    const targetPath = path.join(targetParentPath, 'cloned-project')

    const snapshot = await service.cloneRepository({
      remoteUrl: sourceRepoPath,
      targetParentPath,
      targetName: 'cloned-project'
    })
    const cloneCall = runner.calls.find((call) => call.args.includes('clone'))

    expect(realpathSync.native(snapshot.summary.rootPath)).toBe(realpathSync.native(targetPath))
    expect(cloneCall?.args).toEqual(process.platform === 'win32'
      ? ['-c', 'credential.helper=', '-c', 'credential.helper=manager', 'clone', '--', sourceRepoPath, targetPath]
      : ['clone', '--', sourceRepoPath, targetPath])
    expect(snapshot.summary.currentBranch).toBe('main')
    expect(readText(path.join(targetPath, 'tracked.txt'))).toBe('initial\n')
    expect((await service.getRecentRepositories())[0]).toMatchObject({
      path: realpathSync.native(targetPath),
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
    const dirtyRepoRoot = realpathSync.native(dirtyRepoPath)
    const activeRepoRoot = realpathSync.native(activeRepoPath)
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

    const dashboard = await service.dashboard.getRepositoryDashboard(activeRepoPath)
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
    const dashboard = await service.dashboard.getRepositoryDashboard(activeRepoPath)
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
    const snapshot = await service.staging.stageFile({
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
}
