/** A selectable radio-style option card: a strong title over a muted description, with an active/selected state. */
export function ChoiceOptionCard({
  title,
  description,
  selected,
  onSelect,
  disabled = false
}: {
  title: string
  description: string
  selected: boolean
  onSelect?: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      className={selected ? 'switch-option active' : 'switch-option'}
      aria-pressed={selected}
      disabled={disabled}
      onClick={onSelect}
    >
      <strong>{title}</strong>
      <span>{description}</span>
    </button>
  )
}
