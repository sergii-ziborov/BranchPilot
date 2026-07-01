import type { ReactNode } from 'react'

/** Square, icon-only toolbar button with active and danger variants. */
export function IconButton({
  icon,
  label,
  onClick,
  disabled = false,
  active,
  tone = 'default',
  title
}: {
  icon: ReactNode
  label: string
  onClick?: () => void
  disabled?: boolean
  active?: boolean
  tone?: 'default' | 'danger'
  title?: string
}) {
  const classNames = ['icon-button']
  if (active) classNames.push('active')
  // `danger-button` carries a resting red tint (border/bg/text), so the danger
  // variant reads as destructive without needing hover — matches the
  // `danger-button icon-button` pairing used in WorktreesTagsPanel.
  if (tone === 'danger') classNames.push('danger-button')

  return (
    <button
      type="button"
      className={classNames.join(' ')}
      title={title ?? label}
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      disabled={disabled}
    >
      {icon}
    </button>
  )
}
