import type { BranchSummary, CommitSummary, RemoteBranchSummary } from '../../shared/branchPilot'

export interface CompareBranchCandidate {
  value: string
  label: string
  kind: 'Local branch' | 'Remote branch'
}

function commitSearchText(commit: CommitSummary): string {
  return `${commit.shortSha} ${commit.sha} ${commit.subject} ${commit.authorName} ${commit.authorEmail} ${commit.authoredAt}`.toLowerCase()
}

export function collectCompareBranchCandidates(
  branches: BranchSummary[] | undefined,
  remoteBranches: RemoteBranchSummary[] | undefined
): CompareBranchCandidate[] {
  const local = (branches ?? [])
    .filter((branch) => !branch.current)
    .map((branch) => ({ value: branch.name, label: branch.name, kind: 'Local branch' as const }))
  const localNames = new Set(local.map((branch) => branch.value.toLowerCase()))
  const remote = (remoteBranches ?? [])
    .filter((branch) => branch.branchName && branch.branchName !== 'HEAD')
    .filter((branch) => !localNames.has(branch.branchName.toLowerCase()))
    .map((branch) => ({ value: branch.name, label: branch.name, kind: 'Remote branch' as const }))

  return [...local, ...remote]
    .sort((left, right) => left.value.localeCompare(right.value, undefined, { sensitivity: 'base', numeric: true }))
}

export function filterCompareBranchCandidates(
  candidates: CompareBranchCandidate[],
  queryText: string
): CompareBranchCandidate[] {
  return candidates
    .filter((branch) => !queryText || `${branch.value} ${branch.kind}`.toLowerCase().includes(queryText))
    .slice(0, 40)
}

export function filterCompareCommitCandidates(
  history: CommitSummary[],
  excludedSha: string,
  queryText: string
): CommitSummary[] {
  return history
    .filter((commit) => commit.sha !== excludedSha)
    .filter((commit) => !queryText || commitSearchText(commit).includes(queryText))
    .slice(0, 80)
}
