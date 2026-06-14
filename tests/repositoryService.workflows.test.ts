import { existsSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { CommandRunner } from '../electron/lib/commandRunner'
import { toBranchPilotError } from '../electron/lib/errors'
import { RepositoryService } from '../electron/lib/repositoryService'
import { SettingsStore } from '../electron/lib/settingsStore'
import {
  cleanupTempRoots, cloneRemote, createConflictedRepository, createMergeConflictReadyRepository,
  createRebaseConflictReadyRepository, createRemoteBackedRepository, createService, createTempRepository,
  git, gitWithEnv, RecordingCommandRunner, tempRoots
} from './support/repositoryServiceTestSupport'

describe('RepositoryService', () => {
  afterEach(cleanupTempRoots)

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

  it('rebases the current branch onto a clean local branch', async () => {
    const repoPath = createTempRepository()
    const service = createService()

    git(repoPath, ['switch', '--quiet', '-c', 'feature/clean-rebase'])
    writeFileSync(path.join(repoPath, 'feature.txt'), 'feature\n')
    git(repoPath, ['add', 'feature.txt'])
    git(repoPath, ['commit', '-m', 'Feature clean rebase'])
    git(repoPath, ['switch', '--quiet', 'main'])
    writeFileSync(path.join(repoPath, 'main.txt'), 'main\n')
    git(repoPath, ['add', 'main.txt'])
    git(repoPath, ['commit', '-m', 'Main rebase base'])
    git(repoPath, ['switch', '--quiet', 'feature/clean-rebase'])

    const rebased = await service.rebaseBranch({
      repoPath,
      branchName: 'main'
    })

    expect(rebased.status.merge.operation).toBe('none')
    expect(rebased.status.counts.changed).toBe(0)
    expect(rebased.summary.currentBranch).toBe('feature/clean-rebase')
    expect(readFileSync(path.join(repoPath, 'feature.txt'), 'utf8')).toBe('feature\n')
    expect(readFileSync(path.join(repoPath, 'main.txt'), 'utf8')).toBe('main\n')
    expect(git(repoPath, ['log', '--max-count=2', '--pretty=%s']).split('\n')).toEqual([
      'Feature clean rebase',
      'Main rebase base'
    ])
  })

  it('returns a refreshed snapshot when rebase creates conflicts', async () => {
    const repoPath = createRebaseConflictReadyRepository()
    const service = createService()

    const conflicted = await service.rebaseBranch({
      repoPath,
      branchName: 'main'
    })

    expect(conflicted.status.merge.operation).toBe('rebase')
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

  it('continues a rebase after conflicts are resolved', async () => {
    const repoPath = createRebaseConflictReadyRepository()
    const service = createService()

    await service.rebaseBranch({
      repoPath,
      branchName: 'main'
    })
    writeFileSync(path.join(repoPath, 'tracked.txt'), 'resolved\n')
    await service.markResolved({ repoPath, filePath: 'tracked.txt' })

    const continued = await service.continueMergeOperation(repoPath)

    expect(continued.status.merge.operation).toBe('none')
    expect(continued.status.counts.changed).toBe(0)
    expect(continued.summary.currentBranch).toBe('feature/rebase-conflict')
    expect(readFileSync(path.join(repoPath, 'tracked.txt'), 'utf8')).toBe('resolved\n')
  })

  it('blocks invalid merge starts and continue without active operations', async () => {
    const repoPath = createTempRepository()
    const service = createService()

    git(repoPath, ['branch', 'feature/blocked'])

    await expect(service.mergeBranch({
      repoPath,
      branchName: 'main'
    })).rejects.toMatchObject({ code: 'invalid_branch' })
    await expect(service.rebaseBranch({
      repoPath,
      branchName: 'main'
    })).rejects.toMatchObject({ code: 'invalid_branch' })

    git(repoPath, ['checkout', '--quiet', '--detach', 'HEAD'])
    await expect(service.mergeBranch({
      repoPath,
      branchName: 'feature/blocked'
    })).rejects.toMatchObject({ code: 'git_detached_head' })
    await expect(service.rebaseBranch({
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
    await expect(service.rebaseBranch({
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

  it('sets upstream for an existing local branch', async () => {
    const { repoPath } = createRemoteBackedRepository()
    const service = createService()

    git(repoPath, ['push', '--quiet', 'origin', 'main:tracked-main'])
    git(repoPath, ['fetch', '--quiet', 'origin'])

    const snapshot = await service.setBranchUpstream(repoPath, 'main', 'origin/tracked-main')

    expect(snapshot.summary.upstream).toBe('origin/tracked-main')
    expect(git(repoPath, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'])).toBe('origin/tracked-main')
    await expect(service.setBranchUpstream(repoPath, 'main', 'origin/missing')).rejects.toMatchObject({
      code: 'invalid_upstream'
    })
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

    const renamed = await service.renameBranch(repoPath, 'feature/work', 'feature/renamed')
    expect(renamed.summary.currentBranch).toBe('feature/renamed')
    expect(renamed.branches.map((branch) => branch.name)).not.toContain('feature/work')
    expect(renamed.branches.find((branch) => branch.name === 'feature/renamed')?.description).toBe('Tracks the generated branch purpose.')

    await expect(service.renameBranch(repoPath, 'feature/renamed', 'feature/renamed')).rejects.toMatchObject({
      code: 'same_branch'
    })

    const switched = await service.switchBranch(repoPath, 'main')
    expect(switched.summary.currentBranch).toBe('main')

    await expect(service.renameBranch(repoPath, 'feature/renamed', 'main')).rejects.toMatchObject({
      code: 'branch_exists'
    })

    await expect(service.deleteBranch(repoPath, 'feature/renamed', false, false)).rejects.toMatchObject({
      code: 'confirmation_required'
    })
    await expect(service.deleteBranch(repoPath, 'feature/renamed', true, false)).rejects.toMatchObject({
      code: 'confirmation_required'
    })

    const deleted = await service.deleteBranch(repoPath, 'feature/renamed', false, true)
    expect(deleted.branches.map((branch) => branch.name)).not.toContain('feature/renamed')
  })

  it('lists fetched remote branches separately from local branches', async () => {
    const { repoPath, remotePath } = createRemoteBackedRepository()
    const service = createService()

    await service.publishBranch({ repoPath })

    const clonePath = cloneRemote(remotePath)
    git(clonePath, ['switch', '--quiet', '-c', 'feature/remote-only'])
    writeFileSync(path.join(clonePath, 'remote-only.txt'), 'remote only\n')
    git(clonePath, ['add', 'remote-only.txt'])
    git(clonePath, ['commit', '-m', 'Remote only branch'])
    git(clonePath, ['push', '--quiet', '-u', 'origin', 'feature/remote-only'])

    const snapshot = await service.fetch(repoPath)

    expect(snapshot.branches.map((branch) => branch.name)).not.toContain('feature/remote-only')
    expect(snapshot.remoteBranches).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: 'origin/main',
        remote: 'origin',
        branchName: 'main'
      }),
      expect.objectContaining({
        name: 'origin/feature/remote-only',
        remote: 'origin',
        branchName: 'feature/remote-only'
      })
    ]))
    expect(snapshot.remoteBranches.map((branch) => branch.name)).not.toContain('origin/HEAD')
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

    const forced = await service.deleteBranch(repoPath, 'feature/unmerged', true, true)
    expect(forced.branches.map((branch) => branch.name)).not.toContain('feature/unmerged')
  })
})
