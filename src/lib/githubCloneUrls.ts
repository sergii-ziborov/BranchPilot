import type { GitHubRepositorySummary } from '../shared/branchPilot'

export function githubHttpsCloneUrl(repository: GitHubRepositorySummary): string {
  return `https://github.com/${repository.nameWithOwner}.git`
}

export function githubSshCloneUrl(repository: GitHubRepositorySummary): string {
  return repository.sshUrl || `git@github.com:${repository.nameWithOwner}.git`
}
