import type { GitHubAccountSummary, GitHubCliStatus, GitHubRepositorySummary } from '../shared/branchPilot'
import { formatDate } from './format'

/** Describe the current GitHub auth state and provider. */
export function githubStatusLabel(status: GitHubCliStatus): string {
  if (status.state === 'authenticated') {
    if (status.authProvider === 'git-credential') {
      return status.username ? `GitHub Desktop: ${status.username}` : 'GitHub Desktop credential'
    }

    return status.username ? `Authenticated as ${status.username}` : 'Authenticated'
  }

  if (status.state === 'unauthenticated') {
    return 'GitHub auth required'
  }

  return 'GitHub auth missing'
}

/** Name the source used to browse GitHub repositories. */
export function githubRepositoryBrowserSourceLabel(status: GitHubCliStatus | null): string {
  if (!status) {
    return 'GitHub'
  }

  if (status.authProvider === 'git-credential') {
    return 'GitHub Desktop'
  }

  return 'gh'
}

/** Option label for a GitHub account (user or organization). */
export function githubAccountOptionLabel(account: GitHubAccountSummary): string {
  return `${account.label} · ${account.type === 'organization' ? 'organization' : 'user'}`
}

/** Compact metadata line for a GitHub repository row. */
export function githubRepositoryMeta(repository: GitHubRepositorySummary): string {
  const parts = [
    repository.visibility.toLowerCase(),
    repository.defaultBranch ? `default ${repository.defaultBranch}` : undefined,
    repository.isFork ? 'fork' : undefined,
    repository.pushedAt ? `pushed ${formatDate(repository.pushedAt)}` : repository.updatedAt ? `updated ${formatDate(repository.updatedAt)}` : undefined
  ].filter((value): value is string => Boolean(value))

  return parts.join(' · ')
}
