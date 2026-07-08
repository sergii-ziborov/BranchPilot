import type {
  ApiResult,
  BranchPilotApi,
  CommitDetails,
  CommitSummary,
  RepositorySnapshot,
  SubmoduleSummary,
} from '../../shared/branchPilot'
import type { RequestConfirmation } from '../../lib/prompts'
import type { ViewMode } from '../../lib/viewMode'

/** Owns commit-level operations (revert / cherry-pick / reset) plus submodule and Git LFS actions. */
export function useRepoActions({
  api,
  currentRepoPath,
  snapshot,
  history,
  commitDetails,
  setNotice,
  setViewMode,
  requestConfirmation,
  runApiAction,
  runSnapshotAction,
  applySnapshot,
  loadHistory
}: {
  api: BranchPilotApi | undefined
  currentRepoPath: string | undefined
  snapshot: RepositorySnapshot | null
  history: CommitSummary[]
  commitDetails: CommitDetails | null
  setNotice: (message: string) => void
  setViewMode: (mode: ViewMode) => void
  requestConfirmation: RequestConfirmation
  runApiAction: <T>(progressLabel: string, action: () => Promise<ApiResult<T>>, onSuccess: (data: T) => void | Promise<void>) => Promise<boolean>
  runSnapshotAction: (label: string, action: () => Promise<ApiResult<RepositorySnapshot>>, progressLabel?: string) => Promise<boolean>
  applySnapshot: (snapshot: RepositorySnapshot, successMessage: string) => void
  loadHistory: () => void | Promise<void>
}) {
  async function applyCommitOperation(kind: 'revert' | 'cherry-pick' | 'reset' | 'reset-hard', commitSha = commitDetails?.sha) {
    if (!api || !currentRepoPath || !commitSha) return
    const targetCommit = commitDetails?.sha === commitSha ? commitDetails : history.find((commit) => commit.sha === commitSha)
    const shortSha = targetCommit?.shortSha ?? commitSha.slice(0, 7)
    const branchName = snapshot?.summary.currentBranch ?? 'the current branch'
    const isCurrentHead = snapshot?.summary.headOid === commitSha
    const resetMode: 'mixed' | 'hard' = kind === 'reset-hard' ? 'hard' : 'mixed'
    const isReset = kind === 'reset' || kind === 'reset-hard'

    if (isReset && isCurrentHead) {
      setNotice(`Branch is already at ${shortSha}. Pick an older commit to move later commits into Changes.`)
      return
    }

    const confirmed = await requestConfirmation(
      isReset
        ? resetMode === 'hard'
          ? `Reset ${branchName} to ${shortSha} and discard later commits plus working tree changes? This cannot be undone by BranchPilot.`
          : `Reset ${branchName} to ${shortSha}? This moves the branch pointer to that commit and keeps later commits as unstaged changes.`
        : kind === 'revert'
          ? `Revert ${shortSha}? This creates a new commit that reverses the selected commit.`
          : `Cherry-pick ${shortSha} onto ${branchName}?`,
      isReset
        ? { title: resetMode === 'hard' ? 'Reset Branch and Discard Changes' : 'Reset Branch', confirmLabel: resetMode === 'hard' ? 'Discard and reset' : 'Reset to commit', variant: 'danger' }
        : kind === 'revert'
          ? { title: 'Revert Commit', confirmLabel: 'Revert commit', variant: 'danger' }
          : { title: 'Cherry-Pick Commit', confirmLabel: 'Cherry-pick' }
    )
    if (!confirmed) return

    const request = {
      repoPath: currentRepoPath,
      commitSha,
      confirmed,
      mode: resetMode
    }

    await runApiAction(
      isReset ? 'Resetting branch...' : kind === 'revert' ? 'Reverting commit...' : 'Cherry-picking commit...',
      () => isReset ? api.resetToCommit(request) : kind === 'revert' ? api.revertCommit(request) : api.cherryPickCommit(request),
      (data) => {
        const hasConflicts = data.status.merge.operation !== 'none' || data.status.counts.conflicted > 0
        const conflictLabel = kind === 'revert' ? 'Revert has conflicts.' : 'Cherry-pick has conflicts.'
        const cleanLabel = isReset
          ? resetMode === 'hard'
            ? 'Branch reset. Later changes discarded.'
            : data.status.counts.changed > 0 ? 'Branch reset. Changes restored as unstaged.' : 'Branch reset.'
          : kind === 'revert' ? 'Commit reverted.' : 'Commit cherry-picked.'
        applySnapshot(data, hasConflicts ? conflictLabel : cleanLabel)
        void loadHistory()

        if (hasConflicts) {
          setViewMode('merge')
        } else if (kind === 'reset' && data.status.counts.changed > 0) {
          setViewMode('changes')
        }
      }
    )
  }

  async function updateSubmodule(submodule?: SubmoduleSummary) {
    if (!api || !currentRepoPath) return

    await runSnapshotAction(submodule ? 'Submodule updated.' : 'Submodules updated.', () =>
      api.updateSubmodule({
        repoPath: currentRepoPath,
        path: submodule?.path,
        init: true,
        recursive: true
      })
    )
  }

  async function openSubmodule(submodule: SubmoduleSummary) {
    if (!api) return

    await runApiAction('Opening submodule...', () => api.openRepository(submodule.absolutePath), (data) => {
      applySnapshot(data, 'Submodule opened.')
      setViewMode('changes')
    })
  }

  async function pullGitLfs() {
    if (!api || !currentRepoPath) return

    await runSnapshotAction('Git LFS objects pulled.', () =>
      api.pullGitLfs(currentRepoPath)
    )
  }

  return { applyCommitOperation, updateSubmodule, openSubmodule, pullGitLfs }
}
