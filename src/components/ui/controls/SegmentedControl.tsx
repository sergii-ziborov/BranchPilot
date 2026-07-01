import type { ReactNode } from 'react'

export interface SegmentedOption {
  /** Stable value passed to `onChange` and compared against `value` for the active state. */
  value: string
  /** Visible text label. Omit for an icon-only segment. */
  label?: ReactNode
  /** Leading icon node (e.g. a lucide-react icon). Renders before the label. */
  icon?: ReactNode
  /** Disables this segment so it cannot be selected. */
  disabled?: boolean
  /** Native tooltip text for this segment. */
  title?: string
  /** Accessible name for this segment, useful when it is icon-only. */
  ariaLabel?: string
}

/** A joined-button pill group ("segmented control") for picking one option from a small set. */
export function SegmentedControl({
  options,
  value,
  onChange,
  ariaLabel,
  className
}: {
  options: SegmentedOption[]
  value: string
  onChange: (value: string) => void
  ariaLabel?: string
  className?: string
}) {
  const rootClassName = className ? `segmented ${className}` : 'segmented'
  return (
    <div className={rootClassName} aria-label={ariaLabel}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={option.value === value ? 'active' : ''}
          title={option.title}
          aria-label={option.ariaLabel}
          aria-pressed={option.value === value}
          disabled={option.disabled}
          onClick={() => onChange(option.value)}
        >
          {option.icon}
          {option.label}
        </button>
      ))}
    </div>
  )
}
