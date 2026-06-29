import type { ReviewSeverity } from '../shared/branchPilot'

const SEVERITY_ORDER: ReviewSeverity[] = ['critical', 'high', 'medium', 'low', 'info']

/** Horizontal strip of color-coded severity cells (label over bold count) for a review summary. */
export function SeverityCountStrip({
  counts
}: {
  counts: { severity: ReviewSeverity; count: number }[]
}) {
  const countBySeverity = new Map(counts.map(({ severity, count }) => [severity, count]))
  return (
    <div className="severity-strip">
      {SEVERITY_ORDER.map((severity) => (
        <div className={`severity-count severity-${severity}`} key={severity}>
          <span>{severity}</span>
          <strong>{countBySeverity.get(severity) ?? 0}</strong>
        </div>
      ))}
    </div>
  )
}
