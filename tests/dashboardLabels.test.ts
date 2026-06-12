import { describe, expect, it } from 'vitest'
import {
  dashboardRepoMeta,
  dashboardStateLabel,
  matchesDashboardRepository,
  matchesDashboardStaleBranch,
  providerStateLabel
} from '../src/lib/dashboardLabels'
import type { DashboardRepositorySummary, DashboardStaleBranch } from '../src/shared/branchPilot'

function makeRepo(overrides: Partial<DashboardRepositorySummary> = {}): DashboardRepositorySummary {
  return {
    path: '/repo/alpha',
    name: 'alpha',
    pinned: false,
    active: false,
    state: 'clean',
    ahead: 0,
    behind: 0,
    changed: 0,
    staged: 0,
    unstaged: 0,
    untracked: 0,
    conflicted: 0,
    mergeOperation: 'none',
    ...overrides
  }
}

function makeStaleBranch(overrides: Partial<DashboardStaleBranch> = {}): DashboardStaleBranch {
  return {
    repoPath: '/repo/alpha',
    repoName: 'alpha',
    name: 'feature/old',
    lastCommitAt: '2025-01-01',
    daysSinceCommit: 90,
    ...overrides
  }
}

describe('providerStateLabel', () => {
  it('maps known states and passes through unknown ones', () => {
    expect(providerStateLabel('connected')).toBe('connected')
    expect(providerStateLabel('unauthenticated')).toBe('auth required')
    expect(providerStateLabel('missing')).toBe('auth missing')
  })
})

describe('dashboardStateLabel', () => {
  it('labels each state', () => {
    expect(dashboardStateLabel(makeRepo({ state: 'unavailable' }))).toBe('Unavailable')
    expect(dashboardStateLabel(makeRepo({ state: 'dirty' }))).toBe('Dirty')
    expect(dashboardStateLabel(makeRepo({ state: 'clean' }))).toBe('Clean')
  })

  it('names the active merge operation for conflicted repos', () => {
    expect(dashboardStateLabel(makeRepo({ state: 'conflicted', mergeOperation: 'rebase' }))).toBe('rebase active')
    expect(dashboardStateLabel(makeRepo({ state: 'conflicted', mergeOperation: 'none' }))).toBe('Conflict active')
  })
})

describe('matchesDashboardRepository', () => {
  it('matches across multiple fields, case-insensitively', () => {
    const repo = makeRepo({ currentBranch: 'Main', remoteName: 'origin' })
    expect(matchesDashboardRepository(repo, 'alph')).toBe(true)
    expect(matchesDashboardRepository(repo, 'main')).toBe(true)
    expect(matchesDashboardRepository(repo, 'origin')).toBe(true)
    expect(matchesDashboardRepository(repo, 'missing')).toBe(false)
  })

  it('ignores undefined fields without throwing', () => {
    expect(matchesDashboardRepository(makeRepo(), 'zzz')).toBe(false)
  })
})

describe('matchesDashboardStaleBranch', () => {
  it('matches the branch name and repo', () => {
    const branch = makeStaleBranch()
    expect(matchesDashboardStaleBranch(branch, 'feature')).toBe(true)
    expect(matchesDashboardStaleBranch(branch, 'alpha')).toBe(true)
    expect(matchesDashboardStaleBranch(branch, 'nope')).toBe(false)
  })
})

describe('dashboardRepoMeta', () => {
  it('joins present metadata with a separator', () => {
    expect(dashboardRepoMeta(makeRepo({ active: true, pinned: true, currentBranch: 'main', upstream: 'origin/main' })))
      .toBe('active · pinned · main · origin/main')
  })

  it('falls back to upstream-or-remote and a placeholder when empty', () => {
    expect(dashboardRepoMeta(makeRepo({ remoteName: 'origin' }))).toBe('origin')
    expect(dashboardRepoMeta(makeRepo())).toBe('No branch metadata')
  })
})
