import type { ContributionGraph } from '../shared/branchPilot'

function cellLevel(count: number, max: number): number {
  if (count <= 0) return 0
  if (max <= 0) return 1
  const ratio = count / max
  if (ratio > 0.66) return 4
  if (ratio > 0.33) return 3
  if (ratio > 0.1) return 2
  return 1
}

interface ContributionHeatmapProps {
  graph: ContributionGraph | null
  selectedDate?: string
  onSelectDate?: (date: string) => void
}

/** GitHub-style commit activity heatmap for the last ~53 weeks. */
export function ContributionHeatmap({ graph, selectedDate, onSelectDate }: ContributionHeatmapProps) {
  if (!graph || graph.days.length === 0) {
    return <div className="quiet-box">No commit activity found yet.</div>
  }

  const max = graph.days.reduce((peak, day) => Math.max(peak, day.count), 0)
  const interactive = typeof onSelectDate === 'function'

  return (
    <div className={`heatmap${interactive ? ' heatmap-interactive' : ''}`}>
      <div className="heatmap-grid" role={interactive ? 'grid' : 'img'} aria-label={`${graph.total} commits in the last year`}>
        {graph.days.map((day) => {
          const dateKey = day.date.slice(0, 10)
          const selected = selectedDate === dateKey
          const className = `heatmap-cell level-${cellLevel(day.count, max)}${selected ? ' selected' : ''}`
          const title = `${day.count} commit${day.count === 1 ? '' : 's'} - ${dateKey}`

          return interactive ? (
            <button
              type="button"
              key={day.date}
              className={`${className} heatmap-cell-button`}
              title={title}
              aria-label={`Select ${dateKey}, ${day.count} commit${day.count === 1 ? '' : 's'}`}
              aria-pressed={selected}
              onClick={() => onSelectDate(dateKey)}
            />
          ) : (
            <span key={day.date} className={className} title={title} />
          )
        })}
      </div>
      <div className="heatmap-legend">
        <span className="heatmap-total">{graph.total} commits in the last year</span>
        <div className="heatmap-scale">
          <span>Less</span>
          <i className="heatmap-cell level-0" />
          <i className="heatmap-cell level-1" />
          <i className="heatmap-cell level-2" />
          <i className="heatmap-cell level-3" />
          <i className="heatmap-cell level-4" />
          <span>More</span>
        </div>
      </div>
    </div>
  )
}
