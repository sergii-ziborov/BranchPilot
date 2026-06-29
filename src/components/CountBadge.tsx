import type { ReactNode } from 'react'

/** Rounded numeric count pill (tabular-nums) with a tinted, tone-based background. */
export function CountBadge({
  count,
  tone = 'default'
}: {
  count: number | ReactNode
  tone?: 'default' | 'info' | 'warn' | 'danger' | 'muted' | 'accent'
}) {
  const className = tone === 'default' ? 'dash-count' : `dash-count tone-${tone}`
  return <span className={className}>{count}</span>
}
