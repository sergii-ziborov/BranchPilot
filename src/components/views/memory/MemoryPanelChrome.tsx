import type { ReactNode } from 'react'

export function MemoryPanelHeading({
  title,
  detail,
  actions
}: {
  title: string
  detail: ReactNode
  actions?: ReactNode
}) {
  return (
    <div className="memory-panel-heading">
      <div>
        <h2>{title}</h2>
        <p>{detail}</p>
      </div>
      {actions && <div className="panel-actions memory-actions">{actions}</div>}
    </div>
  )
}

export function MemoryCellHeading({
  icon,
  title,
  meta,
  compact = false
}: {
  icon: ReactNode
  title: string
  meta: string
  compact?: boolean
}) {
  return (
    <div className={compact ? 'memory-cell-heading compact' : 'memory-cell-heading'}>
      <div>
        {icon}
        <h3>{title}</h3>
      </div>
      <span>{meta}</span>
    </div>
  )
}

export function MemoryChipGroup({
  label,
  items,
  empty,
  action
}: {
  label: string
  items: string[]
  empty: string
  action?: ReactNode
}) {
  const visibleItems = items.slice(0, 6)

  return (
    <div className={action ? 'memory-chip-row with-action' : 'memory-chip-row'}>
      <span>{label}</span>
      <div>
        {visibleItems.length === 0 ? (
          <em>{empty}</em>
        ) : (
          visibleItems.map((item) => <code key={item}>{item}</code>)
        )}
      </div>
      {action}
    </div>
  )
}
