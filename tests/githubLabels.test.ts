import { describe, expect, it } from 'vitest'
import {
  checkBucketClass,
  githubAccountOptionLabel,
  githubRepositoryBrowserSourceLabel,
  githubRepositoryMeta,
  githubStatusLabel
} from '../src/lib/githubLabels'
import type { GitHubAccountSummary, GitHubCliStatus, GitHubRepositorySummary } from '../src/shared/branchPilot'

function makeStatus(overrides: Partial<GitHubCliStatus> = {}): GitHubCliStatus {
  return {
    state: 'authenticated',
    installed: true,
    authenticated: true,
    ghAuthenticated: true,
    gitCredentialAuthenticated: false,
    authProvider: 'gh',
    message: '',
    ...overrides
  }
}

function makeRepo(overrides: Partial<GitHubRepositorySummary> = {}): GitHubRepositorySummary {
  return {
    name: 'repo',
    nameWithOwner: 'owner/repo',
    owner: 'owner',
    description: '',
    visibility: 'PUBLIC',
    isPrivate: false,
    isFork: false,
    isArchived: false,
    url: '',
    sshUrl: '',
    defaultBranch: 'main',
    updatedAt: '',
    pushedAt: '',
    ...overrides
  }
}

describe('githubStatusLabel', () => {
  it('labels gh-authenticated users', () => {
    expect(githubStatusLabel(makeStatus({ authProvider: 'gh', username: 'octo' }))).toBe('Authenticated as octo')
    expect(githubStatusLabel(makeStatus({ authProvider: 'gh', username: undefined }))).toBe('Authenticated')
  })

  it('labels GitHub Desktop credential auth', () => {
    expect(githubStatusLabel(makeStatus({ authProvider: 'git-credential', username: 'octo' }))).toBe('GitHub Desktop: octo')
    expect(githubStatusLabel(makeStatus({ authProvider: 'git-credential', username: undefined }))).toBe('GitHub Desktop credential')
  })

  it('labels unauthenticated and missing states', () => {
    expect(githubStatusLabel(makeStatus({ state: 'unauthenticated' }))).toBe('GitHub auth required')
    expect(githubStatusLabel(makeStatus({ state: 'missing' }))).toBe('GitHub auth missing')
  })
})

describe('githubRepositoryBrowserSourceLabel', () => {
  it('falls back to GitHub when status is null', () => {
    expect(githubRepositoryBrowserSourceLabel(null)).toBe('GitHub')
  })

  it('distinguishes GitHub Desktop from gh', () => {
    expect(githubRepositoryBrowserSourceLabel(makeStatus({ authProvider: 'git-credential' }))).toBe('GitHub Desktop')
    expect(githubRepositoryBrowserSourceLabel(makeStatus({ authProvider: 'gh' }))).toBe('gh')
  })
})

describe('githubAccountOptionLabel', () => {
  it('labels users and organizations', () => {
    const base: GitHubAccountSummary = { login: 'octo', label: 'Octo', type: 'user', url: '' }
    expect(githubAccountOptionLabel(base)).toBe('Octo · user')
    expect(githubAccountOptionLabel({ ...base, type: 'organization' })).toBe('Octo · organization')
  })
})

describe('checkBucketClass', () => {
  it('maps known buckets to their class', () => {
    expect(checkBucketClass('pass')).toBe('pass')
    expect(checkBucketClass('fail')).toBe('fail')
    expect(checkBucketClass('pending')).toBe('pending')
    expect(checkBucketClass('skipping')).toBe('skipping')
    expect(checkBucketClass('cancel')).toBe('cancel')
  })

  it('defaults unknown buckets to "other"', () => {
    expect(checkBucketClass('weird')).toBe('other')
  })
})

describe('githubRepositoryMeta', () => {
  it('lowercases visibility and lists present fields', () => {
    expect(githubRepositoryMeta(makeRepo({ visibility: 'PRIVATE', defaultBranch: 'main', isFork: true })))
      .toContain('private · default main · fork')
  })

  it('omits empty fields', () => {
    expect(githubRepositoryMeta(makeRepo({ visibility: 'PUBLIC', defaultBranch: '', isFork: false })))
      .toBe('public')
  })
})
