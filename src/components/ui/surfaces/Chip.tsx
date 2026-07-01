import type { ReactNode } from 'react'
import { X } from 'lucide-react'

/** Generic rounded pill/tag chip: a static span, a selectable button, with optional leading icon and remove button. */
export function Chip({
  label,
  selected = false,
  onClick,
  onRemove,
  leadingIcon,
  title,
  removeLabel = 'Remove'
}: {
  label: ReactNode
  selected?: boolean
  onClick?: () => void
  onRemove?: () => void
  leadingIcon?: ReactNode
  title?: string
  removeLabel?: string
}) {
  const remove = onRemove ? (
    <button
      type="button"
      className="coauthor-remove"
      aria-label={removeLabel}
      title={removeLabel}
      onClick={(event) => {
        event.stopPropagation()
        onRemove()
      }}
    >
      <X size={12} />
    </button>
  ) : null

  if (onClick) {
    return (
      <button
        type="button"
        className={selected ? 'coauthor-chip selected' : 'coauthor-chip'}
        title={title}
        aria-pressed={selected}
        onClick={onClick}
      >
        {leadingIcon}
        <span className="coauthor-chip-text">
          <strong>{label}</strong>
        </span>
        {remove}
      </button>
    )
  }

  return (
    <span className="coauthor-chip" title={title}>
      {leadingIcon}
      <span className="coauthor-chip-text">
        <strong>{label}</strong>
      </span>
      {remove}
    </span>
  )
}
