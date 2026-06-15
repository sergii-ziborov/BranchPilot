/**
 * Leaf module for GitHub provider primitives shared across the main service,
 * the HTTP API client, and the parsers. It imports from no sibling module so
 * the provider trio stays free of runtime import cycles.
 */

export interface GitHubRepositoryInfo {
  owner: string
  repo: string
  remoteUrl: string
}

export function isSafeGitHubPathSegment(value: string): boolean {
  return /^[A-Za-z0-9_.-]+$/.test(value)
}

export function normalizeGitHubRepositoryPath(
  owner: string,
  repo: string
): Pick<GitHubRepositoryInfo, 'owner' | 'repo'> | undefined {
  const normalizedRepo = repo.replace(/\.git$/i, '')

  if (!isSafeGitHubPathSegment(owner) || !isSafeGitHubPathSegment(normalizedRepo)) {
    return undefined
  }

  return {
    owner,
    repo: normalizedRepo
  }
}

export function normalizeApiBranchRef(value: unknown, fallback: string): string {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const ref = (value as Record<string, unknown>).ref

    if (typeof ref === 'string' && ref.trim()) {
      return ref
    }
  }

  return fallback
}
