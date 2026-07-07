import { describe, expect, it } from 'vitest'
import { githubHttpsCloneUrl, githubSshCloneUrl } from '../src/lib/githubCloneUrls'
import type { GitHubRepositorySummary } from '../src/shared/branchPilot'

describe('githubCloneUrls', () => {
  it('builds canonical HTTPS clone URLs from repository identity', () => {
    expect(githubHttpsCloneUrl(makeRepository({
      nameWithOwner: 'sergii-ziborov/BranchPilot',
      url: 'https://api.github.com/repos/sergii-ziborov/BranchPilot'
    }))).toBe('https://github.com/sergii-ziborov/BranchPilot.git')
  })

  it('uses SSH URL from GitHub when present', () => {
    expect(githubSshCloneUrl(makeRepository({
      nameWithOwner: 'sergii-ziborov/BranchPilot',
      sshUrl: 'git@github.com:sergii-ziborov/BranchPilot.git'
    }))).toBe('git@github.com:sergii-ziborov/BranchPilot.git')
  })

  it('builds canonical SSH clone URLs when the API payload omitted sshUrl', () => {
    expect(githubSshCloneUrl(makeRepository({
      nameWithOwner: 'sergii-ziborov/BranchPilot',
      sshUrl: ''
    }))).toBe('git@github.com:sergii-ziborov/BranchPilot.git')
  })
})

function makeRepository(overrides: Partial<GitHubRepositorySummary>): GitHubRepositorySummary {
  return {
    name: 'BranchPilot',
    nameWithOwner: 'sergii-ziborov/BranchPilot',
    owner: 'sergii-ziborov',
    description: '',
    visibility: 'PRIVATE',
    isPrivate: true,
    isFork: false,
    isArchived: false,
    url: 'https://github.com/sergii-ziborov/BranchPilot',
    sshUrl: '',
    defaultBranch: 'main',
    updatedAt: '2026-07-07T00:00:00.000Z',
    pushedAt: '2026-07-07T00:00:00.000Z',
    ...overrides
  }
}
