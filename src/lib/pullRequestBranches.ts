import type { GitHubPullRequest, RepositorySnapshot } from '../shared/branchPilot'

export interface PullRequestBaseBranchOption {
  value: string
  label: string
  kind: 'selected' | 'local' | 'remote' | 'pull-request'
}

const BASE_BRANCH_PRIORITY = ['develop', 'development', 'main', 'master', 'release', 'staging', 'dev']

export function pullRequestBaseBranchOptions(
  snapshot: RepositorySnapshot | null | undefined,
  selectedBaseBranch: string,
  pullRequests: GitHubPullRequest[] = []
): PullRequestBaseBranchOption[] {
  const options: PullRequestBaseBranchOption[] = []
  const seen = new Set<string>()
  const currentBranch = snapshot?.summary.currentBranch
  const remoteName = snapshot?.summary.remoteName

  addOption(options, seen, normalizePullRequestBaseBranch(selectedBaseBranch, remoteName), 'selected')

  for (const branch of snapshot?.branches ?? []) {
    if (branch.current || branch.name === currentBranch) continue
    addOption(options, seen, branch.name, 'local')
  }

  for (const branch of snapshot?.remoteBranches ?? []) {
    if (!branch.branchName || branch.branchName === 'HEAD' || branch.branchName === currentBranch) continue
    addOption(options, seen, branch.branchName, 'remote', `${branch.branchName} (${branch.remote})`)
  }

  for (const pullRequest of pullRequests) {
    if (pullRequest.baseBranch === currentBranch) continue
    addOption(options, seen, pullRequest.baseBranch, 'pull-request')
  }

  return sortPullRequestBaseBranchOptions(options)
}

export function defaultPullRequestBaseBranch(snapshot: RepositorySnapshot | null | undefined): string {
  const [firstOption] = pullRequestBaseBranchOptions(snapshot, '')
  return firstOption ? firstOption.value : ''
}

export function normalizePullRequestBaseBranch(baseBranch: string, remoteName: string | undefined): string {
  const trimmed = baseBranch.trim()
  if (!trimmed || !remoteName) return trimmed

  return trimmed.startsWith(`${remoteName}/`)
    ? trimmed.slice(remoteName.length + 1)
    : trimmed
}

function addOption(
  options: PullRequestBaseBranchOption[],
  seen: Set<string>,
  value: string,
  kind: PullRequestBaseBranchOption['kind'],
  label = value
) {
  const trimmed = value.trim()
  if (!trimmed) return

  const key = trimmed.toLowerCase()
  if (seen.has(key)) return

  seen.add(key)
  options.push({ value: trimmed, label, kind })
}

function sortPullRequestBaseBranchOptions(options: PullRequestBaseBranchOption[]): PullRequestBaseBranchOption[] {
  return [...options].sort((left, right) => {
    if (left.kind === 'selected' || right.kind === 'selected') {
      return left.kind === right.kind ? 0 : left.kind === 'selected' ? -1 : 1
    }

    const priorityDelta = baseBranchRank(left.value) - baseBranchRank(right.value)
    if (priorityDelta !== 0) return priorityDelta

    return left.value.localeCompare(right.value, undefined, { sensitivity: 'base', numeric: true })
  })
}

function baseBranchRank(branch: string): number {
  const lower = branch.toLowerCase()
  const exactRank = BASE_BRANCH_PRIORITY.indexOf(lower)
  if (exactRank >= 0) return exactRank
  if (lower.startsWith('release/')) return BASE_BRANCH_PRIORITY.indexOf('release')
  return BASE_BRANCH_PRIORITY.length + 1
}
