import { useEffect, useRef, useState, type RefObject } from 'react'
import { Code2, Copy, FolderOpen, MinusSquare, PlusSquare, Terminal, Trash2 } from 'lucide-react'
import type {
  ApiResult, AssistantPolicyStatus, BranchPilotApi, DiffHunk, DiffResult, ImagePreview,
  FileChange, GitConfigSnapshot, GitHubAccountSummary, GitHubCliStatus, PatchScope, RepositorySnapshot
} from '../../shared/branchPilot'
import type { ChangeDiffMode } from '../../shared/changeStaging'
import type { ViewMode } from '../../lib/viewMode'
import { getBulkStageToggleState } from '../../shared/changeStaging'
import { ViewSwitch } from '../ViewSwitch'
import { getAmendCommitActionState, getCommitActionState, getCommitAndPushActionState } from '../../shared/commitPreconditions'
import { useVirtualList } from '../../hooks/useVirtualList'
import { useWorkflowPaneResize } from '../../hooks/useWorkflowPaneResize'
import { CommitComposer } from '../changes/CommitComposer'
import { ChangesDiffPanel } from '../changes/ChangesDiffPanel'
import { ChangeListPanel, type ChangeSearchMode } from '../changes/ChangeListPanel'

function buildRepoFilePath(repoPath: string, filePath: string): string {
  const separator = repoPath.includes('\\') ? '\\' : '/'
  const root = repoPath.replace(/[\\/]+$/, '')
  const relativePath = filePath.replace(/^[\\/]+/, '').replace(/[\\/]+/g, separator)
  return `${root}${separator}${relativePath}`
}

function buildRepoFileDirectory(repoPath: string, filePath: string): string {
  const targetPath = buildRepoFilePath(repoPath, filePath)
  const lastSlash = Math.max(targetPath.lastIndexOf('/'), targetPath.lastIndexOf('\\'))
  return lastSlash > 0 ? targetPath.slice(0, lastSlash) : repoPath
}

export function ChangesView({
  snapshot, counts, busy, itemHeight,
  changeFilter, setChangeFilter,
  changeSearchMode, setChangeSearchMode, changeContentIndexing,
  filteredChanges, virtualChanges,
  changesActionsMenuRef, closeChangesActionsMenu,
  createQuickStash, canCreateStash,
  exportPatch, applyPatch,
  bulkStageToggleState, stagingPendingPaths, bulkStagingPending, bulkStageOptimisticChecked, toggleBulkStage, toggleChangeStage,
  selectedFilePath, setSelectedFilePath, setDiffMode, setViewMode,
  commitTitle, setCommitTitle, commitDescription, setCommitDescription,
  commitCoAuthors, setCommitCoAuthors,
  gitConfig, localUserName, setLocalUserName, localUserEmail, setLocalUserEmail,
  githubAccounts, githubCliStatus, assistantPolicy,
  setNotice, onOpenReview, onOpenStash, stashCount,
  generateCommitText, canGenerateCommitText,
  commitActionState, commitAndPushActionState, amendCommitActionState,
  commitChanges, amendLastCommit,
  currentRepoPath, runSnapshotAction, api,
  selectedChange, selectedDiffStats, selectedRelatedDiffStats, discardSelected,
  diffMode, diffDisplayMode, setDiffDisplayMode, diffIgnoreWhitespace, setDiffIgnoreWhitespace,
  diffExpanded, setDiffExpanded,
  diff, relatedDiff, imagePreview, stageSelectedHunk, unstageSelectedHunk, discardSelectedHunk, discardSelectedLines
}: {
  snapshot: RepositorySnapshot | null
  counts: RepositorySnapshot['status']['counts'] | undefined
  busy: boolean
  itemHeight: number
  changeFilter: string
  setChangeFilter: (value: string) => void
  changeSearchMode: ChangeSearchMode
  setChangeSearchMode: (mode: ChangeSearchMode) => void
  changeContentIndexing: boolean
  filteredChanges: FileChange[]
  virtualChanges: ReturnType<typeof useVirtualList<FileChange>>
  changesActionsMenuRef: RefObject<HTMLDetailsElement | null>
  closeChangesActionsMenu: () => void
  createQuickStash: () => void | Promise<void>
  canCreateStash: boolean
  exportPatch: (scope?: PatchScope) => void | Promise<void>
  applyPatch: () => void | Promise<void>
  bulkStageToggleState: ReturnType<typeof getBulkStageToggleState>
  stagingPendingPaths: Set<string>
  bulkStagingPending: boolean
  bulkStageOptimisticChecked: boolean | null
  toggleBulkStage: () => void | Promise<void>
  toggleChangeStage: (change: FileChange) => void | Promise<void>
  selectedFilePath: string | null
  setSelectedFilePath: (path: string) => void
  setDiffMode: (mode: ChangeDiffMode) => void
  setViewMode: (mode: ViewMode) => void
  commitTitle: string
  setCommitTitle: (value: string) => void
  commitDescription: string
  setCommitDescription: (value: string) => void
  commitCoAuthors: string
  setCommitCoAuthors: (value: string) => void
  gitConfig: GitConfigSnapshot | null
  localUserName: string
  setLocalUserName: (value: string) => void
  localUserEmail: string
  setLocalUserEmail: (value: string) => void
  githubAccounts: GitHubAccountSummary[]
  githubCliStatus: GitHubCliStatus | null
  assistantPolicy: AssistantPolicyStatus | null
  setNotice: (message: string) => void
  onOpenReview: () => void
  onOpenStash: () => void
  stashCount: number
  generateCommitText: () => void | Promise<void>
  canGenerateCommitText: boolean
  commitActionState: ReturnType<typeof getCommitActionState>
  commitAndPushActionState: ReturnType<typeof getCommitAndPushActionState>
  amendCommitActionState: ReturnType<typeof getAmendCommitActionState>
  commitChanges: () => Promise<boolean>
  amendLastCommit: () => void | Promise<boolean>
  currentRepoPath: string | undefined
  runSnapshotAction: (label: string, action: () => Promise<ApiResult<RepositorySnapshot>>) => boolean | void | Promise<boolean>
  api: BranchPilotApi | undefined
  selectedChange: FileChange | null
  selectedDiffStats: { additions: number; deletions: number } | null
  selectedRelatedDiffStats: { additions: number; deletions: number } | null
  discardSelected: (change?: FileChange | null) => void | Promise<void>
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
}) {
  const totalChanges = snapshot?.status.changes.length ?? 0
  const {
    gridRef: splitGridRef,
    paneWidth: changesPaneWidth,
    splitStyle,
    startPaneResize: startChangesPaneResize,
    handleSplitKeyDown,
    minPaneWidth,
    maxPaneWidth
  } = useWorkflowPaneResize()
  const changesPanelRef = useRef<HTMLDivElement>(null)
  const patchActionsMenuRef = useRef<HTMLDetailsElement>(null)
  const [diffMenu, setDiffMenu] = useState<{ x: number; y: number; change: FileChange | null } | null>(null)

  useEffect(() => {
    if (!diffMenu) return
    const close = () => setDiffMenu(null)
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDiffMenu(null)
    }
    window.addEventListener('click', close)
    window.addEventListener('scroll', close, true)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [diffMenu])

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      const menu = patchActionsMenuRef.current
      if (menu?.open && event.target instanceof Node && !menu.contains(event.target)) {
        menu.open = false
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [])

  const stageSelectedFile = () => {
    const change = diffMenu?.change ?? selectedChange
    setDiffMenu(null)
    if (!change || !currentRepoPath || !api) return
    void runSnapshotAction('File staged.', () => api!.stageFile({ repoPath: currentRepoPath, filePath: change.path }))
  }

  const unstageSelectedFile = () => {
    const change = diffMenu?.change ?? selectedChange
    setDiffMenu(null)
    if (!change || !currentRepoPath || !api) return
    void runSnapshotAction('File unstaged.', () => api!.unstageFile({ repoPath: currentRepoPath, filePath: change.path }))
  }

  const discardFromMenu = () => {
    const change = diffMenu?.change ?? selectedChange
    setDiffMenu(null)
    void discardSelected(change)
  }

  const openInEditorFromMenu = () => {
    const change = diffMenu?.change ?? selectedChange
    setDiffMenu(null)
    if (!change || !currentRepoPath || !api) return
    void api.openInEditor({ targetPath: buildRepoFilePath(currentRepoPath, change.path) }).then((result) => {
      setNotice(result.ok ? result.data.message || 'File opened in editor.' : result.error.message)
    })
  }

  const openTerminalFromMenu = () => {
    const change = diffMenu?.change ?? selectedChange
    setDiffMenu(null)
    if (!change || !currentRepoPath || !api) return
    void api.openTerminal(buildRepoFileDirectory(currentRepoPath, change.path)).then((result) => {
      setNotice(result.ok ? result.data.message || 'Terminal opened.' : result.error.message)
    })
  }

  const showInFileManagerFromMenu = () => {
    const change = diffMenu?.change ?? selectedChange
    setDiffMenu(null)
    if (!change || !currentRepoPath || !api) return
    void api.showItemInFolder(buildRepoFilePath(currentRepoPath, change.path)).then((result) => {
      setNotice(result.ok ? result.data.message || 'Shown in file manager.' : result.error.message)
    })
  }

  const copyPathFromMenu = () => {
    const change = diffMenu?.change ?? selectedChange
    setDiffMenu(null)
    if (!change || !currentRepoPath) return
    void navigator.clipboard.writeText(buildRepoFilePath(currentRepoPath, change.path))
  }

  const copyNameFromMenu = () => {
    const change = diffMenu?.change ?? selectedChange
    setDiffMenu(null)
    if (!change) return
    void navigator.clipboard.writeText(change.path.split('/').pop() ?? change.path)
  }

  const loadDiffContext = async (request: { filePath: string; staged: boolean; lineStart: number; maxLines: number }) => {
    if (!api || !currentRepoPath) return null
    const result = await api.getDiffContext({ repoPath: currentRepoPath, ...request })
    if (result.ok) return result.data

    setNotice(`Could not load more context: ${result.error.message}`)
    return null
  }

  const noChanges = totalChanges === 0
  const contextMenuChange = diffMenu?.change ?? selectedChange
  const canDiscardSelectedFile = Boolean(selectedChange && (selectedChange.unstaged || selectedChange.untracked))

  return (
    <section className="content-grid changes-workflow-grid" ref={splitGridRef} style={splitStyle}>
      <div className="changes-panel changes-panel-compact" ref={changesPanelRef}>
        <ViewSwitch viewMode="changes" setViewMode={setViewMode} changedCount={counts?.changed ?? 0} />
        <ChangeListPanel
          snapshot={snapshot}
          totalChanges={totalChanges}
          busy={busy}
          itemHeight={itemHeight}
          changeFilter={changeFilter}
          setChangeFilter={setChangeFilter}
          changeSearchMode={changeSearchMode}
          setChangeSearchMode={setChangeSearchMode}
          changeContentIndexing={changeContentIndexing}
          filteredChanges={filteredChanges}
          virtualChanges={virtualChanges}
          changesActionsMenuRef={changesActionsMenuRef}
          closeChangesActionsMenu={closeChangesActionsMenu}
          patchActionsMenuRef={patchActionsMenuRef}
          createQuickStash={createQuickStash}
          canCreateStash={canCreateStash}
          exportPatch={exportPatch}
          applyPatch={applyPatch}
          bulkStageToggleState={bulkStageToggleState}
          stagingPendingPaths={stagingPendingPaths}
          bulkStagingPending={bulkStagingPending}
          bulkStageOptimisticChecked={bulkStageOptimisticChecked}
          toggleBulkStage={toggleBulkStage}
          toggleChangeStage={toggleChangeStage}
          selectedFilePath={selectedFilePath}
          setSelectedFilePath={setSelectedFilePath}
          setDiffMode={setDiffMode}
          setDiffMenu={setDiffMenu}
          onOpenStash={onOpenStash}
          stashCount={stashCount}
        />

        <CommitComposer
          panelRef={changesPanelRef}
          snapshot={snapshot}
          busy={busy}
          stagingBusy={bulkStagingPending || stagingPendingPaths.size > 0}
          api={api}
          currentRepoPath={currentRepoPath}
          gitConfig={gitConfig}
          localUserName={localUserName}
          setLocalUserName={setLocalUserName}
          localUserEmail={localUserEmail}
          setLocalUserEmail={setLocalUserEmail}
          githubAccounts={githubAccounts}
          githubCliStatus={githubCliStatus}
          assistantPolicy={assistantPolicy}
          commitTitle={commitTitle}
          setCommitTitle={setCommitTitle}
          commitDescription={commitDescription}
          setCommitDescription={setCommitDescription}
          commitCoAuthors={commitCoAuthors}
          setCommitCoAuthors={setCommitCoAuthors}
          canGenerateCommitText={canGenerateCommitText}
          generateCommitText={generateCommitText}
          commitActionState={commitActionState}
          commitAndPushActionState={commitAndPushActionState}
          amendCommitActionState={amendCommitActionState}
          commitChanges={commitChanges}
          amendLastCommit={amendLastCommit}
          runSnapshotAction={runSnapshotAction}
          setNotice={setNotice}
          onOpenReview={onOpenReview}
          setViewMode={setViewMode}
        />

      </div>

      <div
        className="changes-splitter"
        role="separator"
        aria-label="Resize changes and diff panes"
        aria-orientation="vertical"
        aria-valuemin={minPaneWidth}
        aria-valuemax={maxPaneWidth}
        aria-valuenow={changesPaneWidth}
        tabIndex={0}
        onPointerDown={startChangesPaneResize}
        onKeyDown={handleSplitKeyDown}
      >
        <span />
      </div>

      <ChangesDiffPanel
        noChanges={noChanges}
        selectedChange={selectedChange}
        selectedDiffStats={selectedDiffStats}
        selectedRelatedDiffStats={selectedRelatedDiffStats}
        currentRepoPath={currentRepoPath}
        busy={busy}
        api={api}
        canDiscardSelectedFile={canDiscardSelectedFile}
        onDiscardSelected={discardFromMenu}
        onOpenContextMenu={(x, y, change) => setDiffMenu({ x, y, change })}
        diffMode={diffMode}
        diffDisplayMode={diffDisplayMode}
        setDiffDisplayMode={setDiffDisplayMode}
        diffIgnoreWhitespace={diffIgnoreWhitespace}
        setDiffIgnoreWhitespace={setDiffIgnoreWhitespace}
        diffExpanded={diffExpanded}
        setDiffExpanded={setDiffExpanded}
        diff={diff}
        relatedDiff={relatedDiff}
        imagePreview={imagePreview}
        stageSelectedHunk={stageSelectedHunk}
        unstageSelectedHunk={unstageSelectedHunk}
        discardSelectedHunk={discardSelectedHunk}
        discardSelectedLines={discardSelectedLines}
        loadDiffContext={loadDiffContext}
        runSnapshotAction={runSnapshotAction}
      />

      {diffMenu && contextMenuChange && (
          <div className="context-menu" role="menu" style={{ top: diffMenu.y, left: diffMenu.x }}>
            <button
              type="button"
              role="menuitem"
              title="Stage all changes in this file"
              onClick={stageSelectedFile}
              disabled={busy || (!contextMenuChange.unstaged && !contextMenuChange.untracked)}
            >
              <PlusSquare size={15} />
              Stage file
            </button>
            <button
              type="button"
              role="menuitem"
              title="Unstage this file"
              onClick={unstageSelectedFile}
              disabled={busy || !contextMenuChange.staged}
            >
              <MinusSquare size={15} />
              Unstage file
            </button>
            <button
              type="button"
              role="menuitem"
              className="danger"
              title={contextMenuChange.untracked ? 'Delete this untracked file' : 'Discard changes to this file'}
              onClick={discardFromMenu}
              disabled={busy || (!contextMenuChange.unstaged && !contextMenuChange.untracked)}
            >
              <Trash2 size={15} />
              {contextMenuChange.untracked ? 'Delete file' : 'Discard changes'}
            </button>
            <div className="context-menu-separator" role="separator" />
            <button type="button" role="menuitem" title="Open this file in your editor" onClick={openInEditorFromMenu} disabled={busy || !api}>
              <Code2 size={15} />
              Open in editor
            </button>
            <button type="button" role="menuitem" title="Open a terminal in this file's folder" onClick={openTerminalFromMenu} disabled={busy || !api}>
              <Terminal size={15} />
              Open in terminal
            </button>
            <button type="button" role="menuitem" title="Show this file in the file manager" onClick={showInFileManagerFromMenu} disabled={busy || !api}>
              <FolderOpen size={15} />
              Show in file manager
            </button>
            <div className="context-menu-separator" role="separator" />
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
