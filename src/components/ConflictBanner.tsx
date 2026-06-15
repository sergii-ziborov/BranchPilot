import { GitMerge } from 'lucide-react'
import type { InProgressOperation } from '../shared/branchPilot'

const OPERATION_LABEL: Record<Exclude<InProgressOperation, 'none'>, string> = {
  merge: 'Merge',
  rebase: 'Rebase',
  'cherry-pick': 'Cherry-pick'
}

/** Contextual banner shown whenever a merge/rebase/cherry-pick is mid-conflict. */
export function ConflictBanner({
  operation,
  conflictedCount,
  busy,
  onResolve,
  onAbort
}: {
  operation: Exclude<InProgressOperation, 'none'>
  conflictedCount: number
  busy: boolean
  onResolve: () => void
  onAbort: () => void | Promise<void>
}) {
  return (
    <div className="conflict-banner" role="alert">
      <GitMerge size={18} />
      <div className="conflict-banner-text">
        <strong>{OPERATION_LABEL[operation]} in progress</strong>
        <span>
          {conflictedCount > 0
            ? `${conflictedCount} conflicted file${conflictedCount === 1 ? '' : 's'} — resolve them to continue.`
            : 'Resolve the operation to continue.'}
        </span>
      </div>
      <div className="conflict-banner-actions">
        <button type="button" onClick={onResolve}>Resolve conflicts</button>
        <button type="button" className="secondary" onClick={() => void onAbort()} disabled={busy}>Abort</button>
      </div>
    </div>
  )
}
