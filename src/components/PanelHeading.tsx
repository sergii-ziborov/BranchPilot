import type { ReactNode } from 'react'

/**
 * Shared panel header: a title with optional description on the left and
 * optional action controls (passed as children) on the right.
 */
export function PanelHeading({
  title,
  description,
  compact = false,
  children
}: {
  title: string
  description?: string
  compact?: boolean
  children?: ReactNode
}) {
  return (
    <div className={compact ? 'panel-heading compact-heading' : 'panel-heading'}>
      <div>
        <h2>{title}</h2>
        {description ? <p>{description}</p> : null}
      </div>
      {children}
    </div>
  )
}
