import { useState } from 'react'
import { ChoiceOptionCard } from '../../controls/ChoiceOptionCard'

/** GitHub-Desktop-style switch dialog when the working tree has uncommitted changes. */
export function SwitchBranchDialog({
  fromBranch,
  toBranch,
  busy,
  onCancel,
  onSwitch
}: {
  fromBranch: string
  toBranch: string
  busy: boolean
  onCancel: () => void
  onSwitch: (stashChanges: boolean) => void
}) {
  const [leaveChanges, setLeaveChanges] = useState(false)

  return (
    <div className="confirmation-backdrop" role="presentation">
      <section className="confirmation-dialog" role="dialog" aria-modal="true" aria-labelledby="switch-branch-title">
        <div>
          <h2 id="switch-branch-title">Switch branch</h2>
          <p>You have changes on <strong>{fromBranch}</strong>. What would you like to do with them?</p>
          <div className="switch-options">
            <ChoiceOptionCard
              title={`Bring my changes to ${toBranch}`}
              description="Your in-progress work will follow you to the other branch."
              selected={!leaveChanges}
              onSelect={() => setLeaveChanges(false)}
            />
            <ChoiceOptionCard
              title={`Leave my changes on ${fromBranch}`}
              description="Your work will be stashed on this branch for you to return to later."
              selected={leaveChanges}
              onSelect={() => setLeaveChanges(true)}
            />
          </div>
        </div>
        <div className="confirmation-actions">
          <button type="button" className="secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" disabled={busy} onClick={() => onSwitch(leaveChanges)}>
            Switch branch
          </button>
        </div>
      </section>
    </div>
  )
}
