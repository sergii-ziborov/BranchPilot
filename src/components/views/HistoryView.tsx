import { useEffect, useMemo, useState } from 'react'
import type { BranchPilotApi, CommitDetails, CommitSummary, DiffResult, ImagePreview, RepositorySnapshot } from '../../shared/branchPilot'
import { getProviderCommitUrl } from '../../shared/providerRemote'
import type { ViewMode } from '../../lib/viewMode'
import { useVirtualList } from '../../hooks/useVirtualList'
import { useHistoryContextMenus } from '../../hooks/useHistoryContextMenus'
import { useHistoryFilePreview } from '../../hooks/useHistoryFilePreview'
import { ViewSwitch } from '../ViewSwitch'
import { useWorkflowPaneResize } from '../../hooks/useWorkflowPaneResize'
import { CommitHoverCard } from '../CommitHoverCard'
import { SignalStatus } from '../SignalStatus'
import { HistoryCommitFilesPanel } from '../history/HistoryCommitFilesPanel'
import { HistoryCommitPreviewWorkspace } from '../history/HistoryCommitPreviewWorkspace'
import { HistorySearchBar, type HistorySearchMode } from '../history/HistorySearchBar'
import { HistoryCommitList } from '../history/HistoryCommitList'
import { HistoryCommitDetailHeader } from '../history/HistoryCommitDetailHeader'
import { HistoryCommitContextMenu, HistoryFileContextMenu } from '../history/HistoryContextMenus'
import { useHistoryHoverCard } from '../history/useHistoryHoverCard'
import {
  buildHistoryGraphModel,
  historyGraphWidth as getHistoryGraphWidth,
  historyGraphTextStarts
} from '../../lib/historyGraph'

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
  applyCommitOperation: (kind: 'revert' | 'cherry-pick' | 'reset' | 'reset-hard', commitSha?: string) => void | Promise<void>
  api: BranchPilotApi | undefined
  currentRepoPath: string | undefined
  setViewMode: (mode: ViewMode) => void
  changedCount: number
}) {
  const selectedCommitProviderUrl = getProviderCommitUrl(snapshot?.summary.remoteUrl, commitDetails?.sha)
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
  const historyGraphWidth = useMemo(() => getHistoryGraphWidth(filteredHistory), [filteredHistory])
  const historyDetailLoading = commitDetailsLoading
  const { filePreview, setFilePreview, openCommitFilePreview } = useHistoryFilePreview({ api, currentRepoPath, commitDetails })

  const graphModel = useMemo(() => buildHistoryGraphModel(filteredHistory, itemHeight), [filteredHistory, itemHeight])
  const graphTextStarts = useMemo(
    () => historyGraphTextStarts(graphModel, filteredHistory.length, itemHeight),
    [filteredHistory, graphModel, itemHeight]
  )
  const {
    hoverCardAnchor,
    hoverCard,
    hoverAvatarBroken,
    setHoverAvatarBroken,
    hideHoverCard,
    scheduleHideHoverCard,
    handleGraphPointerMove,
    handleHoverCardMouseEnter,
    handleHoverCardMouseLeave
  } = useHistoryHoverCard({ api, currentRepoPath, graphModel, itemHeight, historyGraphWidth })
  const hoverCardProviderUrl = getProviderCommitUrl(snapshot?.summary.remoteUrl, hoverCard?.sha)

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

  const openPreviewFromMenu = () => {
    const path = fileMenu?.path
    setFileMenu(null)
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

        <HistorySearchBar
          historyFilter={historyFilter}
          setHistoryFilter={setHistoryFilter}
          historySearchMode={historySearchMode}
          setHistorySearchMode={setHistorySearchMode}
          historyFileIndexing={historyFileIndexing}
        />

        <HistoryCommitList
          history={history}
          filteredHistory={filteredHistory}
          historyLoading={historyLoading}
          historyFilter={historyFilter}
          historySearchMode={historySearchMode}
          historyFileIndexing={historyFileIndexing}
          virtualHistory={virtualHistory}
          itemHeight={itemHeight}
          historyGraphWidth={historyGraphWidth}
          graphTextStarts={graphTextStarts}
          selectedCommitSha={selectedCommitSha}
          setSelectedCommitSha={setSelectedCommitSha}
          setCommitMenu={setCommitMenu}
          hideHoverCard={hideHoverCard}
          onGraphPointerMove={handleGraphPointerMove}
          scheduleHideHoverCard={scheduleHideHoverCard}
        />
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
        <HistoryCommitDetailHeader
          snapshot={snapshot}
          commitDetails={commitDetails}
          busy={busy}
          api={api}
          currentRepoPath={currentRepoPath}
          selectedCommitFilePath={selectedCommitFilePath}
          selectedCommitProviderUrl={selectedCommitProviderUrl}
          openExternalLink={openExternalLink}
          applyCommitOperation={applyCommitOperation}
          openCommitFilePreview={openCommitFilePreview}
        />

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
        <HistoryFileContextMenu
          menu={fileMenu}
          busy={busy}
          api={api}
          commitDetails={commitDetails}
          openPreviewFromMenu={openPreviewFromMenu}
          openInEditorFromMenu={openInEditorFromMenu}
          copyPathFromMenu={copyPathFromMenu}
          copyNameFromMenu={copyNameFromMenu}
        />
      )}

      {commitMenu && (
        <HistoryCommitContextMenu
          menu={commitMenu}
          busy={busy}
          snapshot={snapshot}
          copyCommitShaFromMenu={copyCommitShaFromMenu}
          copyCommitSubjectFromMenu={copyCommitSubjectFromMenu}
          applyCommitOperationFromMenu={applyCommitOperationFromMenu}
        />
      )}

      {hoverCardAnchor && (
        <CommitHoverCard
          anchor={hoverCardAnchor}
          card={hoverCard}
          providerUrl={hoverCardProviderUrl ?? null}
          avatarBroken={hoverAvatarBroken}
          onAvatarError={() => setHoverAvatarBroken(true)}
          onMouseEnter={handleHoverCardMouseEnter}
          onMouseLeave={handleHoverCardMouseLeave}
          onOpenProvider={() => hoverCardProviderUrl && openExternalLink(hoverCardProviderUrl, 'Commit link')}
        />
      )}
    </section>
  )
}
