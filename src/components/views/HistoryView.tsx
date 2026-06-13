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
            {virtualRangeLabel(virtualHistory.window, filteredHistory.length)}
          </span>
          {historyFilter && (
            <button type="button" className="secondary" onClick={() => setHistoryFilter('')}>
              <X size={15} />
              Clear
            </button>
          )}
        </div>

        <div className="history-list virtual-list-viewport" ref={virtualHistory.containerRef} onScroll={virtualHistory.onScroll}>
          {history.length === 0 ? (
            <div className="quiet-box">{historyLoading ? 'Loading commits.' : 'No commits found.'}</div>
          ) : filteredHistory.length === 0 ? (
            <div className="quiet-box">No commits match this search.</div>
          ) : (
            <div className="virtual-list-spacer" style={{ height: virtualHistory.window.totalHeight }}>
              {virtualHistory.items.map(({ item: commit, index }) => (
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

      <div className="diff-panel">
        <div className="panel-heading">
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
                className="secondary"
                onClick={() => openExternalLink(selectedCommitProviderUrl, 'Commit link')}
                disabled={busy}
              >
                <ExternalLink size={17} />
                Open commit
              </button>
            )}
            <button
              type="button"
              onClick={() => applyCommitOperation('cherry-pick')}
              disabled={!commitDetails || busy || Boolean(snapshot?.status.counts.conflicted) || snapshot?.status.merge.operation !== 'none'}
            >
              <GitCommitHorizontal size={17} />
              Cherry-pick
            </button>
            <button
              className="danger-button"
              type="button"
              onClick={() => applyCommitOperation('revert')}
              disabled={!commitDetails || busy || Boolean(snapshot?.status.counts.conflicted) || snapshot?.status.merge.operation !== 'none'}
            >
              <Trash2 size={17} />
              Revert
            </button>
          </div>
        </div>

        {commitDetails?.body && <div className="commit-body">{commitDetails.body}</div>}
        {commitDetails && (
          <div className="commit-branch-strip">
            <span>Contained in</span>
            <div>
              {commitDetails.containingBranches.length === 0 ? (
                <strong>No local branches</strong>
              ) : (
                commitDetails.containingBranches.map((branch) => (
                  <strong key={branch}>{branch}</strong>
                ))
              )}
            </div>
          </div>
        )}

        <div className="commit-file-grid">
          <div className="commit-file-list">
            {commitDetails?.files.length === 0 && <div className="quiet-box">No changed files.</div>}
            {commitDetails?.files.map((file) => (
              <button
                className={selectedCommitFilePath === file.path ? 'commit-file-row selected' : 'commit-file-row'}
                type="button"
                key={`${file.rawStatus}-${file.path}-${file.originalPath ?? ''}`}
                onClick={() => commitDetails && loadCommitFileDiff(commitDetails.sha, file.path)}
              >
                <span className={`file-status status-${file.status}`}>{fileStatusToken(file.status)}</span>
                <span className="file-name">{file.path}</span>
              </button>
            ))}
          </div>
          <DiffPreview diff={commitFileDiff} />
        </div>
      </div>
    </section>
  )
}
