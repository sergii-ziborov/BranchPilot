import { useEffect, useState } from 'react'
import type { ApiResult, BranchPilotApi, RepositorySnapshot } from '../shared/branchPilot'
import { branchPilotErrorText } from '../shared/branchPilot'
import type { RequestConfirmation } from '../lib/prompts'
import type { ViewMode } from '../lib/viewMode'

/** Owns merge/rebase start and conflict-resolution handlers. */
export function useMerge({
  api,
  currentRepoPath,
  snapshot,
  setNotice,
  setError,
  runBusyOperation,
  runSnapshotAction,
  applySnapshot,
  requestConfirmation,
  setViewMode,
  loadHistory
}: {
  api: BranchPilotApi | undefined
  currentRepoPath: string | undefined
  snapshot: RepositorySnapshot | null
  setNotice: (message: string) => void
  setError: (message: string | null) => void
  runBusyOperation: <T>(label: string, action: () => Promise<T>) => Promise<T>
  runSnapshotAction: (label: string, action: () => Promise<ApiResult<RepositorySnapshot>>, progressLabel?: string) => Promise<boolean>
  applySnapshot: (snapshot: RepositorySnapshot, successMessage: string) => void
  requestConfirmation: RequestConfirmation
  setViewMode: (mode: ViewMode) => void
  loadHistory: () => void | Promise<void>
}) {
  const [selectedMergeBranch, setSelectedMergeBranch] = useState('')
  const mergeState = snapshot?.status.merge

  useEffect(() => {
    if (!snapshot) return

    const mergeCandidates = snapshot.branches.filter((branch) => !branch.current)

    if (!selectedMergeBranch || !mergeCandidates.some((branch) => branch.name === selectedMergeBranch)) {
      setSelectedMergeBranch(mergeCandidates[0]?.name ?? '')
    }
  }, [selectedMergeBranch, snapshot])

  async function startMergeOperation(kind: 'merge' | 'rebase') {
    if (!api || !currentRepoPath || !selectedMergeBranch) return

    const currentBranch = snapshot?.summary.currentBranch ?? 'the current branch'
    const confirmed = await requestConfirmation(
      kind === 'merge'
        ? `Merge ${selectedMergeBranch} into ${currentBranch}?`
        : `Rebase ${currentBranch} onto ${selectedMergeBranch}? This rewrites the commits of ${currentBranch}.`,
      {
        title: kind === 'merge' ? 'Merge Branch' : 'Rebase Branch',
        confirmLabel: kind === 'merge' ? 'Merge' : 'Rebase',
        variant: kind === 'merge' ? 'default' : 'danger'
      }
    )
    if (!confirmed) return

    await runBusyOperation(kind === 'merge' ? 'Merging branch...' : 'Rebasing branch...', async () => {
      const result = kind === 'merge'
        ? await api.mergeBranch({ repoPath: currentRepoPath, branchName: selectedMergeBranch })
        : await api.rebaseBranch({ repoPath: currentRepoPath, branchName: selectedMergeBranch })

      if (result.ok) {
        const cleanLabel = kind === 'merge' ? 'Merge complete.' : 'Rebase complete.'
        const conflictLabel = kind === 'merge' ? 'Merge has conflicts.' : 'Rebase has conflicts.'
        applySnapshot(result.data, result.data.status.merge.operation === 'none' ? cleanLabel : conflictLabel)
        setViewMode('merge')
        void loadHistory()
      } else {
        setError(result.error.message)
        setNotice(branchPilotErrorText(result.error))
      }
    })
  }

  async function continueMergeOperation() {
    if (!api || !currentRepoPath) return
    const continued = await runSnapshotAction('Operation continued.', () => api.continueMergeOperation(currentRepoPath))

    if (continued) {
      void loadHistory()
    }
  }

  async function abortCurrentOperation() {
    if (!api || !currentRepoPath) return
    const confirmed = await requestConfirmation('Abort the current Git operation?', {
      title: 'Abort Git Operation',
      confirmLabel: 'Abort operation',
      variant: 'danger'
    })
    if (!confirmed) return

    await runSnapshotAction('Operation aborted.', () => api.abortMergeOperation(currentRepoPath))
  }

  async function acceptConflictSide(filePath: string, side: 'ours' | 'theirs') {
    if (!api || !currentRepoPath) return
    // During a rebase, Git swaps the meaning: "ours" is the branch being rebased onto.
    const rebaseHint = mergeState?.operation === 'rebase'
      ? ` During a rebase, "${side}" means ${side === 'ours' ? 'the base branch you are rebasing onto' : 'the commits being replayed'}.`
      : ''
    const confirmed = await requestConfirmation(
      `Resolve ${filePath} by keeping ${side === 'ours' ? 'our' : 'their'} version? The other side's changes in this file are discarded.${rebaseHint}`,
      {
        title: side === 'ours' ? 'Accept Ours' : 'Accept Theirs',
        confirmLabel: side === 'ours' ? 'Keep ours' : 'Keep theirs',
        variant: 'danger'
      }
    )
    if (!confirmed) return

    await runSnapshotAction(
      side === 'ours' ? 'Accepted ours.' : 'Accepted theirs.',
      () => side === 'ours'
        ? api.acceptOurs({ repoPath: currentRepoPath, filePath })
        : api.acceptTheirs({ repoPath: currentRepoPath, filePath })
    )
  }

  return {
    selectedMergeBranch,
    setSelectedMergeBranch,
    startMergeOperation,
    continueMergeOperation,
    abortCurrentOperation,
    acceptConflictSide
  }
}
