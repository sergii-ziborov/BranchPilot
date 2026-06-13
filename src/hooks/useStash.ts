import { useState } from 'react'
import type { ApiResult, BranchPilotApi, RecentRepository, RepositorySnapshot, StashEntry } from '../shared/branchPilot'
import type { RequestConfirmation, RequestTextInput } from '../lib/prompts'

/** Owns stash list/composer state and the create/apply/drop handlers. */
export function useStash({
  api,
  currentRepoPath,
  snapshot,
  canCreateStash,
  setNotice,
  setError,
  runSnapshotAction,
  requestConfirmation,
  requestTextInput,
  resetPreCommitReview,
  setSnapshot,
  setRecentRepositories
}: {
  api: BranchPilotApi | undefined
  currentRepoPath: string | undefined
  snapshot: RepositorySnapshot | null
  canCreateStash: boolean
  setNotice: (message: string) => void
  setError: (message: string | null) => void
  runSnapshotAction: (label: string, action: () => Promise<ApiResult<RepositorySnapshot>>, progressLabel?: string) => Promise<boolean>
  requestConfirmation: RequestConfirmation
  requestTextInput: RequestTextInput
  resetPreCommitReview: () => void
  setSnapshot: (snapshot: RepositorySnapshot) => void
  setRecentRepositories: (repositories: RecentRepository[]) => void
}) {
  const [stashMessage, setStashMessage] = useState('')
  const [stashes, setStashes] = useState<StashEntry[]>([])

  async function loadStashes(repoPath = currentRepoPath) {
    if (!api || !repoPath) return
    const result = await api.listStashes(repoPath)

    if (result.ok) {
      setStashes(result.data)
    } else {
      setError(result.error.message)
    }
  }

  function defaultStashMessage(): string {
    const branch = snapshot?.summary.currentBranch || 'detached'
    const timestamp = new Intl.DateTimeFormat(undefined, {
      dateStyle: 'short',
      timeStyle: 'short'
    }).format(new Date())

    return `WIP on ${branch} at ${timestamp}`
  }

  async function createStash(message = stashMessage.trim() || defaultStashMessage()) {
    if (!api || !currentRepoPath) return
    if (!canCreateStash) {
      setNotice('Stash blocked: open a repository with local changes and no active merge operation.')
      return
    }

    const created = await runSnapshotAction(
      'Changes stashed.',
      () =>
        api.createStash({
          repoPath: currentRepoPath,
          message,
          includeUntracked: true
        }),
      'Stashing changes...'
    )

    if (created) {
      setStashMessage('')
      await loadStashes(currentRepoPath)
    }
  }

  async function createQuickStash() {
    if (!canCreateStash) {
      setNotice('Stash blocked: open a repository with local changes and no active merge operation.')
      return
    }

    const message = (await requestTextInput('Stash all local changes with this message.', {
      title: 'Quick Stash',
      confirmLabel: 'Stash changes',
      defaultValue: defaultStashMessage()
    }))?.trim()

    if (!message) return

    await createStash(message)
  }

  async function applyStash(stash: StashEntry) {
    if (!api || !currentRepoPath) return
    const confirmed = await requestConfirmation(
      `Apply ${stash.ref} to the working tree? Restoring a stash can produce conflicts with current changes.`,
      {
        title: 'Apply Stash',
        confirmLabel: 'Apply stash'
      }
    )
    if (!confirmed) return

    const applied = await runSnapshotAction('Stash applied.', () =>
      api.applyStash({
        repoPath: currentRepoPath,
        stashRef: stash.ref
      })
    )

    if (applied) {
      await loadStashes(currentRepoPath)
    } else {
      const refreshed = await api.refreshRepository(currentRepoPath)

      if (refreshed.ok) {
        resetPreCommitReview()
        setSnapshot(refreshed.data)
        setRecentRepositories(refreshed.data.recentRepositories)
      }

      await loadStashes(currentRepoPath)
    }
  }

  async function dropStash(stash: StashEntry) {
    if (!api || !currentRepoPath) return
    const confirmed = await requestConfirmation(`Drop ${stash.ref}? This cannot be undone.`, {
      title: 'Drop Stash',
      confirmLabel: 'Drop stash',
      variant: 'danger'
    })

    if (!confirmed) return

    const dropped = await runSnapshotAction('Stash dropped.', () =>
      api.dropStash({
        repoPath: currentRepoPath,
        stashRef: stash.ref,
        confirmed
      })
    )

    if (dropped) {
      await loadStashes(currentRepoPath)
    }
  }

  return {
    stashMessage,
    setStashMessage,
    stashes,
    setStashes,
    loadStashes,
    defaultStashMessage,
    createStash,
    createQuickStash,
    applyStash,
    dropStash
  }
}
