import { useState } from 'react'
import { GitBranch } from 'lucide-react'
import type { ConfirmationRequest, TextPromptRequest } from '../lib/prompts'

/** GitHub-Desktop-style "choose a branch to merge into <current>" dialog. */
export function MergeBranchDialog({
  currentBranch,
  branches,
  busy,
  onCancel,
  onMerge
}: {
  currentBranch: string
  branches: { name: string }[]
  busy: boolean
  onCancel: () => void
  onMerge: (branchName: string) => void
}) {
  const [filter, setFilter] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const query = filter.trim().toLowerCase()
  const options = branches.filter(
    (branch) => branch.name !== currentBranch && (!query || branch.name.toLowerCase().includes(query))
  )

  return (
    <div className="confirmation-backdrop" role="presentation">
      <section className="confirmation-dialog" role="dialog" aria-modal="true" aria-labelledby="merge-branch-title">
        <div>
          <h2 id="merge-branch-title">Merge into {currentBranch}</h2>
          <p>Choose a branch to merge into <strong>{currentBranch}</strong>.</p>
          <input
            className="text-prompt-input"
            autoFocus
            value={filter}
            placeholder="Filter branches"
            onChange={(event) => setFilter(event.target.value)}
          />
          <div className="merge-branch-list">
            {options.length === 0 ? (
              <p className="shell-dropdown-empty">No other branches to merge.</p>
            ) : (
              options.map((branch) => (
                <button
                  type="button"
                  key={branch.name}
                  className={selected === branch.name ? 'merge-branch-item active' : 'merge-branch-item'}
                  onClick={() => setSelected(branch.name)}
                >
                  <GitBranch size={14} />
                  <span>{branch.name}</span>
                </button>
              ))
            )}
          </div>
        </div>
        <div className="confirmation-actions">
          <button type="button" className="secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" disabled={!selected || busy} onClick={() => selected && onMerge(selected)}>
            Merge into {currentBranch}
          </button>
        </div>
      </section>
    </div>
  )
}

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
            <button
              type="button"
              className={leaveChanges ? 'switch-option' : 'switch-option active'}
              onClick={() => setLeaveChanges(false)}
            >
              <strong>Bring my changes to {toBranch}</strong>
              <span>Your in-progress work will follow you to the other branch.</span>
            </button>
            <button
              type="button"
              className={leaveChanges ? 'switch-option active' : 'switch-option'}
              onClick={() => setLeaveChanges(true)}
            >
              <strong>Leave my changes on {fromBranch}</strong>
              <span>Your work will be stashed on this branch for you to return to later.</span>
            </button>
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

/** Modal for creating a new branch (GitHub-Desktop style: name + base branch). */
export function CreateBranchDialog({
  baseBranch,
  branches,
  remoteBranches,
  value,
  step,
  baseRef,
  changesMode,
  hasChanges,
  changeCount,
  busy,
  onChange,
  onBaseRefChange,
  onChangesModeChange,
  onBack,
  onNext,
  onCancel,
  onCreate
}: {
  baseBranch: string | null
  branches: { name: string }[]
  remoteBranches: { name: string; remote?: string; branchName?: string }[]
  value: string
  step: 'name' | 'options'
  baseRef: string
  changesMode: 'move' | 'leave'
  hasChanges: boolean
  changeCount: number
  busy: boolean
  onChange: (value: string) => void
  onBaseRefChange: (value: string) => void
  onChangesModeChange: (value: 'move' | 'leave') => void
  onBack: () => void
  onNext: () => void
  onCancel: () => void
  onCreate: () => void
}) {
  const branchName = value.trim()
  const fallbackBase = baseBranch ?? 'HEAD'
  const baseOptions = uniqueBranchBaseOptions([
    { value: fallbackBase, label: fallbackBase, kind: 'Current' },
    ...branches.map((branch) => ({ value: branch.name, label: branch.name, kind: 'Local' })),
    ...remoteBranches
      .filter((branch) => branch.name.includes('/'))
      .map((branch) => ({
        value: branch.name,
        label: branch.branchName ? `${branch.name} (${branch.branchName})` : branch.name,
        kind: 'Remote'
      }))
  ])
  const selectedBase = baseRef || fallbackBase

  return (
    <div className="confirmation-backdrop" role="presentation">
      <section className="confirmation-dialog" role="dialog" aria-modal="true" aria-labelledby="create-branch-title">
        <form
          onSubmit={(event) => {
            event.preventDefault()
            if (step === 'name') {
              if (branchName) onNext()
            } else if (branchName) {
              onCreate()
            }
          }}
        >
          {step === 'name' ? (
            <div>
              <h2 id="create-branch-title">Create a branch</h2>
              <p>Name the branch first. Next you will choose the base branch and what to do with current files.</p>
              <input
                className="text-prompt-input"
                autoFocus
                value={value}
                placeholder="new-branch-name"
                onChange={(event) => onChange(event.target.value)}
                onFocus={(event) => event.target.select()}
              />
            </div>
          ) : (
            <div>
              <h2 id="create-branch-title">Create {branchName}</h2>
              <p>Choose what this branch starts from and whether current file changes move with it.</p>

              <label className="create-branch-field">
                <span>Base branch</span>
                <select value={selectedBase} onChange={(event) => onBaseRefChange(event.target.value)} autoFocus>
                  {baseOptions.map((option) => (
                    <option value={option.value} key={option.value}>
                      {option.label} - {option.kind}
                    </option>
                  ))}
                </select>
              </label>

              {hasChanges ? (
                <div className="switch-options" role="group" aria-label="Current file changes">
                  <button
                    type="button"
                    className={changesMode === 'move' ? 'switch-option active' : 'switch-option'}
                    onClick={() => onChangesModeChange('move')}
                  >
                    <strong>Move current changes to the new branch</strong>
                    <span>Switch to {branchName} and keep {changeCount} changed file{changeCount === 1 ? '' : 's'} with it.</span>
                  </button>
                  <button
                    type="button"
                    className={changesMode === 'leave' ? 'switch-option active' : 'switch-option'}
                    onClick={() => onChangesModeChange('leave')}
                  >
                    <strong>Leave current changes here</strong>
                    <span>Create {branchName} from {selectedBase}, but stay on {fallbackBase} so the files remain here.</span>
                  </button>
                </div>
              ) : (
                <div className="create-branch-note">No changed files are waiting, so BranchPilot will switch to the new branch after creating it.</div>
              )}
            </div>
          )}
          <div className="confirmation-actions">
            {step === 'options' && (
              <button type="button" className="secondary" onClick={onBack}>
                Back
              </button>
            )}
            <button type="button" className="secondary" onClick={onCancel}>
              Cancel
            </button>
            <button type="submit" disabled={busy || !branchName}>
              {step === 'name' ? 'Next' : 'Create branch'}
            </button>
          </div>
        </form>
      </section>
    </div>
  )
}

function uniqueBranchBaseOptions(
  options: { value: string; label: string; kind: string }[]
): { value: string; label: string; kind: string }[] {
  const seen = new Set<string>()
  const uniqueOptions: { value: string; label: string; kind: string }[] = []

  for (const option of options) {
    const value = option.value.trim()
    if (!value || seen.has(value)) continue
    seen.add(value)
    uniqueOptions.push({ ...option, value })
  }

  return uniqueOptions
}

/** Modal confirmation dialog (with optional danger styling). */
export function ConfirmationDialog({
  request,
  onAnswer
}: {
  request: ConfirmationRequest
  onAnswer: (confirmed: boolean) => void
}) {
  return (
    <div className="confirmation-backdrop" role="presentation">
      <section
        className={`confirmation-dialog ${request.variant === 'danger' ? 'danger' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`confirmation-title-${request.id}`}
      >
        <div>
          <h2 id={`confirmation-title-${request.id}`}>{request.title}</h2>
          <p>{request.message}</p>
        </div>
        <div className="confirmation-actions">
          <button type="button" className="secondary" onClick={() => onAnswer(false)}>
            {request.cancelLabel}
          </button>
          <button
            type="button"
            className={request.variant === 'danger' ? 'danger-button' : ''}
            onClick={() => onAnswer(true)}
          >
            {request.confirmLabel}
          </button>
        </div>
      </section>
    </div>
  )
}

/** Modal single-line text prompt dialog. */
export function TextPromptDialog({
  request,
  value,
  onChange,
  onAnswer
}: {
  request: TextPromptRequest
  value: string
  onChange: (value: string) => void
  onAnswer: (submitted: boolean) => void
}) {
  return (
    <div className="confirmation-backdrop" role="presentation">
      <section
        className="confirmation-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`confirmation-title-${request.id}`}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault()
            onAnswer(true)
          }}
        >
          <div>
            <h2 id={`confirmation-title-${request.id}`}>{request.title}</h2>
            <p>{request.message}</p>
            <input
              className="text-prompt-input"
              autoFocus
              value={value}
              placeholder={request.placeholder}
              onChange={(event) => onChange(event.target.value)}
              onFocus={(event) => event.target.select()}
            />
          </div>
          <div className="confirmation-actions">
            <button type="button" className="secondary" onClick={() => onAnswer(false)}>
              {request.cancelLabel}
            </button>
            <button type="submit" disabled={!value.trim()}>
              {request.confirmLabel}
            </button>
          </div>
        </form>
      </section>
    </div>
  )
}
