import type { InProgressOperation, RepositorySnapshot } from './branchPilot.js'

export interface CommitActionInput {
  snapshot: RepositorySnapshot | null
  title: string
}

export interface CommitActionState {
  enabled: boolean
  reasons: string[]
}

export function getCommitActionState(input: CommitActionInput): CommitActionState {
  return buildCommitState(input, false)
}

export function getCommitAndPushActionState(input: CommitActionInput): CommitActionState {
  return buildCommitState(input, true)
}

function buildCommitState(input: CommitActionInput, includePushChecks: boolean): CommitActionState {
  const reasons: string[] = []
  const snapshot = input.snapshot

  if (!snapshot) {
    reasons.push('Open a repository.')
  } else {
    const operation = snapshot.status.merge.operation

    if (operation !== 'none') {
      reasons.push(`Finish or abort the ${operationLabel(operation)} in Merge view.`)
    } else if (snapshot.status.counts.conflicted > 0) {
      reasons.push('Resolve conflicted files before committing.')
    }

    if (snapshot.status.counts.staged === 0) {
      reasons.push('Stage at least one change.')
    }

    if (includePushChecks) {
      if (snapshot.summary.isDetached) {
        reasons.push('Switch from detached HEAD to a branch before pushing.')
      } else if (!snapshot.summary.upstream) {
        reasons.push(snapshot.summary.remoteName ? 'Publish the current branch.' : 'Add a Git remote before pushing.')
      }
    }
  }

  if (!input.title.trim()) {
    reasons.push('Add a commit title.')
  }

  return {
    enabled: reasons.length === 0,
    reasons
  }
}

function operationLabel(operation: InProgressOperation): string {
  if (operation === 'cherry-pick') return 'cherry-pick'
  return operation
}
