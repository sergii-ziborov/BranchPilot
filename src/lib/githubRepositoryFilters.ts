import type { GitHubRepositorySummary } from '../shared/branchPilot'

export type GitHubRepositoryVisibilityFilter = 'all' | 'public' | 'private' | 'internal'
export type GitHubRepositoryOwnerScopeFilter = 'all' | 'user' | 'organization'

export function filterVisibleGitHubRepositories(
  repositories: GitHubRepositorySummary[],
  filters: {
    owner: string
    ownerScope?: GitHubRepositoryOwnerScopeFilter
    ownerTypeByLogin?: Record<string, 'user' | 'organization'>
    query: string
    visibility: GitHubRepositoryVisibilityFilter
    limit: string
  }
): GitHubRepositorySummary[] {
  const owner = filters.owner.trim().toLowerCase()
  const ownerScope = filters.ownerScope ?? 'all'
  const ownerTypeByLogin = filters.ownerTypeByLogin ?? {}
  const query = filters.query.trim().toLowerCase()
  const visibility = filters.visibility === 'all' ? '' : filters.visibility.toLowerCase()
  const limit = Math.min(500, Math.max(1, Number.parseInt(filters.limit, 10) || 500))

  return repositories
    .filter((repository) => {
      if (ownerScope !== 'all' && ownerTypeByLogin[repository.owner.toLowerCase()] !== ownerScope) {
        return false
      }

      if (owner && repository.owner.toLowerCase() !== owner) {
        return false
      }

      if (visibility && repository.visibility.toLowerCase() !== visibility) {
        return false
      }

      if (!query) {
        return true
      }

      return [
        repository.nameWithOwner,
        repository.name,
        repository.owner,
        repository.description,
        repository.visibility,
        repository.defaultBranch
      ].some((value) => value.toLowerCase().includes(query))
    })
    .slice(0, limit)
}
