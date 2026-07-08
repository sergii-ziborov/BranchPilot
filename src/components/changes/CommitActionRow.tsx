import { GitCommitHorizontal, Pencil, ShieldCheck, UploadCloud, Users } from 'lucide-react'
import { IconButton } from '../IconButton'
import type { CommitComposerProps } from './CommitComposer.types'

function actionTooltip(
  actionLabel: string,
  blockedLabel: string,
  state: { enabled: boolean; reasons: string[] },
  busy: boolean,
  stagingBusy: boolean
): string {
  if (busy) return 'Another repository operation is running.'
  if (stagingBusy) return 'Staging is still updating. Wait for the staged files to settle.'
  if (state.enabled) return actionLabel
  return `${blockedLabel}: ${state.reasons.join(' ')}`
}

export type CommitActionRowProps = Pick<
  CommitComposerProps,
  | 'busy'
  | 'stagingBusy'
  | 'commitActionState'
  | 'amendCommitActionState'
  | 'commitAndPushActionState'
  | 'commitChanges'
  | 'amendLastCommit'
  | 'currentRepoPath'
  | 'runSnapshotAction'
  | 'api'
  | 'setNotice'
  | 'onOpenReview'
> & {
  coAuthorsVisible: boolean
  onToggleCoAuthors: () => void
}

export function CommitActionRow({
  busy,
  stagingBusy,
  commitActionState,
  amendCommitActionState,
  commitAndPushActionState,
  commitChanges,
  amendLastCommit,
  currentRepoPath,
  runSnapshotAction,
  api,
  setNotice,
  onOpenReview,
  coAuthorsVisible,
  onToggleCoAuthors
}: CommitActionRowProps) {
  const commitOperationBusy = busy || stagingBusy
  const commitTooltip = actionTooltip('Commit staged changes', 'Commit blocked', commitActionState, busy, stagingBusy)
  const amendTooltip = actionTooltip('Amend the previous commit with current staged changes', 'Amend blocked', amendCommitActionState, busy, stagingBusy)
  const commitAndPushTooltip = actionTooltip('Commit staged changes and push to the upstream branch', 'Commit & push blocked', commitAndPushActionState, busy, stagingBusy)

  const notifyBlocked = (title: string, reasons: string[]) => {
    setNotice(reasons.length > 0 ? `${title}: ${reasons.join(' · ')}` : title)
  }

  const notifyStagingBusy = () => {
    setNotice('Staging is still updating. Commit actions will unlock when the index is ready.')
  }

  return (
    <div className="commit-actions">
      <IconButton
        active={coAuthorsVisible}
        icon={<Users size={16} />}
        label="Author tools"
        title={coAuthorsVisible ? 'Hide author tools' : 'Author tools'}
        onClick={onToggleCoAuthors}
      />
      <button className="icon-button" type="button" title="Review changes" aria-label="Review changes" onClick={onOpenReview}>
        <ShieldCheck size={16} />
      </button>
      <button
        type="button"
        className={commitActionState.enabled && !commitOperationBusy ? undefined : 'blocked'}
        title={commitTooltip}
        aria-disabled={commitOperationBusy || !commitActionState.enabled}
        onClick={() => {
          if (busy) return
          if (stagingBusy) {
            notifyStagingBusy()
            return
          }
          if (!commitActionState.enabled) {
            notifyBlocked('Commit blocked', commitActionState.reasons)
            return
          }
          void commitChanges()
        }}
      >
        <GitCommitHorizontal size={17} />
        Commit
      </button>
      <button
        type="button"
        className={amendCommitActionState.enabled && !commitOperationBusy ? 'danger-button' : 'danger-button blocked'}
        title={amendTooltip}
        aria-disabled={commitOperationBusy || !amendCommitActionState.enabled}
        onClick={() => {
          if (busy) return
          if (stagingBusy) {
            notifyStagingBusy()
            return
          }
          if (!amendCommitActionState.enabled) {
            notifyBlocked('Amend blocked', amendCommitActionState.reasons)
            return
          }
          void amendLastCommit()
        }}
      >
        <Pencil size={17} />
        Amend last
      </button>
      <button
        type="button"
        className={commitAndPushActionState.enabled && !commitOperationBusy ? 'secondary' : 'secondary blocked'}
        title={commitAndPushTooltip}
        aria-disabled={commitOperationBusy || !commitAndPushActionState.enabled}
        onClick={async () => {
          if (busy) return
          if (stagingBusy) {
            notifyStagingBusy()
            return
          }
          if (!commitAndPushActionState.enabled) {
            notifyBlocked('Commit & push blocked', commitAndPushActionState.reasons)
            return
          }
          const committed = await commitChanges('Committing and pushing...')
          if (committed && currentRepoPath) {
            await runSnapshotAction('Push complete.', () => api!.push(currentRepoPath), 'Committing and pushing...')
          }
        }}
      >
        <UploadCloud size={17} />
        Commit & push
      </button>
    </div>
  )
}
