import { describe, expect, it } from 'vitest'
import type { GitHubPullRequest, RepositorySnapshot } from '../src/shared/branchPilot'
import { defaultPullRequestBaseBranch, pullRequestBaseBranchOptions } from '../src/lib/pullRequestBranches'

describe('pullRequestBaseBranchOptions', () => {
  it('includes local and remote-only target branches without remote prefixes', () => {
    const snapshot = snapshotWithBranches({
      currentBranch: 'feature/current',
      branches: ['feature/current', 'develop'],
      remoteBranches: [
        { name: 'origin/develop', remote: 'origin', branchName: 'develop' },
        { name: 'origin/release/2026', remote: 'origin', branchName: 'release/2026' },
        { name: 'upstream/main', remote: 'upstream', branchName: 'main' }
      ]
    })

    expect(pullRequestBaseBranchOptions(snapshot, '').map((option) => option.value))
      .toEqual(['develop', 'main', 'release/2026'])
    expect(defaultPullRequestBaseBranch(snapshot)).toBe('develop')
  })

  it('preserves a selected branch and known pull request bases', () => {
    const snapshot = snapshotWithBranches({
      currentBranch: 'feature/current',
      branches: ['feature/current'],
      remoteBranches: []
    })
    const pullRequests = [
      { baseBranch: 'qa' },
      { baseBranch: 'feature/current' }
    ] as GitHubPullRequest[]

    expect(pullRequestBaseBranchOptions(snapshot, 'origin/hotfix', pullRequests).map((option) => option.value))
      .toEqual(['hotfix', 'qa'])
  })

  it('prioritizes common target branches over long feature branch names', () => {
    const snapshot = snapshotWithBranches({
      currentBranch: 'feature/current',
      branches: [
        'feature/current',
        'GPRO-7058-Enable-DateHour-time-range-pruning-for-Edge-Analytics-ClickHouse-queries',
        'develop',
        'master'
      ],
      remoteBranches: []
    })

    expect(pullRequestBaseBranchOptions(snapshot, '').map((option) => option.value))
      .toEqual([
        'develop',
        'master',
        'GPRO-7058-Enable-DateHour-time-range-pruning-for-Edge-Analytics-ClickHouse-queries'
      ])
    expect(defaultPullRequestBaseBranch(snapshot)).toBe('develop')
  })
})

function snapshotWithBranches({
  currentBranch,
  branches,
  remoteBranches
}: {
  currentBranch: string
  branches: string[]
  remoteBranches: RepositorySnapshot['remoteBranches']
}): RepositorySnapshot {
  return {
    summary: {
      rootPath: '/repo',
      name: 'repo',
      currentBranch,
      ahead: 0,
      behind: 0,
      remoteName: 'origin',
      isDetached: false
    },
    branches: branches.map((name) => ({ name, current: name === currentBranch })),
    remoteBranches
  } as RepositorySnapshot
}
