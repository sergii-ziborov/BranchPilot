import { ChevronDown, ChevronUp } from 'lucide-react'
import type { DiffContextDirection } from './diffViewTypes'

export function DiffContextExpander({
  direction,
  onExpandContext
}: {
  direction: DiffContextDirection
  onExpandContext?: () => void
}) {
  if (!onExpandContext) return null

  const label = direction === 'up' ? 'Show more lines above' : 'Show more lines below'

  return (
    <button type="button" className="diff-context-expander" onClick={onExpandContext} title={label} aria-label={label}>
      {direction === 'up' ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      <span>{label}</span>
    </button>
  )
}
