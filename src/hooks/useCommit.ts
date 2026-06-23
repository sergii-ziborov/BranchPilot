import { useState } from 'react'
import type { ApiResult, AssistantId, AssistantPolicyStatus, BranchPilotApi, RepositorySnapshot } from '../shared/branchPilot'
import { getAmendCommitActionState, getCommitActionState, getCommitAndPushActionState } from '../shared/commitPreconditions'
import { assistantLabel, assistantPolicyAllows, assistantPolicyBlockedLabel } from '../lib/assistantLabels'
import type { RequestConfirmation } from '../lib/prompts'

/** Owns the commit composer fields and commit/amend/generate handlers. */
export function useCommit({
  api,
  currentRepoPath,
  snapshot,
  selectedAssistant,
  assistantPolicy,
  setNotice,
  runApiAction,
  runSnapshotAction,
  resetPreCommitReview,
  requestConfirmation
}: {
  api: BranchPilotApi | undefined
  currentRepoPath: string | undefined
  snapshot: RepositorySnapshot | null
  selectedAssistant: AssistantId
  assistantPolicy: AssistantPolicyStatus | null
  setNotice: (message: string) => void
  runApiAction: <T>(progressLabel: string, action: () => Promise<ApiResult<T>>, onSuccess: (data: T) => void | Promise<void>) => Promise<boolean>
  runSnapshotAction: (label: string, action: () => Promise<ApiResult<RepositorySnapshot>>, progressLabel?: string) => Promise<boolean>
  resetPreCommitReview: () => void
  requestConfirmation: RequestConfirmation
}) {
  const [commitTitle, setCommitTitle] = useState('')
  const [commitDescription, setCommitDescription] = useState('')
  const [commitCoAuthors, setCommitCoAuthors] = useState('')

  const canGenerateCommitText = assistantPolicyAllows(assistantPolicy, 'commit_message')
  const commitActionState = getCommitActionState({ snapshot, title: commitTitle })
  const commitAndPushActionState = getCommitAndPushActionState({ snapshot, title: commitTitle })
  const amendCommitActionState = getAmendCommitActionState({ snapshot, title: commitTitle })

  async function commitChanges(): Promise<boolean> {
    if (!api || !currentRepoPath) return false
    if (!commitActionState.enabled) {
      setNotice(`Commit blocked: ${commitActionState.reasons.join(' ')}`)
      return false
    }

    const committed = await runSnapshotAction(
      'Commit created.',
      () =>
        api.commit({
          repoPath: currentRepoPath,
          title: commitTitle,
          description: commitDescription,
          coAuthors: commitCoAuthors
        }),
      'Creating commit...'
    )

    if (committed) {
      setCommitTitle('')
      setCommitDescription('')
      setCommitCoAuthors('')
      resetPreCommitReview()
    }

    return committed
  }

  async function amendLastCommit(): Promise<boolean> {
    if (!api || !currentRepoPath) return false
    if (!amendCommitActionState.enabled) {
      setNotice(`Amend blocked: ${amendCommitActionState.reasons.join(' ')}`)
      return false
    }

    const confirmed = await requestConfirmation('Amend the last commit? This rewrites the current branch HEAD.', {
      title: 'Amend Commit',
      confirmLabel: 'Amend commit',
      variant: 'danger'
    })
    if (!confirmed) return false

    const amended = await runSnapshotAction(
      'Commit amended.',
      () =>
        api.amendCommit({
          repoPath: currentRepoPath,
          title: commitTitle,
          description: commitDescription,
          coAuthors: commitCoAuthors,
          confirmed
        }),
      'Amending commit...'
    )

    if (amended) {
      setCommitTitle('')
      setCommitDescription('')
      setCommitCoAuthors('')
      resetPreCommitReview()
    }

    return amended
  }

  async function generateCommitText() {
    if (!api || !currentRepoPath) return
    if (!snapshot) {
      setNotice('Open a repository before generating commit text.')
      return
    }

    if (snapshot.status.merge.operation !== 'none') {
      setNotice('Finish or abort the current merge operation before generating commit text.')
      return
    }

    if (snapshot.status.counts.conflicted > 0) {
      setNotice('Resolve conflicted files before generating commit text.')
      return
    }

    if (snapshot.status.counts.staged === 0) {
      setNotice('Stage at least one change before generating commit text.')
      return
    }

    if (!canGenerateCommitText) {
      setNotice(assistantPolicyBlockedLabel('commit_message', assistantPolicy))
      return
    }

    if (
      (commitTitle.trim() || commitDescription.trim()) &&
      !(await requestConfirmation('Replace the current commit title and description?', {
        title: 'Replace Commit Text',
        confirmLabel: 'Replace text'
      }))
    ) {
      return
    }

    await runApiAction('Generating commit text...', () => api.generateCommitMessage({
      repoPath: currentRepoPath,
      assistant: selectedAssistant
    }), (data) => {
      setCommitTitle(data.title)
      setCommitDescription(data.description)
      setNotice(`Generated with ${assistantLabel(data.assistant)}${data.truncated ? ' from truncated diff' : ''}.`)
    })
  }

  return {
    commitTitle, setCommitTitle, commitDescription, setCommitDescription, commitCoAuthors, setCommitCoAuthors,
    canGenerateCommitText, commitActionState, commitAndPushActionState, amendCommitActionState,
    commitChanges, amendLastCommit, generateCommitText
  }
}
