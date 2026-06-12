import type { DashboardRepositorySummary, DashboardStaleBranch, ProviderStatus } from '../shared/branchPilot'

/** Short label for a provider connection state. */
export function providerStateLabel(state: ProviderStatus['state']): string {
  if (state === 'connected') return 'connected'
  if (state === 'unauthenticated') return 'auth required'
  if (state === 'missing') return 'auth missing'
  return state
}

/** Label summarising a dashboard repository's working state. */
export function dashboardStateLabel(repo: DashboardRepositorySummary): string {
  if (repo.state === 'unavailable') return 'Unavailable'
  if (repo.state === 'conflicted') return `${repo.mergeOperation === 'none' ? 'Conflict' : repo.mergeOperation} active`
  if (repo.state === 'dirty') return 'Dirty'
  return 'Clean'
}

/** Case-insensitive match of a query against a dashboard repository's fields. */
export function matchesDashboardRepository(repo: DashboardRepositorySummary, query: string): boolean {
  return [
    repo.name,
    repo.path,
    repo.currentBranch,
    repo.upstream,
    repo.remoteName,
    repo.state,
    repo.error
  ]
    .filter((value): value is string => Boolean(value))
    .some((value) => value.toLowerCase().includes(query))
}

/** Case-insensitive match of a query against a stale-branch entry. */
export function matchesDashboardStaleBranch(branch: DashboardStaleBranch, query: string): boolean {
  return [
    branch.repoName,
    branch.repoPath,
    branch.name,
    branch.lastCommitAt
  ].some((value) => value.toLowerCase().includes(query))
}

/** Compact metadata line for a dashboard repository row. */
export function dashboardRepoMeta(repo: DashboardRepositorySummary): string {
  const parts = [
    repo.active ? 'active' : undefined,
    repo.pinned ? 'pinned' : undefined,
    repo.currentBranch,
    repo.upstream ?? repo.remoteName
  ].filter((value): value is string => Boolean(value))

  return parts.length > 0 ? parts.join(' · ') : 'No branch metadata'
}
