import { useEffect, useRef } from 'react'
import type { FileChange } from '../shared/branchPilot'
import { getBulkStageToggleState, getChangeStageToggleState } from '../shared/changeStaging'

/** Per-file stage/unstage checkbox, reflecting mixed (partially staged) state. */
export function StageCheckbox({
  change,
  disabled,
  onToggle
}: {
  change: FileChange
  disabled: boolean
  onToggle: (change: FileChange) => void | Promise<void>
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const toggleState = getChangeStageToggleState(change)

  // No dependency array: the browser clears `indeterminate` on click even when
  // the mixed state is unchanged, so re-assert it after every render.
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.indeterminate = toggleState.mixed
    }
  })

  return (
    <label className="change-stage-toggle" title={change.conflicted ? 'Resolve conflicts before staging.' : 'Stage or unstage this file'}>
      <input
        ref={inputRef}
        type="checkbox"
        aria-label={toggleState.label}
        aria-checked={toggleState.mixed ? 'mixed' : toggleState.checked}
        checked={toggleState.checked}
        disabled={disabled || toggleState.disabled}
        onChange={() => {
          void onToggle(change)
        }}
      />
    </label>
  )
}

/** Header checkbox that stages/unstages all changed files at once. */
export function BulkStageCheckbox({
  state,
  disabled,
  changedCount,
  onToggle
}: {
  state: ReturnType<typeof getBulkStageToggleState>
  disabled: boolean
  changedCount: number
  onToggle: () => void | Promise<void>
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const changedLabel = changedCount === 1 ? '1 changed file' : `${changedCount} changed files`

  // No dependency array: the browser clears `indeterminate` on click even when
  // the mixed state is unchanged, so re-assert it after every render.
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.indeterminate = state.mixed
    }
  })

  return (
    <label className="bulk-stage-toggle" title={state.label}>
      <input
        ref={inputRef}
        type="checkbox"
        aria-label={state.label}
        aria-checked={state.mixed ? 'mixed' : state.checked}
        checked={state.checked}
        disabled={disabled || state.disabled}
        onChange={() => {
          void onToggle()
        }}
      />
      <span>
        <strong>{changedLabel}</strong>
        <small>{state.summary}</small>
      </span>
    </label>
  )
}
