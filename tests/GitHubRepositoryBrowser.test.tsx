import { describe, expect, it } from 'vitest'
import { filterVisibleGitHubRepositories } from '../src/lib/githubRepositoryFilters'
import type { GitHubRepositorySummary } from '../src/shared/branchPilot'

describe('filterVisibleGitHubRepositories', () => {
  it('filters already loaded repositories by owner immediately', () => {
    const repositories = [
      makeRepository({ name: 'profile', nameWithOwner: 'sergii-ziborov/profile', owner: 'sergii-ziborov' }),
      makeRepository({ name: 'frontend', nameWithOwner: 'edgehawk/frontend', owner: 'edgehawk' })
    ]

    expect(filterVisibleGitHubRepositories(repositories, {
      owner: 'edgehawk',
      query: '',
      visibility: 'all',
      limit: '500'
    }).map((repository) => repository.nameWithOwner)).toEqual(['edgehawk/frontend'])
  })

  it('combines search, visibility, and limit filters', () => {
    const repositories = [
      makeRepository({ name: 'private-tools', nameWithOwner: 'sergii-ziborov/private-tools', description: 'Internal helpers', visibility: 'PRIVATE' }),
      makeRepository({ name: 'public-tools', nameWithOwner: 'sergii-ziborov/public-tools', description: 'Internal helpers', visibility: 'PUBLIC', isPrivate: false }),
      makeRepository({ name: 'private-api', nameWithOwner: 'sergii-ziborov/private-api', description: 'Internal API', visibility: 'PRIVATE' })
    ]

    expect(filterVisibleGitHubRepositories(repositories, {
      owner: '',
      query: 'internal',
      visibility: 'private',
      limit: '1'
    }).map((repository) => repository.nameWithOwner)).toEqual(['sergii-ziborov/private-tools'])
  })

  it('filters repositories by account type when account metadata is available', () => {
    const repositories = [
      makeRepository({ name: 'profile', nameWithOwner: 'sergii-ziborov/profile', owner: 'sergii-ziborov' }),
      makeRepository({ name: 'frontend', nameWithOwner: 'edgehawk/frontend', owner: 'edgehawk' })
    ]

    expect(filterVisibleGitHubRepositories(repositories, {
      owner: '',
      ownerScope: 'organization',
      ownerTypeByLogin: {
        'sergii-ziborov': 'user',
        edgehawk: 'organization'
      },
      query: '',
      visibility: 'all',
      limit: '500'
    }).map((repository) => repository.nameWithOwner)).toEqual(['edgehawk/frontend'])
  })
})

function makeRepository(overrides: Partial<GitHubRepositorySummary>): GitHubRepositorySummary {
  return {
    name: 'repo',
    nameWithOwner: 'owner/repo',
    owner: 'owner',
    description: '',
    visibility: 'PRIVATE',
    isPrivate: true,
    isFork: false,
    isArchived: false,
    url: 'https://github.com/owner/repo',
    sshUrl: 'git@github.com:owner/repo.git',
    defaultBranch: 'main',
    updatedAt: '2026-06-22T00:00:00.000Z',
    pushedAt: '2026-06-22T00:00:00.000Z',
    ...overrides
  }
}
