import { ExternalLink, GitCommitHorizontal, RefreshCcw, Search, Trash2, X } from 'lucide-react'
import type { CommitDetails, CommitSummary, DiffResult, RepositorySnapshot } from '../../shared/branchPilot'
import { getProviderCommitUrl } from '../../shared/providerRemote'
import { virtualRangeLabel } from '../../shared/virtualList'
import { formatDate } from '../../lib/format'
import { fileStatusToken } from '../../lib/fileChangeLabels'
import { useVirtualList } from '../../hooks/useVirtualList'
import { DiffPreview } from '../DiffView'

export function HistoryView({
  snapshot,
  history,
  filteredHistory,
  historyLoading,
  loadHistory,
  busy,
  historyFilter,
  setHistoryFilter,
  virtualHistory,
  itemHeight,
  selectedCommitSha,
  setSelectedCommitSha,
  commitDetails,
  selectedCommitFilePath,
  loadCommitFileDiff,
  commitFileDiff,
  openExternalLink,
  applyCommitOperation
}: {
  snapshot: RepositorySnapshot | null
  history: CommitSummary[]
  filteredHistory: CommitSummary[]
  historyLoading: boolean
  loadHistory: () => void | Promise<void>
  busy: boolean
  historyFilter: string
  setHistoryFilter: (value: string) => void
  virtualHistory: ReturnType<typeof useVirtualList<CommitSummary>>
  itemHeight: number
  selectedCommitSha: string | null
  setSelectedCommitSha: (sha: string) => void
  commitDetails: CommitDetails | null
  selectedCommitFilePath: string | null
  loadCommitFileDiff: (commitSha: string, filePath: string) => void | Promise<void>
  commitFileDiff: DiffResult | null
  openExternalLink: (url: string | undefined, label?: string) => void
  applyCommitOperation: (kind: 'revert' | 'cherry-pick') => void | Promise<void>
}) {
    const selectedCommitProviderUrl = getProviderCommitUrl(snapshot?.summary.remoteUrl, commitDetails?.sha)
  const { containerRef: historyContainerRef, onScroll: historyScroll, window: historyWindow, items: historyItems } = virtualHistory

  return (
    <section className="content-grid history-grid">
      <div className="changes-panel">
        <div className="panel-heading">
          <div>
            <h2>History</h2>
            <p>{history.length >= 200 ? 'Latest 200 commits on this branch.' : `${history.length} commits on this branch.`}</p>
          </div>
          <button type="button" onClick={loadHistory} disabled={busy}>
            <RefreshCcw size={17} />
            Refresh
          </button>
        </div>

        <div className="list-filter-bar">
          <label className="list-filter-input" htmlFor="history-filter">
            <Search size={16} />
            <input
              id="history-filter"
              value={historyFilter}
              onChange={(event) => setHistoryFilter(event.target.value)}
              placeholder="Search commits"
            />
          </label>
          <span>
            {filteredHistory.length} / {history.length}
            {virtualRangeLabel(historyWindow, filteredHistory.length)}
          </span>
          {historyFilter && (
            <button type="button" className="secondary" onClick={() => setHistoryFilter('')}>
              <X size={15} />
              Clear
            </button>
          )}
        </div>

        <div className="history-list virtual-list-viewport" ref={historyContainerRef} onScroll={historyScroll}>
          {history.length === 0 ? (
            <div className="quiet-box">{historyLoading ? 'Loading commits.' : 'No commits found.'}</div>
          ) : filteredHistory.length === 0 ? (
            <div className="quiet-box">No commits match this search.</div>
          ) : (
            <div className="virtual-list-spacer" style={{ height: historyWindow.totalHeight }}>
              {historyItems.map(({ item: commit, index }) => (
                <div
                  className="virtual-list-item"
                  key={commit.sha}
                  style={{ transform: `translateY(${index * itemHeight}px)` }}
                >
                  <button
                    className={selectedCommitSha === commit.sha ? 'history-row selected' : 'history-row'}
                    type="button"
                    onClick={() => setSelectedCommitSha(commit.sha)}
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
      </div>

      <div className="history-detail">
        <div className="history-commit-header">
          <div className="history-commit-headline">
            <div>
              <h2>{commitDetails?.subject ?? 'Commit details'}</h2>
              <p>
                {commitDetails
                  ? `${commitDetails.shortSha} · ${commitDetails.authorName} · ${formatDate(commitDetails.authoredAt)}`
                  : 'Select a commit'}
              </p>
            </div>
            <div className="panel-actions">
              {selectedCommitProviderUrl && (
                <button
                  type="button"
                  className="secondary icon-button"
                  title="Open commit in provider"
                  aria-label="Open commit in provider"
                  onClick={() => openExternalLink(selectedCommitProviderUrl, 'Commit link')}
                  disabled={busy}
                >
                  <ExternalLink size={17} />
                </button>
              )}
              <button
                className="icon-button"
                type="button"
                title="Cherry-pick commit"
                aria-label="Cherry-pick commit"
                onClick={() => applyCommitOperation('cherry-pick')}
                disabled={!commitDetails || busy || Boolean(snapshot?.status.counts.conflicted) || snapshot?.status.merge.operation !== 'none'}
              >
                <GitCommitHorizontal size={17} />
              </button>
              <button
                className="danger-button icon-button"
                type="button"
                title="Revert commit"
                aria-label="Revert commit"
                onClick={() => applyCommitOperation('revert')}
                disabled={!commitDetails || busy || Boolean(snapshot?.status.counts.conflicted) || snapshot?.status.merge.operation !== 'none'}
              >
                <Trash2 size={17} />
              </button>
            </div>
          </div>

          {commitDetails?.body && <div className="commit-body">{commitDetails.body}</div>}
          {commitDetails && commitDetails.containingBranches.length > 0 && (
            <div className="commit-branch-strip">
              <span>Contained in</span>
              <div>
                {commitDetails.containingBranches.map((branch) => (
                  <strong key={branch}>{branch}</strong>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="history-detail-grid">
          <div className="commit-file-column">
            <div className="commit-file-list-heading">
              {commitDetails ? `${commitDetails.files.length} changed file${commitDetails.files.length === 1 ? '' : 's'}` : 'Files'}
            </div>
            <div className="commit-file-list">
              {commitDetails && commitDetails.files.length === 0 && <div className="quiet-box">No changed files.</div>}
              {commitDetails?.files.map((file) => (
                <button
                  className={selectedCommitFilePath === file.path ? 'commit-file-row selected' : 'commit-file-row'}
                  type="button"
                  key={`${file.rawStatus}-${file.path}-${file.originalPath ?? ''}`}
                  onClick={() => commitDetails && loadCommitFileDiff(commitDetails.sha, file.path)}
                  title={file.path}
                >
                  <span className={`file-status status-${file.status}`}>{fileStatusToken(file.status)}</span>
                  <span className="file-name">{file.path}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="commit-diff-column">
            <DiffPreview diff={commitFileDiff} />
          </div>
        </div>
      </div>
    </section>
  )
}
