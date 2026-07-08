import { useEffect, useRef } from 'react'
import { ListFilter, Search, X } from 'lucide-react'
import { historySearchIndexingLabel, type HistorySearchMode } from './historySearchMode'

export type { HistorySearchMode } from './historySearchMode'

interface HistorySearchBarProps {
  historyFilter: string
  setHistoryFilter: (value: string) => void
  historySearchMode: HistorySearchMode
  setHistorySearchMode: (mode: HistorySearchMode) => void
  historyFileIndexing: boolean
}

export function HistorySearchBar({
  historyFilter,
  setHistoryFilter,
  historySearchMode,
  setHistorySearchMode,
  historyFileIndexing
}: HistorySearchBarProps) {
  const historySearchFilterRef = useRef<HTMLDetailsElement>(null)
  const historySearchModeLabel =
    historySearchMode === 'commit' ? 'Commit' :
      historySearchMode === 'files' ? 'Files' :
        historySearchMode === 'changes' ? 'Changes' : 'All'
  const historyIndexingLabel = historySearchIndexingLabel(historySearchMode)
  const closeHistorySearchFilter = () => {
    if (historySearchFilterRef.current) historySearchFilterRef.current.open = false
  }

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (!historySearchFilterRef.current?.contains(target)) closeHistorySearchFilter()
    }

    window.addEventListener('pointerdown', onPointerDown)
    return () => window.removeEventListener('pointerdown', onPointerDown)
  }, [])

  return (
    <div className="list-filter-bar">
      <details className="changes-actions-menu search-filter-menu" ref={historySearchFilterRef}>
        <summary title="Search scope" aria-label="Search scope">
          <ListFilter size={16} />
          {historySearchModeLabel}
        </summary>
        <div className="changes-actions-popover search-filter-popover">
          <button
            type="button"
            className={historySearchMode === 'commit' ? 'active' : undefined}
            title="Search commit message, SHA, author, and date"
            onClick={() => {
              setHistorySearchMode('commit')
              closeHistorySearchFilter()
            }}
          >
            Commit
          </button>
          <button
            type="button"
            className={historySearchMode === 'files' ? 'active' : undefined}
            title="Search files changed by commits"
            onClick={() => {
              setHistorySearchMode('files')
              closeHistorySearchFilter()
            }}
          >
            Files
          </button>
          <button
            type="button"
            className={historySearchMode === 'changes' ? 'active' : undefined}
            title="Search added and removed lines in commit diffs"
            onClick={() => {
              setHistorySearchMode('changes')
              closeHistorySearchFilter()
            }}
          >
            Changes
          </button>
          <button
            type="button"
            className={historySearchMode === 'all' ? 'active' : undefined}
            title="Search commits, changed files, and changed lines"
            onClick={() => {
              setHistorySearchMode('all')
              closeHistorySearchFilter()
            }}
          >
            All
          </button>
        </div>
      </details>
      <label className="list-filter-input" htmlFor="history-filter">
        <Search size={16} />
        <input
          id="history-filter"
          value={historyFilter}
          onChange={(event) => setHistoryFilter(event.target.value)}
          placeholder="Search commits"
        />
      </label>
      {historyFileIndexing && historySearchMode !== 'commit' && historyFilter && <span>{historyIndexingLabel}</span>}
      {historyFilter && (
        <button type="button" className="secondary" onClick={() => setHistoryFilter('')}>
          <X size={15} />
          Clear
        </button>
      )}
    </div>
  )
}
