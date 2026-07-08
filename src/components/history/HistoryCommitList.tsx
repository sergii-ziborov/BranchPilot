import type { CSSProperties, MouseEvent as ReactMouseEvent } from 'react'
import type { CommitSummary } from '../../shared/branchPilot'
import { formatDate } from '../../lib/format'
import type { useVirtualList } from '../../hooks/useVirtualList'
import { HistoryGraphCanvas } from '../HistoryGraphCanvas'
import { HISTORY_GRAPH_TEXT_GUTTER } from '../../lib/historyGraph'
import { historySearchIndexingLabel, type HistorySearchMode } from './historySearchMode'

interface HistoryCommitListProps {
  history: CommitSummary[]
  filteredHistory: CommitSummary[]
  historyLoading: boolean
  historyFilter: string
  historySearchMode: HistorySearchMode
  historyFileIndexing: boolean
  virtualHistory: ReturnType<typeof useVirtualList<CommitSummary>>
  itemHeight: number
  historyGraphWidth: number
  graphTextStarts: number[]
  selectedCommitSha: string | null
  setSelectedCommitSha: (sha: string) => void
  setCommitMenu: (menu: { x: number; y: number; commit: CommitSummary }) => void
  hideHoverCard: () => void
  onGraphPointerMove: (event: ReactMouseEvent<HTMLDivElement>) => void
  scheduleHideHoverCard: () => void
}

export function HistoryCommitList({
  history,
  filteredHistory,
  historyLoading,
  historyFilter,
  historySearchMode,
  historyFileIndexing,
  virtualHistory,
  itemHeight,
  historyGraphWidth,
  graphTextStarts,
  selectedCommitSha,
  setSelectedCommitSha,
  setCommitMenu,
  hideHoverCard,
  onGraphPointerMove,
  scheduleHideHoverCard
}: HistoryCommitListProps) {
  const { containerRef: historyContainerRef, onScroll: historyScroll, window: historyWindow, items: historyItems } = virtualHistory
  const historyIndexingLabel = historySearchIndexingLabel(historySearchMode)

  return (
    <div
      className="history-list virtual-list-viewport"
      ref={historyContainerRef}
      onScroll={(event) => {
        hideHoverCard()
        historyScroll(event)
      }}
      onMouseMove={onGraphPointerMove}
      onMouseLeave={scheduleHideHoverCard}
    >
      {history.length === 0 ? (
        <div className="quiet-box">{historyLoading ? 'Loading commits.' : 'No commits found.'}</div>
      ) : filteredHistory.length === 0 ? (
        <div className="quiet-box">
          {historyFileIndexing && historySearchMode !== 'commit' && historyFilter
            ? historyIndexingLabel
            : 'No commits match this search.'}
        </div>
      ) : (
        <div
          className="virtual-list-spacer history-list-spacer"
          style={{ height: historyWindow.totalHeight, '--history-graph-width': `${historyGraphWidth}px` } as CSSProperties}
        >
          <HistoryGraphCanvas
            commits={filteredHistory}
            width={historyGraphWidth}
            rowHeight={itemHeight}
            totalHeight={historyWindow.totalHeight}
          />
          {historyItems.map(({ item: commit, index }) => (
            <div
              className="virtual-list-item"
              key={commit.sha}
              style={{ transform: `translateY(${index * itemHeight}px)` }}
            >
              <button
                className={selectedCommitSha === commit.sha ? 'history-row has-graph selected' : 'history-row has-graph'}
                style={{
                  '--history-graph-width': `${historyGraphWidth}px`,
                  '--history-graph-text-start': `${graphTextStarts[index] ?? historyGraphWidth + HISTORY_GRAPH_TEXT_GUTTER}px`,
                  '--history-row-height': `${itemHeight}px`
                } as CSSProperties}
                type="button"
                onClick={() => setSelectedCommitSha(commit.sha)}
                onContextMenu={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  setCommitMenu({ x: event.clientX, y: event.clientY, commit })
                }}
              >
                <strong>{commit.subject || '(no subject)'}</strong>
                <span>
                  {commit.shortSha} · {commit.authorName} · {formatDate(commit.authoredAt)}
                </span>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
