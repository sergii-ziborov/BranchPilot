import { HistoryView } from '../../views/HistoryView'
import { useController } from '../../../hooks/AppControllerContext'
import { HISTORY_LIST_ITEM_HEIGHT } from '../../../lib/listMetrics'

const api = window.branchPilot

export function HistoryRoute() {
  const {
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
    currentRepoPath,
    setViewMode,
    counts
  } = useController()

  return (
    <HistoryView
      snapshot={snapshot}
      history={history}
      filteredHistory={filteredHistory}
      historyLoading={historyLoading}
      busy={busy}
      historyFilter={historyFilter}
      setHistoryFilter={setHistoryFilter}
      historySearchMode={historySearchMode}
      setHistorySearchMode={setHistorySearchMode}
      historyFileIndexing={historyFileIndexing}
      virtualHistory={virtualHistory}
      itemHeight={HISTORY_LIST_ITEM_HEIGHT}
      selectedCommitSha={selectedCommitSha}
      setSelectedCommitSha={setSelectedCommitSha}
      commitDetails={commitDetails}
      commitDetailsLoading={commitDetailsLoading}
      selectedCommitFilePath={selectedCommitFilePath}
      loadCommitFileDiff={loadCommitFileDiff}
      commitFileDiff={commitFileDiff}
      commitFileDiffLoading={commitFileDiffLoading}
      openExternalLink={openExternalLink}
      applyCommitOperation={applyCommitOperation}
      api={api}
      currentRepoPath={currentRepoPath}
      setViewMode={setViewMode}
      changedCount={counts?.changed ?? 0}
    />
  )
}
