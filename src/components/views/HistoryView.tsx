import { useEffect, useRef, useState } from 'react'
import { Code2, Copy, ExternalLink, GitCommitHorizontal, ListFilter, Search, Trash2, X } from 'lucide-react'
import type { BranchPilotApi, CommitDetails, CommitSummary, DiffResult, ImagePreview, RepositorySnapshot } from '../../shared/branchPilot'
import { getProviderCommitUrl } from '../../shared/providerRemote'
import { formatDate } from '../../lib/format'
import { fileStatusToken } from '../../lib/fileChangeLabels'
import { fileTypeIconForPath } from '../../lib/fileTypeIcons'
import type { ViewMode } from '../../lib/viewMode'
import { useVirtualList } from '../../hooks/useVirtualList'
import { DiffPreview } from '../DiffView'
import { ViewSwitch } from '../ViewSwitch'
import { useWorkflowPaneResize } from '../../hooks/useWorkflowPaneResize'

type HistorySearchMode = 'commit' | 'files' | 'all'

export function HistoryView({
  snapshot,
  history,
  filteredHistory,
  historyLoading,
  busy,
  historyFilter,
  setHistoryFilter,
  historySearchMode,
  setHistorySearchMode,
  historyFileIndexing,
  virtualHistory,
  itemHeight,
  selectedCommitSha,
  setSelectedCommitSha,
  commitDetails,
  selectedCommitFilePath,
  loadCommitFileDiff,
  commitFileDiff,
  openExternalLink,
  applyCommitOperation,
  api,
  currentRepoPath,
  setViewMode,
  changedCount
}: {
  snapshot: RepositorySnapshot | null
  history: CommitSummary[]
  filteredHistory: CommitSummary[]
  historyLoading: boolean
  busy: boolean
  historyFilter: string
  setHistoryFilter: (value: string) => void
  historySearchMode: HistorySearchMode
  setHistorySearchMode: (mode: HistorySearchMode) => void
  historyFileIndexing: boolean
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
  api: BranchPilotApi | undefined
  currentRepoPath: string | undefined
  setViewMode: (mode: ViewMode) => void
  changedCount: number
}) {
  const selectedCommitProviderUrl = getProviderCommitUrl(snapshot?.summary.remoteUrl, commitDetails?.sha)
  const historySearchFilterRef = useRef<HTMLDetailsElement>(null)
  const { containerRef: historyContainerRef, onScroll: historyScroll, window: historyWindow, items: historyItems } = virtualHistory
  const {
    gridRef: splitGridRef,
    paneWidth: historyPaneWidth,
    splitStyle,
    startPaneResize,
    handleSplitKeyDown,
    minPaneWidth,
    maxPaneWidth
  } = useWorkflowPaneResize()

  const [commitImagePreview, setCommitImagePreview] = useState<ImagePreview | null>(null)
  const historySearchModeLabel = historySearchMode === 'commit' ? 'Commit' : historySearchMode === 'files' ? 'Files' : 'All'
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

  useEffect(() => {
    setCommitImagePreview(null)
    if (!commitFileDiff?.binary || !commitDetails?.sha || !selectedCommitFilePath) return
    if (!api || !currentRepoPath || typeof api.getImagePreview !== 'function') return
    let cancelled = false
    void api
      .getImagePreview({ repoPath: currentRepoPath, filePath: selectedCommitFilePath, commitSha: commitDetails.sha })
      .then((result) => {
        if (!cancelled && result.ok) setCommitImagePreview(result.data)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [commitFileDiff, commitDetails?.sha, selectedCommitFilePath, api, currentRepoPath])

  const [fileMenu, setFileMenu] = useState<{ x: number; y: number; path: string } | null>(null)

  useEffect(() => {
    if (!fileMenu) return
    const close = () => setFileMenu(null)
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setFileMenu(null)
    }
    window.addEventListener('click', close)
    window.addEventListener('scroll', close, true)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [fileMenu])

  const openInEditorFromMenu = () => {
    const path = fileMenu?.path
    setFileMenu(null)
    if (!path || !currentRepoPath || !api) return
    void api.openInEditor({ targetPath: `${currentRepoPath}/${path}` })
  }

  const copyPathFromMenu = () => {
    const path = fileMenu?.path
    setFileMenu(null)
    if (!path || !currentRepoPath) return
    void navigator.clipboard.writeText(`${currentRepoPath}/${path}`)
  }

  const copyNameFromMenu = () => {
    const path = fileMenu?.path
    setFileMenu(null)
    if (!path) return
    void navigator.clipboard.writeText(path.split('/').pop() ?? path)
  }

  return (
    <section className="content-grid changes-workflow-grid history-grid" ref={splitGridRef} style={splitStyle}>
      <div className="changes-panel">
        <ViewSwitch viewMode="history" setViewMode={setViewMode} changedCount={changedCount} />

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
                className={historySearchMode === 'all' ? 'active' : undefined}
                title="Search commits and changed files"
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
          {historyFileIndexing && historySearchMode !== 'commit' && historyFilter && <span>Indexing files...</span>}
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

      <div
        className="changes-splitter"
        role="separator"
        aria-label="Resize history and commit detail panes"
        aria-orientation="vertical"
        aria-valuemin={minPaneWidth}
        aria-valuemax={maxPaneWidth}
        aria-valuenow={historyPaneWidth}
        tabIndex={0}
        onPointerDown={startPaneResize}
        onKeyDown={handleSplitKeyDown}
      >
        <span />
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
          {commitDetails && !(commitDetails.containingBranches.length === 1 && commitDetails.containingBranches[0] === snapshot?.summary.currentBranch) && commitDetails.containingBranches.length > 0 && (
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
              {commitDetails?.files.map((file) => {
                const fileTypeIcon = fileTypeIconForPath(file.path)

                return (
                  <button
                    className={selectedCommitFilePath === file.path ? 'commit-file-row selected' : 'commit-file-row'}
                    type="button"
                    key={`${file.rawStatus}-${file.path}-${file.originalPath ?? ''}`}
                    onClick={() => commitDetails && loadCommitFileDiff(commitDetails.sha, file.path)}
                    onContextMenu={(event) => {
                      event.preventDefault()
                      if (commitDetails) loadCommitFileDiff(commitDetails.sha, file.path)
                      setFileMenu({ x: event.clientX, y: event.clientY, path: file.path })
                    }}
                    title={file.path}
                  >
                    <span className={`file-status status-${file.status}`}>{fileStatusToken(file.status)}</span>
                    <span className="file-label">
                      <span className={`file-type-icon file-type-${fileTypeIcon.tone}`} title={fileTypeIcon.title} aria-hidden="true">
                        {fileTypeIcon.label}
                      </span>
                      <span className="file-name">{file.path}</span>
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
          <div className="commit-diff-column">
            <DiffPreview diff={commitFileDiff} imagePreview={commitImagePreview} />
          </div>
        </div>
      </div>

      {fileMenu && (
        <div className="context-menu" role="menu" style={{ top: fileMenu.y, left: fileMenu.x }}>
          <button type="button" role="menuitem" title="Open this file in your editor" onClick={openInEditorFromMenu} disabled={busy || !api}>
            <Code2 size={15} />
            Open in editor
          </button>
          <button type="button" role="menuitem" title="Copy the absolute file path" onClick={copyPathFromMenu}>
            <Copy size={15} />
            Copy path
          </button>
          <button type="button" role="menuitem" title="Copy the file name" onClick={copyNameFromMenu}>
            <Copy size={15} />
            Copy file name
          </button>
        </div>
      )}
    </section>
  )
}
