import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  cleanupTempRoots,
  createConflictedRepository,
  createMergeConflictReadyRepository,
  createRebaseConflictReadyRepository,
  createService,
  createTempRepository,
  git
} from './support/repositoryServiceTestSupport'

function readText(filePath: string): string {
  return readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n')
}

describe('RepositoryService merge workflows', () => {
  afterEach(cleanupTempRoots)

  it('detects and aborts a real merge conflict', async () => {
    const repoPath = createConflictedRepository()
    const service = createService()

    const conflicted = await service.openRepository(repoPath)
    expect(conflicted.status.merge.operation).toBe('merge')
    expect(conflicted.status.counts.conflicted).toBe(1)
    expect(conflicted.status.merge.files[0].path).toBe('conflict.txt')

    const aborted = await service.merge.abortMergeOperation(repoPath)
    expect(aborted.status.merge.operation).toBe('none')
    expect(aborted.status.counts.conflicted).toBe(0)
  })

  it('resolves merge conflicts with ours and theirs file choices', async () => {
    const oursRepo = createConflictedRepository()
    const theirsRepo = createConflictedRepository()
    const service = createService()

    const ours = await service.merge.acceptOurs({ repoPath: oursRepo, filePath: 'conflict.txt' })
    expect(ours.status.counts.conflicted).toBe(0)
    expect(readText(path.join(oursRepo, 'conflict.txt'))).toBe('main\n')

    const theirs = await service.merge.acceptTheirs({ repoPath: theirsRepo, filePath: 'conflict.txt' })
    expect(theirs.status.counts.conflicted).toBe(0)
    expect(readText(path.join(theirsRepo, 'conflict.txt'))).toBe('feature\n')
  })

  it('merges a clean local branch into the current branch', async () => {
    const repoPath = createTempRepository()
    const service = createService()

    git(repoPath, ['switch', '--quiet', '-c', 'feature/clean-merge'])
    writeFileSync(path.join(repoPath, 'feature.txt'), 'feature\n')
    git(repoPath, ['add', 'feature.txt'])
    git(repoPath, ['commit', '-m', 'Feature clean merge'])
    git(repoPath, ['switch', '--quiet', 'main'])

    const merged = await service.merge.mergeBranch({
      repoPath,
      branchName: 'feature/clean-merge'
    })

    expect(merged.status.merge.operation).toBe('none')
    expect(merged.status.counts.changed).toBe(0)
    expect(readText(path.join(repoPath, 'feature.txt'))).toBe('feature\n')
  })

  it('returns a refreshed snapshot when merge creates conflicts', async () => {
    const repoPath = createMergeConflictReadyRepository()
    const service = createService()

    const conflicted = await service.merge.mergeBranch({
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

    const rebased = await service.merge.rebaseBranch({
      repoPath,
      branchName: 'main'
    })

    expect(rebased.status.merge.operation).toBe('none')
    expect(rebased.status.counts.changed).toBe(0)
    expect(rebased.summary.currentBranch).toBe('feature/clean-rebase')
    expect(readText(path.join(repoPath, 'feature.txt'))).toBe('feature\n')
    expect(readText(path.join(repoPath, 'main.txt'))).toBe('main\n')
    expect(git(repoPath, ['log', '--max-count=2', '--pretty=%s']).split('\n')).toEqual([
      'Feature clean rebase',
      'Main rebase base'
    ])
  })

  it('returns a refreshed snapshot when rebase creates conflicts', async () => {
    const repoPath = createRebaseConflictReadyRepository()
    const service = createService()

    const conflicted = await service.merge.rebaseBranch({
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

    await service.merge.mergeBranch({
      repoPath,
      branchName: 'feature/conflict'
    })
    writeFileSync(path.join(repoPath, 'tracked.txt'), 'resolved\n')
    await service.merge.markResolved({ repoPath, filePath: 'tracked.txt' })

    const continued = await service.merge.continueMergeOperation(repoPath)

    expect(continued.status.merge.operation).toBe('none')
    expect(continued.status.counts.changed).toBe(0)
    expect(git(repoPath, ['log', '-1', '--pretty=%s'])).toContain('feature/conflict')
  })

  it('continues a rebase after conflicts are resolved', async () => {
    const repoPath = createRebaseConflictReadyRepository()
    const service = createService()

    await service.merge.rebaseBranch({
      repoPath,
      branchName: 'main'
    })
    writeFileSync(path.join(repoPath, 'tracked.txt'), 'resolved\n')
    await service.merge.markResolved({ repoPath, filePath: 'tracked.txt' })

    const continued = await service.merge.continueMergeOperation(repoPath)

    expect(continued.status.merge.operation).toBe('none')
    expect(continued.status.counts.changed).toBe(0)
    expect(continued.summary.currentBranch).toBe('feature/rebase-conflict')
    expect(readText(path.join(repoPath, 'tracked.txt'))).toBe('resolved\n')
  })

  it('blocks invalid merge starts and continue without active operations', async () => {
    const repoPath = createTempRepository()
    const service = createService()

    git(repoPath, ['branch', 'feature/blocked'])

    await expect(service.merge.mergeBranch({
      repoPath,
      branchName: 'main'
    })).rejects.toMatchObject({ code: 'invalid_branch' })
    await expect(service.merge.rebaseBranch({
      repoPath,
      branchName: 'main'
    })).rejects.toMatchObject({ code: 'invalid_branch' })

    git(repoPath, ['checkout', '--quiet', '--detach', 'HEAD'])
    await expect(service.merge.mergeBranch({
      repoPath,
      branchName: 'feature/blocked'
    })).rejects.toMatchObject({ code: 'git_detached_head' })
    await expect(service.merge.rebaseBranch({
      repoPath,
      branchName: 'feature/blocked'
    })).rejects.toMatchObject({ code: 'git_detached_head' })

    git(repoPath, ['switch', '--quiet', 'main'])
    await expect(service.merge.continueMergeOperation(repoPath)).rejects.toMatchObject({ code: 'no_merge_operation' })
  })

  it('blocks starting a merge while another operation is active', async () => {
    const repoPath = createConflictedRepository()
    const service = createService()

    await expect(service.merge.mergeBranch({
      repoPath,
      branchName: 'feature'
    })).rejects.toMatchObject({ code: 'git_operation_active' })
    await expect(service.merge.rebaseBranch({
      repoPath,
      branchName: 'feature'
    })).rejects.toMatchObject({ code: 'git_operation_active' })
  })
})
