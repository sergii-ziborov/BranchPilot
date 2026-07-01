import { ChoiceOptionCard } from '../../controls/ChoiceOptionCard'
import { uniqueBranchBaseOptions } from './branchBaseOptions'

/** Modal for creating a new branch: name, base branch, and current changes mode. */
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
                  <ChoiceOptionCard
                    title="Move current changes to the new branch"
                    description={`Switch to ${branchName} and keep ${changeCount} changed file${changeCount === 1 ? '' : 's'} with it.`}
                    selected={changesMode === 'move'}
                    onSelect={() => onChangesModeChange('move')}
                  />
                  <ChoiceOptionCard
                    title="Leave current changes here"
                    description={`Create ${branchName} from ${selectedBase}, but stay on ${fallbackBase} so the files remain here.`}
                    selected={changesMode === 'leave'}
                    onSelect={() => onChangesModeChange('leave')}
                  />
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
