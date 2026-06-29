import { Code2, Columns2, FolderOpen, GitCommitHorizontal, Maximize2, Minimize2, Pilcrow, Rows3, Terminal, Trash2 } from 'lucide-react'
import type {
  ApiResult,
  BranchPilotApi,
  DiffContextResult,
  DiffHunk,
  DiffResult,
  FileChange,
  ImagePreview,
  RepositorySnapshot
} from '../../shared/branchPilot'
import type { ChangeDiffMode } from '../../shared/changeStaging'
import { ActionCard } from '../ActionCard'
import { DiffPreview } from '../DiffView'
import { DiffStatBadges } from '../DiffStatBadges'
import { IconButton } from '../IconButton'
import { SegmentedControl } from '../SegmentedControl'

function diffSectionLabel(mode: ChangeDiffMode): string {
  return mode === 'staged' ? 'Staged for commit' : 'Unstaged in working tree'
}

function diffSectionDescription(mode: ChangeDiffMode): string {
  return mode === 'staged'
    ? 'Included in the next commit.'
    : 'Still outside the commit.'
}

interface ChangesDiffPanelProps {
  noChanges: boolean
  selectedChange: FileChange | null
  selectedDiffStats: { additions: number; deletions: number } | null
  selectedRelatedDiffStats: { additions: number; deletions: number } | null
  currentRepoPath: string | undefined
  busy: boolean
  api: BranchPilotApi | undefined
  canDiscardSelectedFile: boolean
  onDiscardSelected: () => void
  onOpenContextMenu: (x: number, y: number, change: FileChange) => void
  diffMode: ChangeDiffMode
  diffDisplayMode: 'unified' | 'split'
  setDiffDisplayMode: (mode: 'unified' | 'split') => void
  diffIgnoreWhitespace: boolean
  setDiffIgnoreWhitespace: (value: boolean) => void
  diffExpanded: boolean
  setDiffExpanded: (value: boolean) => void
  diff: DiffResult | null
  relatedDiff: DiffResult | null
  imagePreview: ImagePreview | null
  stageSelectedHunk: (hunk: DiffHunk) => void
  unstageSelectedHunk: (hunk: DiffHunk) => void
  discardSelectedHunk: (hunk: DiffHunk) => void
  discardSelectedLines: (patch: string, stagedSelection?: boolean) => void
  loadDiffContext: (request: { filePath: string; staged: boolean; lineStart: number; maxLines: number }) => Promise<DiffContextResult | null>
  runSnapshotAction: (label: string, action: () => Promise<ApiResult<RepositorySnapshot>>) => boolean | void | Promise<boolean>
}

export function ChangesDiffPanel({
  noChanges,
  selectedChange,
  selectedDiffStats,
  selectedRelatedDiffStats,
  currentRepoPath,
  busy,
  api,
  canDiscardSelectedFile,
  onDiscardSelected,
  onOpenContextMenu,
  diffMode,
  diffDisplayMode,
  setDiffDisplayMode,
  diffIgnoreWhitespace,
  setDiffIgnoreWhitespace,
  diffExpanded,
  setDiffExpanded,
  diff,
  relatedDiff,
  imagePreview,
  stageSelectedHunk,
  unstageSelectedHunk,
  discardSelectedHunk,
  discardSelectedLines,
  loadDiffContext,
  runSnapshotAction
}: ChangesDiffPanelProps) {
  const primaryDiffMode: ChangeDiffMode = diff?.staged ? 'staged' : 'unstaged'
  const relatedDiffMode: ChangeDiffMode = relatedDiff?.staged ? 'staged' : 'unstaged'
  const showRelatedDiff = Boolean(
    selectedChange?.staged &&
    (selectedChange.unstaged || selectedChange.untracked) &&
    diff &&
    !diff.binary &&
    diff.text.trim() &&
    relatedDiff &&
    !relatedDiff.binary &&
    relatedDiff.text.trim()
  )
  const mixedDiffStats = showRelatedDiff && selectedDiffStats && selectedRelatedDiffStats
    ? {
        additions: selectedDiffStats.additions + selectedRelatedDiffStats.additions,
        deletions: selectedDiffStats.deletions + selectedRelatedDiffStats.deletions
      }
    : selectedDiffStats
  const mixedDiffFile = diff?.files[0] ?? relatedDiff?.files[0]
  const mixedDiffPath = mixedDiffFile?.newPath ?? selectedChange?.path ?? 'Selected file'
  const mixedDiffOldPath = mixedDiffFile?.oldPath && mixedDiffFile.oldPath !== mixedDiffFile.newPath
    ? mixedDiffFile.oldPath
    : null
  const primaryDiffPreview = (
    <DiffPreview
      diff={diff}
      imagePreview={imagePreview}
      mode={primaryDiffMode}
      displayMode={diffDisplayMode}
      expanded={diffExpanded}
      busy={busy}
      hideFileHeading={showRelatedDiff}
      sectionLabel={showRelatedDiff ? diffSectionLabel(primaryDiffMode) : undefined}
      sectionDescription={showRelatedDiff ? diffSectionDescription(primaryDiffMode) : undefined}
      sectionStats={showRelatedDiff ? selectedDiffStats : undefined}
      sectionTone={showRelatedDiff ? primaryDiffMode : undefined}
      onStageHunk={stageSelectedHunk}
      onUnstageHunk={unstageSelectedHunk}
      onDiscardHunk={discardSelectedHunk}
      onStageLines={(patch) => {
        if (!currentRepoPath || !selectedChange || !api) return
        void runSnapshotAction('Selected lines staged.', () => api.stageHunk({ repoPath: currentRepoPath, filePath: selectedChange.path, patch }))
      }}
      onUnstageLines={(patch) => {
        if (!currentRepoPath || !selectedChange || !api) return
        void runSnapshotAction('Selected lines unstaged.', () => api.unstageHunk({ repoPath: currentRepoPath, filePath: selectedChange.path, patch }))
      }}
      onDiscardLines={(patch) => discardSelectedLines(patch, diff?.staged ?? diffMode === 'staged')}
      onLoadContext={loadDiffContext}
      onExpandContext={() => setDiffExpanded(true)}
    />
  )
  const relatedDiffPreview = showRelatedDiff && relatedDiff ? (
    <DiffPreview
      diff={relatedDiff}
      mode={relatedDiffMode}
      displayMode={diffDisplayMode}
      expanded={diffExpanded}
      busy={busy}
      hideFileHeading
      sectionLabel={diffSectionLabel(relatedDiffMode)}
      sectionDescription={diffSectionDescription(relatedDiffMode)}
      sectionStats={selectedRelatedDiffStats}
      sectionTone={relatedDiffMode}
      onStageHunk={stageSelectedHunk}
      onUnstageHunk={unstageSelectedHunk}
      onDiscardHunk={discardSelectedHunk}
      onStageLines={(patch) => {
        if (!currentRepoPath || !selectedChange || !api) return
        void runSnapshotAction('Selected lines staged.', () => api.stageHunk({ repoPath: currentRepoPath, filePath: selectedChange.path, patch }))
      }}
      onUnstageLines={(patch) => {
        if (!currentRepoPath || !selectedChange || !api) return
        void runSnapshotAction('Selected lines unstaged.', () => api.unstageHunk({ repoPath: currentRepoPath, filePath: selectedChange.path, patch }))
      }}
      onDiscardLines={(patch) => discardSelectedLines(patch, relatedDiff.staged)}
      onLoadContext={loadDiffContext}
      onExpandContext={() => setDiffExpanded(true)}
    />
  ) : null

  return (
    <div
      className="diff-panel"
      onContextMenu={(event) => {
        if (!selectedChange) return
        event.preventDefault()
        onOpenContextMenu(event.clientX, event.clientY, selectedChange)
      }}
    >
      {noChanges ? (
        <div className="no-changes">
          <div className="no-changes-hero">
            <span className="no-changes-icon"><GitCommitHorizontal size={26} /></span>
            <h2>No local changes</h2>
            <p>There are no uncommitted changes in this repository. Here are a few things you can do next.</p>
          </div>
          <div className="no-changes-cards">
            <ActionCard
              icon={<Code2 size={18} />}
              title="Open in your editor"
              description="Edit files in your configured editor."
              disabled={!currentRepoPath || busy || !api}
              onClick={() => currentRepoPath && api && void api.openInEditor({ targetPath: currentRepoPath })}
            />
            <ActionCard
              icon={<FolderOpen size={18} />}
              title="Open in file explorer"
              description="Show the repository folder."
              disabled={!currentRepoPath || busy || !api}
              onClick={() => currentRepoPath && api && void api.openFolderInFileManager(currentRepoPath)}
            />
            <ActionCard
              icon={<Terminal size={18} />}
              title="Open in terminal"
              description="Start a terminal in this repository."
              disabled={!currentRepoPath || busy || !api}
              onClick={() => currentRepoPath && api && void api.openTerminal(currentRepoPath)}
            />
          </div>
        </div>
      ) : (
        <>
          <div className="panel-heading diff-heading">
            <div className="diff-heading-main">
              <h2>Diff</h2>
              <p>{selectedChange?.path ?? 'Select a changed file'}</p>
              {mixedDiffStats && (
                <DiffStatBadges
                  additions={mixedDiffStats.additions}
                  deletions={mixedDiffStats.deletions}
                  label="Selected file diff stats"
                />
              )}
            </div>
            <div className="panel-actions diff-controls">
              {selectedChange && (
                <div className="diff-file-actions" aria-label="Selected file actions">
                  <button
                    type="button"
                    className="danger"
                    title={canDiscardSelectedFile ? (selectedChange.untracked ? 'Delete this untracked file' : 'Discard unstaged changes in this file') : 'Unstage this file before discarding staged-only changes'}
                    onClick={onDiscardSelected}
                    disabled={busy || !api || !currentRepoPath || !canDiscardSelectedFile}
                  >
                    <Trash2 size={15} />
                    {selectedChange.untracked ? 'Delete' : 'Discard'}
                  </button>
                </div>
              )}
              <IconButton
                active={diffIgnoreWhitespace}
                icon={<Pilcrow size={16} />}
                label="Ignore whitespace"
                title="Ignore whitespace-only changes"
                onClick={() => setDiffIgnoreWhitespace(!diffIgnoreWhitespace)}
              />
              <IconButton
                active={diffExpanded}
                icon={diffExpanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                label={diffExpanded ? 'Collapse diff context' : 'Show more context'}
                onClick={() => setDiffExpanded(!diffExpanded)}
                disabled={!selectedChange}
              />
              <SegmentedControl
                className="diff-display-toggle"
                ariaLabel="Diff display mode"
                value={diffDisplayMode}
                onChange={(value) => setDiffDisplayMode(value as 'unified' | 'split')}
                options={[
                  { value: 'unified', icon: <Rows3 size={16} />, title: 'Unified diff (single column)', ariaLabel: 'Unified diff' },
                  { value: 'split', icon: <Columns2 size={16} />, title: 'Split diff (side by side)', ariaLabel: 'Split diff' }
                ]}
              />
            </div>
          </div>

          {showRelatedDiff ? (
            <div className="mixed-diff-stack">
              <div className="diff-file-heading mixed-diff-file-heading">
                <strong>{mixedDiffPath}</strong>
                {mixedDiffOldPath && <span>from {mixedDiffOldPath}</span>}
              </div>
              {primaryDiffPreview}
              {relatedDiffPreview}
            </div>
          ) : primaryDiffPreview}
        </>
      )}
    </div>
  )
}
