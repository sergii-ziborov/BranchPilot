import type { BranchSummary, RemoteBranchSummary, RepositorySnapshot } from '../shared/branchPilot'

export interface MergeBranchCandidate {
  name: string
  kind: 'local' | 'remote'
  label: string
  lastCommitAt?: string
}

export function mergeBranchCandidates(snapshot: RepositorySnapshot | null | undefined): MergeBranchCandidate[] {
  if (!snapshot) return []

  const currentBranch = snapshot.summary.currentBranch
  const localNames = new Set(snapshot.branches.map((branch) => branch.name))
  const candidates: MergeBranchCandidate[] = []

  for (const branch of snapshot.branches) {
    if (branch.current || branch.name === currentBranch) continue
    candidates.push(localCandidate(branch))
  }

  for (const branch of snapshot.remoteBranches) {
    if (branch.branchName === currentBranch) continue
    if (localNames.has(branch.name) || localNames.has(branch.branchName)) continue
    candidates.push(remoteCandidate(branch))
  }

  return candidates.sort((first, second) => {
    if (first.kind !== second.kind) return first.kind === 'local' ? -1 : 1
    return (second.lastCommitAt ?? '').localeCompare(first.lastCommitAt ?? '') || first.name.localeCompare(second.name)
  })
}

function localCandidate(branch: BranchSummary): MergeBranchCandidate {
  return {
    name: branch.name,
    kind: 'local',
    label: branch.name,
    lastCommitAt: branch.lastCommitAt
  }
}

function remoteCandidate(branch: RemoteBranchSummary): MergeBranchCandidate {
  return {
    name: branch.name,
    kind: 'remote',
    label: `${branch.name} (remote)`,
    lastCommitAt: branch.lastCommitAt
  }
}
