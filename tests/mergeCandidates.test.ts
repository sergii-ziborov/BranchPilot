import { describe, expect, it } from 'vitest'
import { mergeBranchCandidates } from '../src/lib/mergeCandidates'
import type { RepositorySnapshot } from '../src/shared/branchPilot'

describe('mergeBranchCandidates', () => {
  it('includes local and remote-only branches without duplicating the current branch', () => {
    const snapshot = makeSnapshot({
      currentBranch: 'develop',
      branches: [
        { name: 'develop', current: true, upstream: 'origin/develop' },
        { name: 'feature/local-pr', current: false, upstream: 'origin/feature/local-pr' },
        { name: 'master', current: false }
      ],
      remoteBranches: [
        { name: 'origin/develop', remote: 'origin', branchName: 'develop' },
        { name: 'origin/feature/local-pr', remote: 'origin', branchName: 'feature/local-pr' },
        { name: 'origin/release', remote: 'origin', branchName: 'release' }
      ]
    })

    expect(mergeBranchCandidates(snapshot).map((branch) => branch.name)).toEqual([
      'feature/local-pr',
      'master',
      'origin/release'
    ])
  })
})

function makeSnapshot(input: Pick<RepositorySnapshot['summary'], 'currentBranch'> & {
  branches: RepositorySnapshot['branches']
  remoteBranches: RepositorySnapshot['remoteBranches']
}): RepositorySnapshot {
  return {
    summary: {
      rootPath: '/repo',
      name: 'repo',
      currentBranch: input.currentBranch,
      ahead: 0,
      behind: 0,
      isDetached: false
    },
    status: {
      summary: {
        rootPath: '/repo',
        name: 'repo',
        currentBranch: input.currentBranch,
        ahead: 0,
        behind: 0,
        isDetached: false
      },
      changes: [],
      counts: { changed: 0, staged: 0, unstaged: 0, untracked: 0, conflicted: 0 },
      merge: { operation: 'none', files: [] }
    },
    branches: input.branches,
    remoteBranches: input.remoteBranches,
    tags: [],
    worktrees: [],
    submodules: [],
    lfs: {
      available: false,
      version: undefined,
      patterns: [],
      files: []
    },
    recentRepositories: []
  }
}
