import type { ViewMode } from '../lib/viewMode'

/** GitHub-Desktop-style segmented Changes | History switch at the top of the left column. */
export function ViewSwitch({
  viewMode,
  setViewMode,
  changedCount
}: {
  viewMode: ViewMode
  setViewMode: (mode: ViewMode) => void
  changedCount: number
}) {
  const changesActive = viewMode === 'changes' || viewMode === 'review'
  const historyActive = viewMode === 'history'
  return (
    <div className="view-switch" role="tablist" aria-label="Changes or History">
      <button
        type="button"
        role="tab"
        aria-selected={changesActive}
        className={changesActive ? 'view-switch-tab active' : 'view-switch-tab'}
        onClick={() => setViewMode('changes')}
      >
        Changes
        {changedCount > 0 && <span className="view-switch-badge">{changedCount}</span>}
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={historyActive}
        className={historyActive ? 'view-switch-tab active' : 'view-switch-tab'}
        onClick={() => setViewMode('history')}
      >
        History
      </button>
    </div>
  )
}
