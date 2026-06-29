import type { ReactNode } from 'react'

/** Large clickable CTA card: leading icon plus stacked title and description, rendered as a button. */
export function ActionCard({
  icon,
  title,
  description,
  onClick,
  disabled = false
}: {
  icon: ReactNode
  title: string
  description: string
  onClick?: () => void
  disabled?: boolean
}) {
  return (
    <button type="button" className="no-changes-card" disabled={disabled} onClick={onClick}>
      {icon}
      <span className="no-changes-card-text">
        <strong>{title}</strong>
        <span>{description}</span>
      </span>
    </button>
  )
}
