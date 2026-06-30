import { useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from 'react'
import { Code2, Copy, ExternalLink, Eye, GitCommitHorizontal, ListFilter, RotateCcw, Search, Trash2, X } from 'lucide-react'
import type { BranchPilotApi, CommitCard, CommitDetails, CommitSummary, DiffResult, ImagePreview, RepositorySnapshot } from '../../shared/branchPilot'
import { getProviderCommitUrl } from '../../shared/providerRemote'
import { formatDate } from '../../lib/format'
import type { ViewMode } from '../../lib/viewMode'
import { useVirtualList } from '../../hooks/useVirtualList'
import { useHistoryContextMenus } from '../../hooks/useHistoryContextMenus'
import { useHistoryFilePreview } from '../../hooks/useHistoryFilePreview'
import { ViewSwitch } from '../ViewSwitch'
import { useWorkflowPaneResize } from '../../hooks/useWorkflowPaneResize'
import { HistoryGraphCanvas } from '../HistoryGraphCanvas'
import { CommitHoverCard, type CommitHoverCardAnchor } from '../CommitHoverCard'
import { SignalStatus } from '../SignalStatus'
import { HistoryCommitFilesPanel } from '../history/HistoryCommitFilesPanel'
import { HistoryCommitPreviewWorkspace } from '../history/HistoryCommitPreviewWorkspace'
import {
  HISTORY_GRAPH_TEXT_GUTTER,
  buildHistoryGraphModel,
  historyGraphWidth as getHistoryGraphWidth,
  historyGraphTextStarts,
  hitHistoryGraphNode
} from '../../lib/historyGraph'

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
  commitDetailsLoading,
  selectedCommitFilePath,
  loadCommitFileDiff,
  commitFileDiff,
  commitFileDiffLoading,
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
  commitDetailsLoading: boolean
  selectedCommitFilePath: string | null
  loadCommitFileDiff: (commitSha: string, filePath: string) => void | Promise<void>
  commitFileDiff: DiffResult | null
  commitFileDiffLoading: boolean
  openExternalLink: (url: string | undefined, label?: string) => void
  applyCommitOperation: (kind: 'revert' | 'cherry-pick' | 'reset', commitSha?: string) => void | Promise<void>
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
  const historyGraphWidth = useMemo(() => getHistoryGraphWidth(filteredHistory), [filteredHistory])
  const historyDetailLoading = commitDetailsLoading
  const { filePreview, setFilePreview, openCommitFilePreview } = useHistoryFilePreview({ api, currentRepoPath, commitDetails })
  const closeHistorySearchFilter = () => {
    if (historySearchFilterRef.current) historySearchFilterRef.current.open = false
  }

  // Commit dots: hover hit-test against the graph model to show a GitLens-style card.
  const graphModel = useMemo(() => buildHistoryGraphModel(filteredHistory, itemHeight), [filteredHistory, itemHeight])
  const graphTextStarts = useMemo(
    () => historyGraphTextStarts(graphModel, filteredHistory.length, itemHeight),
    [filteredHistory, graphModel, itemHeight]
  )
  const [hoverCardAnchor, setHoverCardAnchor] = useState<CommitHoverCardAnchor | null>(null)
  const [hoverCard, setHoverCard] = useState<CommitCard | null>(null)
  const [hoverAvatarBroken, setHoverAvatarBroken] = useState(false)
  const hoverCardCacheRef = useRef(new Map<string, CommitCard>())
  const hoverShowTimerRef = useRef<number | null>(null)
  const hoverHideTimerRef = useRef<number | null>(null)
  const hoverPendingShaRef = useRef<string | null>(null)
  const hoverActiveShaRef = useRef<string | null>(null)
  const hoverOverCardRef = useRef(false)
  const hoverCardProviderUrl = getProviderCommitUrl(snapshot?.summary.remoteUrl, hoverCard?.sha)

  const hideHoverCard = () => {
    if (hoverShowTimerRef.current) window.clearTimeout(hoverShowTimerRef.current)
    if (hoverHideTimerRef.current) window.clearTimeout(hoverHideTimerRef.current)
    hoverShowTimerRef.current = null
    hoverHideTimerRef.current = null
    hoverPendingShaRef.current = null
    hoverActiveShaRef.current = null
    setHoverCardAnchor(null)
    setHoverCard(null)
    setHoverAvatarBroken(false)
  }

  const scheduleHideHoverCard = () => {
    if (hoverHideTimerRef.current) window.clearTimeout(hoverHideTimerRef.current)
    hoverHideTimerRef.current = window.setTimeout(() => {
      if (!hoverOverCardRef.current) hideHoverCard()
    }, 220)
  }

  const loadHoverCard = (sha: string) => {
    const cached = hoverCardCacheRef.current.get(sha)
    if (cached) {
      setHoverCard(cached)
      return
    }
    if (!api || !currentRepoPath || typeof api.getCommitCard !== 'function') return
    void api
      .getCommitCard({ repoPath: currentRepoPath, commitSha: sha })
      .then((result) => {
        if (!result.ok) return
        hoverCardCacheRef.current.set(sha, result.data)
        if (hoverActiveShaRef.current === sha) setHoverCard(result.data)
      })
      .catch(() => {})
  }

  const handleGraphPointerMove = (event: ReactMouseEvent<HTMLDivElement>) => {
    const container = event.currentTarget
    const rect = container.getBoundingClientRect()
    const contentX = event.clientX - rect.left + container.scrollLeft
    const contentY = event.clientY - rect.top + container.scrollTop

    const missed = () => {
      hoverPendingShaRef.current = null
      if (hoverShowTimerRef.current) {
        window.clearTimeout(hoverShowTimerRef.current)
        hoverShowTimerRef.current = null
      }
      if (hoverCardAnchor) scheduleHideHoverCard()
    }

    if (contentX > historyGraphWidth + 6) {
      missed()
      return
    }
    const node = hitHistoryGraphNode(graphModel, itemHeight, contentX, contentY)
    if (!node?.sha) {
      missed()
      return
    }
    if (hoverCardAnchor?.sha === node.sha || hoverPendingShaRef.current === node.sha) return

    if (hoverHideTimerRef.current) {
      window.clearTimeout(hoverHideTimerRef.current)
      hoverHideTimerRef.current = null
    }
    if (hoverShowTimerRef.current) window.clearTimeout(hoverShowTimerRef.current)
    const sha = node.sha
    const anchorX = event.clientX
    const anchorY = event.clientY
    hoverPendingShaRef.current = sha
    hoverShowTimerRef.current = window.setTimeout(() => {
      hoverPendingShaRef.current = null
      hoverActiveShaRef.current = sha
      setHoverAvatarBroken(false)
      setHoverCardAnchor({ sha, x: anchorX, y: anchorY })
      setHoverCard(hoverCardCacheRef.current.get(sha) ?? null)
      loadHoverCard(sha)
    }, 280)
  }

  useEffect(() => () => {
    if (hoverShowTimerRef.current) window.clearTimeout(hoverShowTimerRef.current)
    if (hoverHideTimerRef.current) window.clearTimeout(hoverHideTimerRef.current)
  }, [])

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

  const {
    fileMenu,
    setFileMenu,
    commitMenu,
    setCommitMenu,
    openInEditorFromMenu,
    copyPathFromMenu,
    copyNameFromMenu,
    copyCommitShaFromMenu,
    copyCommitSubjectFromMenu,
    applyCommitOperationFromMenu
  } = useHistoryContextMenus({ api, currentRepoPath, setSelectedCommitSha, applyCommitOperation })

  const copySelectedCommitSha = () => {
    if (!commitDetails) return
    void navigator.clipboard.writeText(commitDetails.sha)
  }

  const openPreviewFromMenu = () => {
    const path = fileMenu?.path
    setFileMenu(null)
    if (path) openCommitFilePreview(path)
  }

  const openSelectedCommitPreview = () => {
    if (!commitDetails) return
    const path =
      selectedCommitFilePath ??
      commitDetails.files.find((file) => file.status !== 'deleted')?.path ??
      commitDetails.files[0]?.path
    if (path) openCommitFilePreview(path)
  }

  if (filePreview && commitDetails) {
    return (
      <section className="history-preview-screen">
        <HistoryCommitPreviewWorkspace
          api={api}
          currentRepoPath={currentRepoPath}
          snapshot={snapshot}
          history={history}
          commitDetails={commitDetails}
          preview={filePreview}
          onBack={() => setFilePreview(null)}
          openCommitFilePreview={openCommitFilePreview}
        />
      </section>
    )
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

        <div
          className="history-list virtual-list-viewport"
          ref={historyContainerRef}
          onScroll={(event) => {
            hideHoverCard()
            historyScroll(event)
          }}
          onMouseMove={handleGraphPointerMove}
          onMouseLeave={scheduleHideHoverCard}
        >
          {history.length === 0 ? (
            <div className="quiet-box">{historyLoading ? 'Loading commits.' : 'No commits found.'}</div>
          ) : filteredHistory.length === 0 ? (
            <div className="quiet-box">No commits match this search.</div>
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

      <div className={historyDetailLoading ? 'history-detail is-loading' : 'history-detail'} aria-busy={historyDetailLoading}>
        <div className="history-commit-header">
          <div className="history-commit-headline">
            <div>
              <h2>{commitDetails?.subject ?? 'Commit details'}</h2>
              <p>
                {commitDetails
                  ? `${commitDetails.shortSha} · ${commitDetails.authorName} · ${formatDate(commitDetails.authoredAt)}`
                  : 'Select a commit'}
              </p>
              {commitDetails && (
                <button type="button" className="history-commit-inline-copy" title="Copy full commit SHA" aria-label="Copy full commit SHA" onClick={copySelectedCommitSha}>
                  <Copy size={13} />
                  Copy SHA
                </button>
              )}
            </div>
            <div className="panel-actions">
              {commitDetails && commitDetails.files.length > 0 && (
                <div className="diff-file-actions" aria-label="History commit preview actions">
                  <button
                    type="button"
                    className="preview"
                    title="Open this commit in BranchPilot preview"
                    onClick={openSelectedCommitPreview}
                    disabled={!api || !currentRepoPath}
                  >
                    <Eye size={15} />
                    Preview
                  </button>
                </div>
              )}
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
                type="button"
                className="secondary icon-button"
                title="Copy full commit SHA"
                aria-label="Copy full commit SHA"
                onClick={copySelectedCommitSha}
                disabled={!commitDetails}
              >
                <Copy size={17} />
              </button>
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

        {filePreview && commitDetails ? (
          <HistoryCommitPreviewWorkspace
            api={api}
            currentRepoPath={currentRepoPath}
            snapshot={snapshot}
            history={history}
            commitDetails={commitDetails}
            preview={filePreview}
            onBack={() => setFilePreview(null)}
            openCommitFilePreview={openCommitFilePreview}
          />
        ) : (
          <HistoryCommitFilesPanel
            commitDetails={commitDetails}
            selectedCommitFilePath={selectedCommitFilePath}
            commitFileDiff={commitFileDiff}
            commitFileDiffLoading={commitFileDiffLoading}
            commitImagePreview={commitImagePreview}
            loadCommitFileDiff={loadCommitFileDiff}
            openCommitFilePreview={openCommitFilePreview}
            setFileMenu={setFileMenu}
          />
        )}
        {historyDetailLoading && (
          <SignalStatus
            className="history-detail-loading"
            label="Resolving commit"
            detail={selectedCommitSha?.slice(0, 7) ?? 'history'}
          />
        )}
      </div>

      {fileMenu && (
        <div className="context-menu" role="menu" style={{ top: fileMenu.y, left: fileMenu.x }}>
          <button type="button" role="menuitem" title="Preview this file as it exists in the selected commit" onClick={openPreviewFromMenu} disabled={!api || !commitDetails}>
            <Eye size={15} />
            Preview at commit
          </button>
          <button type="button" role="menuitem" title="Open the current working-tree file in your editor" onClick={openInEditorFromMenu} disabled={busy || !api}>
            <Code2 size={15} />
            Open current file in editor
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

      {commitMenu && (
        <div className="context-menu" role="menu" style={{ top: commitMenu.y, left: commitMenu.x }}>
          <button type="button" role="menuitem" title="Copy the full commit SHA" onClick={copyCommitShaFromMenu}>
            <Copy size={15} />
            Copy full SHA
          </button>
          <button type="button" role="menuitem" title="Copy the commit subject" onClick={copyCommitSubjectFromMenu}>
            <Copy size={15} />
            Copy subject
          </button>
          <hr />
          <button
            type="button"
            role="menuitem"
            title="Cherry-pick this commit onto the current branch"
            onClick={() => applyCommitOperationFromMenu('cherry-pick')}
            disabled={busy || Boolean(snapshot?.status.counts.conflicted) || snapshot?.status.merge.operation !== 'none'}
          >
            <GitCommitHorizontal size={15} />
            Cherry-pick commit
          </button>
          <button
            type="button"
            role="menuitem"
            className="danger"
            title="Create a new commit that reverts this commit"
            onClick={() => applyCommitOperationFromMenu('revert')}
            disabled={busy || Boolean(snapshot?.status.counts.conflicted) || snapshot?.status.merge.operation !== 'none'}
          >
            <RotateCcw size={15} />
            Revert commit
          </button>
          <button
            type="button"
            role="menuitem"
            className="danger"
            title="Move the current branch to this commit and reset the working tree"
            onClick={() => applyCommitOperationFromMenu('reset')}
            disabled={busy || Boolean(snapshot?.status.counts.conflicted) || snapshot?.status.merge.operation !== 'none'}
          >
            <Trash2 size={15} />
            Reset branch to commit
          </button>
        </div>
      )}

      {hoverCardAnchor && (
        <CommitHoverCard
          anchor={hoverCardAnchor}
          card={hoverCard}
          providerUrl={hoverCardProviderUrl ?? null}
          avatarBroken={hoverAvatarBroken}
          onAvatarError={() => setHoverAvatarBroken(true)}
          onMouseEnter={() => {
            hoverOverCardRef.current = true
            if (hoverHideTimerRef.current) {
              window.clearTimeout(hoverHideTimerRef.current)
              hoverHideTimerRef.current = null
            }
          }}
          onMouseLeave={() => {
            hoverOverCardRef.current = false
            hideHoverCard()
          }}
          onOpenProvider={() => hoverCardProviderUrl && openExternalLink(hoverCardProviderUrl, 'Commit link')}
        />
      )}
    </section>
  )
}
