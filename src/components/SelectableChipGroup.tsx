/** Wrapping single-select pill group: options flow and wrap, the matching one gets `active`. */
export function SelectableChipGroup({
  options,
  selected,
  onSelect,
  variant = 'name-suggestions',
  ariaLabel,
  titleFor,
  inactiveClassName = '',
  disabled = false
}: {
  options: string[]
  selected: string
  onSelect: (value: string) => void
  variant?: 'name-suggestions' | 'email-options' | 'config-email-options'
  ariaLabel?: string
  titleFor?: (opt: string) => string
  inactiveClassName?: string
  disabled?: boolean
}) {
  const containerClass =
    variant === 'email-options'
      ? 'publish-email-options'
      : variant === 'config-email-options'
        ? 'config-email-options'
        : 'publish-name-suggestions'
  return (
    <div className={containerClass} aria-label={ariaLabel}>
      {options.map((option) => (
        <button
          type="button"
          key={option}
          className={option === selected ? 'active' : inactiveClassName}
          onClick={() => onSelect(option)}
          disabled={disabled}
          title={titleFor?.(option)}
        >
          {option}
        </button>
      ))}
    </div>
  )
}
