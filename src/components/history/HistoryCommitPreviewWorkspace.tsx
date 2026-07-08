import { useEffect, useMemo, useState } from 'react'
import type {
  BranchPilotApi,
  CommitDetails,
  CommitSummary,
  RepositorySnapshot
} from '../../shared/branchPilot'
import { formatDate } from '../../lib/format'
import { HistoryFilePreview, type HistoryFilePreviewModel } from './HistoryFilePreview'
import { HistoryFileCompareDiff } from './HistoryFileCompareDiff'
import { HistoryComparePicker } from './HistoryComparePicker'
import { HistoryPreviewFileSidebar } from './HistoryPreviewFileSidebar'
import { collectCompareBranchCandidates } from './historyCompareCandidates'
import { useCommitCompareData } from './useCommitCompareData'
import {
  PREVIEW_SIDEBAR_MAX_WIDTH,
  PREVIEW_SIDEBAR_MIN_WIDTH,
  useHistoryPreviewPanes
} from './useHistoryPreviewPanes'

interface HistoryCommitPreviewWorkspaceProps {
  api: BranchPilotApi | undefined
  currentRepoPath: string | undefined
  snapshot: RepositorySnapshot | null
  history: CommitSummary[]
  commitDetails: CommitDetails
  preview: HistoryFilePreviewModel
  onBack: () => void
  openCommitFilePreview: (filePath: string) => void
}

export function HistoryCommitPreviewWorkspace({
  api,
  currentRepoPath,
  snapshot,
  history,
  commitDetails,
  preview,
  onBack,
  openCommitFilePreview
}: HistoryCommitPreviewWorkspaceProps) {
  const {
    workspaceRef,
    stageRef,
    sidebarWidth,
    primaryPaneWidth,
    workspaceStyle,
    stageStyle,
    startSidebarResize,
    startPrimaryResize,
    handleSidebarResizeKeyDown,
    handlePrimaryResizeKeyDown
  } = useHistoryPreviewPanes()
  const [compareSha, setCompareSha] = useState('')
  const {
    compareDetails,
    compareLoading,
    compareError,
    compareFileContent,
    compareFileLoading,
    compareFileError,
    compareDiff,
    compareDiffLoading,
    compareDiffError
  } = useCommitCompareData({
    api,
    currentRepoPath,
    commitSha: commitDetails.sha,
    filePath: preview.filePath,
    compareSha
  })

  const compareFilePaths = useMemo(
    () => new Set((compareDetails?.files ?? []).map((file) => file.path)),
    [compareDetails]
  )
  const intersectingFiles = useMemo(
    () => (compareSha && compareDetails
      ? commitDetails.files.filter((file) => compareFilePaths.has(file.path))
      : commitDetails.files),
    [commitDetails.files, compareDetails, compareFilePaths, compareSha]
  )
  const allCompareBranchCandidates = useMemo(
    () => collectCompareBranchCandidates(snapshot?.branches, snapshot?.remoteBranches),
    [snapshot?.branches, snapshot?.remoteBranches]
  )
  const selectedCompareSummary = history.find((commit) => commit.sha === compareSha) ?? null
  const selectedCompareBranch = allCompareBranchCandidates.find((branch) => branch.value === compareSha) ?? null
  const selectedFileChangedInCompare = Boolean(compareSha && compareFilePaths.has(preview.filePath))
  const compareTargetLabel = selectedCompareSummary?.shortSha ?? selectedCompareBranch?.label ?? (compareSha ? compareSha.slice(0, 16) : 'Full file at this commit')
  const compareTargetDetail = selectedCompareSummary?.subject ?? selectedCompareBranch?.kind ?? (compareSha ? 'Git revision' : 'Selected commit')

  useEffect(() => {
    if (!compareSha || !compareDetails || compareLoading || compareError) return
    if (intersectingFiles.length === 0 || compareFilePaths.has(preview.filePath)) return

    openCommitFilePreview(intersectingFiles[0].path)
  }, [
    compareDetails,
    compareError,
    compareFilePaths,
    compareLoading,
    compareSha,
    intersectingFiles,
    openCommitFilePreview,
    preview.filePath
  ])

  return (
    <section className={compareSha ? 'history-preview-workspace compare-mode' : 'history-preview-workspace'} ref={workspaceRef} style={workspaceStyle}>
      <HistoryPreviewFileSidebar
        commitShortSha={commitDetails.shortSha}
        compareSha={compareSha}
        compareLoading={compareLoading}
        compareError={compareError}
        compareTargetLabel={compareTargetLabel}
        intersectingFiles={intersectingFiles}
        compareFilePaths={compareFilePaths}
        selectedFilePath={preview.filePath}
        onBack={onBack}
        openCommitFilePreview={openCommitFilePreview}
      />

      <div
        className="history-preview-splitter"
        role="separator"
        aria-label="Resize commit files and preview"
        aria-orientation="vertical"
        aria-valuemin={PREVIEW_SIDEBAR_MIN_WIDTH}
        aria-valuemax={PREVIEW_SIDEBAR_MAX_WIDTH}
        aria-valuenow={sidebarWidth}
        tabIndex={0}
        onPointerDown={startSidebarResize}
        onKeyDown={handleSidebarResizeKeyDown}
      >
        <span />
      </div>

      <div className="history-preview-main">
        <header className="history-preview-header">
          <div>
            <h3>{commitDetails.subject || 'Commit preview'}</h3>
            <p>
              {commitDetails.shortSha} | {commitDetails.authorName} | {formatDate(commitDetails.authoredAt)}
            </p>
          </div>
          <HistoryComparePicker
            history={history}
            selectedCommitSha={commitDetails.sha}
            allBranchCandidates={allCompareBranchCandidates}
            compareSha={compareSha}
            compareTargetLabel={compareTargetLabel}
            compareTargetDetail={compareTargetDetail}
            onChooseCompareTarget={setCompareSha}
          />
        </header>

        {compareSha && (
          <div className="history-preview-compare-status">
            {compareLoading ? (
              <span>Loading compare target...</span>
            ) : compareError ? (
              <span className="danger-text">{compareError}</span>
            ) : (
              <span>
                Comparing against {compareTargetLabel}
                {selectedFileChangedInCompare ? ' | this file changed in both targets' : ' | choose a shared changed file'}
              </span>
            )}
          </div>
        )}

        <div
          className={compareSha ? 'history-preview-stage compare-mode' : 'history-preview-stage'}
          ref={stageRef}
          style={stageStyle}
        >
          {compareSha ? (
            <HistoryFileCompareDiff
              diff={compareDiff}
              loading={compareDiffLoading}
              error={compareDiffError}
              filePath={preview.filePath}
              selectedCommitSha={preview.commitSha}
              selectedLabel={preview.shortSha}
              compareCommitSha={compareSha}
              compareLabel={compareTargetLabel}
              primaryPaneWidth={primaryPaneWidth}
              onCopySelectedContent={() => preview.content && !preview.content.binary && navigator.clipboard.writeText(preview.content.text)}
              onCopyCompareContent={() => compareFileContent && !compareFileContent.binary && navigator.clipboard.writeText(compareFileContent.text)}
              onCopyPath={() => navigator.clipboard.writeText(preview.filePath)}
              onCopySelectedSha={() => navigator.clipboard.writeText(preview.commitSha)}
              onCopyCompareSha={() => navigator.clipboard.writeText(compareSha)}
              selectedCopyDisabled={!preview.content || preview.content.binary || preview.loading}
              compareCopyDisabled={compareFileLoading || Boolean(compareFileError) || !compareFileContent || compareFileContent.binary}
              onResizePointerDown={startPrimaryResize}
              onResizeKeyDown={handlePrimaryResizeKeyDown}
            />
          ) : (
            <section className="history-preview-pane">
              <HistoryFilePreview
                preview={preview}
                onBack={onBack}
                onCopyContent={() => preview.content && !preview.content.binary && navigator.clipboard.writeText(preview.content.text)}
                onCopyPath={() => navigator.clipboard.writeText(preview.filePath)}
                onCopySha={() => navigator.clipboard.writeText(preview.commitSha)}
                showBack={false}
              />
            </section>
          )}
        </div>
      </div>
    </section>
  )
}
