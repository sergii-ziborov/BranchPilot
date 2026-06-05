import type { GitHubCliStatus, RepositorySnapshot } from './branchPilot.js'

export interface PullRequestActionInput {
  snapshot: RepositorySnapshot | null
  githubStatus: GitHubCliStatus | null
  title: string
  currentPullRequestExists: boolean
}

export interface PullRequestActionState {
  enabled: boolean
  reasons: string[]
}

export function getCreatePullRequestState(input: PullRequestActionInput): PullRequestActionState {
  const reasons: string[] = []
  const summary = input.snapshot?.summary

  if (!summary) {
    reasons.push('Open a repository.')
  } else {
    if (summary.isDetached) {
      reasons.push('Switch from detached HEAD to a branch.')
    }

    if (!summary.upstream) {
      reasons.push('Publish the current branch.')
    }
  }

  if (!input.title.trim()) {
    reasons.push('Add a pull request title.')
  }

  if (!input.githubStatus?.authenticated) {
    reasons.push('Authenticate GitHub with gh or GitHub Desktop.')
  }

  if (input.currentPullRequestExists) {
    reasons.push('Current branch already has a pull request.')
  }

  return {
    enabled: reasons.length === 0,
    reasons
  }
}

export function getPullRequestBrowseState(
  snapshot: RepositorySnapshot | null,
  githubStatus: GitHubCliStatus | null
): PullRequestActionState {
  const reasons: string[] = []

  if (!snapshot) {
    reasons.push('Open a repository.')
  }

  if (!githubStatus?.ghAuthenticated) {
    reasons.push('Run gh auth login to browse pull requests, checks, diffs, and checkout.')
  }

  return {
    enabled: reasons.length === 0,
    reasons
  }
}
