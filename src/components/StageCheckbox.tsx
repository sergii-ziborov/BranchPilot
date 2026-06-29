import { useEffect, useRef, useState } from 'react'
import type { FileChange } from '../shared/branchPilot'
import { getBulkStageToggleState, getChangeStageToggleState } from '../shared/changeStaging'

/** Per-file stage/unstage checkbox, reflecting mixed (partially staged) state. */
export function StageCheckbox({
  change,
  disabled,
  optimisticCheckedOverride = null,
  onToggle
}: {
  change: FileChange
  disabled: boolean
  optimisticCheckedOverride?: boolean | null
  onToggle: (change: FileChange) => void | Promise<void>
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const toggleState = getChangeStageToggleState(change)

  // Staging is async (git). Track the intended value optimistically so the very
  // first click reflects immediately instead of being reverted by the controlled
  // `checked` value while the snapshot reloads.
  const [optimisticChecked, setOptimisticChecked] = useState<boolean | null>(null)
  useEffect(() => {
    setOptimisticChecked(null)
  }, [toggleState.checked, toggleState.mixed])

  const checked = optimisticCheckedOverride ?? optimisticChecked ?? toggleState.checked
  const showMixed = optimisticCheckedOverride === null && optimisticChecked === null && toggleState.mixed
  const title = change.conflicted
    ? 'Resolve conflicts before staging.'
    : showMixed
      ? 'Partially included in commit. Click to include the remaining changes.'
      : checked
        ? 'Included in commit. Click to remove this file from the commit.'
        : 'Not included in commit. Click to include this file.'

  // No dependency array: the browser clears `indeterminate` on click even when
  // the mixed state is unchanged, so re-assert it after every render.
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.indeterminate = showMixed
    }
  })

  return (
    <label className="change-stage-toggle" title={title}>
      <input
        ref={inputRef}
        type="checkbox"
        aria-label={toggleState.label}
        aria-checked={showMixed ? 'mixed' : checked}
        checked={checked}
        disabled={disabled || toggleState.disabled}
        onChange={() => {
          setOptimisticChecked(!checked)
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

  const [optimisticChecked, setOptimisticChecked] = useState<boolean | null>(null)
  useEffect(() => {
    setOptimisticChecked(null)
  }, [state.checked, state.mixed])

  const checked = optimisticChecked ?? state.checked
  const showMixed = optimisticChecked === null && state.mixed

  // No dependency array: the browser clears `indeterminate` on click even when
  // the mixed state is unchanged, so re-assert it after every render.
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.indeterminate = showMixed
    }
  })

  return (
    <label className="bulk-stage-toggle" title={state.label}>
      <input
        ref={inputRef}
        type="checkbox"
        aria-label={state.label}
        aria-checked={showMixed ? 'mixed' : checked}
        checked={checked}
        disabled={disabled || state.disabled}
        onChange={() => {
          setOptimisticChecked(!checked)
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
