import type { RefObject } from 'react'
import { Archive, Copy, ListFilter, Save, Search, UploadCloud, X } from 'lucide-react'
import type { FileChange, PatchScope, RepositorySnapshot } from '../../shared/branchPilot'
import type { ChangeDiffMode } from '../../shared/changeStaging'
import { getBulkStageToggleState, getDefaultChangeDiffMode } from '../../shared/changeStaging'
import { changeLabel, statusToken, statusTone } from '../../lib/fileChangeLabels'
import { useVirtualList } from '../../hooks/useVirtualList'
import { BulkStageCheckbox, StageCheckbox } from '../StageCheckbox'
import { FileTypeIcon } from '../FileTypeIcon'

export type ChangeSearchMode = 'path' | 'content' | 'all'

export interface ChangeContextMenu {
  x: number
  y: number
  change: FileChange | null
}

interface ChangeListPanelProps {
  snapshot: RepositorySnapshot | null
  totalChanges: number
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
  patchActionsMenuRef: RefObject<HTMLDetailsElement | null>
  createQuickStash: () => void | Promise<void>
  canCreateStash: boolean
  exportPatch: (scope?: PatchScope) => void | Promise<void>
  applyPatch: () => void | Promise<void>
  bulkStageToggleState: ReturnType<typeof getBulkStageToggleState>
  stagingPendingPaths: Set<string>
  bulkStagingPending: boolean
  bulkStageOptimisticChecked: boolean | null
  stageOptimistic: Map<string, boolean>
  toggleBulkStage: () => void | Promise<void>
  toggleChangeStage: (change: FileChange) => void | Promise<void>
  selectedFilePath: string | null
  setSelectedFilePath: (path: string) => void
  setDiffMode: (mode: ChangeDiffMode) => void
  setDiffMenu: (menu: ChangeContextMenu) => void
  onOpenStash: () => void
  stashCount: number
}

function changeStageState(change: FileChange): 'conflict' | 'partial' | 'staged' | 'untracked' | 'unstaged' {
  if (change.conflicted) return 'conflict'
  if (change.staged && (change.unstaged || change.untracked)) return 'partial'
  if (change.staged) return 'staged'
  if (change.untracked) return 'untracked'
  return 'unstaged'
}

function changeStageStateLabel(change: FileChange): string {
  const stageState = changeStageState(change)
  if (stageState === 'conflict') return 'Conflict, resolve before staging'
  if (stageState === 'partial') return 'Partially included in commit'
  if (stageState === 'staged') return 'Included in commit'
  if (stageState === 'untracked') return 'Untracked, not included in commit'
  return 'Not included in commit'
}

type BulkStageVisualState = 'checked' | 'mixed' | 'unchecked'

function bulkStageVisualState(
  changes: FileChange[] | undefined,
  optimisticChecked: boolean | null,
  fallback: { checked: boolean; mixed: boolean }
): BulkStageVisualState {
  if (optimisticChecked !== null) return optimisticChecked ? 'checked' : 'unchecked'
  if (!changes || changes.length === 0) return fallback.checked ? 'checked' : fallback.mixed ? 'mixed' : 'unchecked'

  const stageableChanges = changes.filter((change) => !change.conflicted)
  const hasStaged = stageableChanges.some((change) => change.staged)
  const hasUnstaged = stageableChanges.some((change) => change.unstaged || change.untracked)

  if (hasStaged && !hasUnstaged) return 'checked'
  if (hasStaged && hasUnstaged) return 'mixed'
  return 'unchecked'
}

export function ChangeListPanel({
  snapshot,
  totalChanges,
  busy,
  itemHeight,
  changeFilter,
  setChangeFilter,
  changeSearchMode,
  setChangeSearchMode,
  changeContentIndexing,
  filteredChanges,
  virtualChanges,
  changesActionsMenuRef,
  closeChangesActionsMenu,
  patchActionsMenuRef,
  createQuickStash,
  canCreateStash,
  exportPatch,
  applyPatch,
  bulkStageToggleState,
  stagingPendingPaths,
  bulkStagingPending,
  bulkStageOptimisticChecked,
  stageOptimistic,
  toggleBulkStage,
  toggleChangeStage,
  selectedFilePath,
  setSelectedFilePath,
  setDiffMode,
  setDiffMenu,
  onOpenStash,
  stashCount
}: ChangeListPanelProps) {
  const { containerRef: changesContainerRef, onScroll: changesScroll, window: changesWindow, items: changesItems } = virtualChanges
  const changeSearchModeLabel = changeSearchMode === 'path' ? 'Name' : changeSearchMode === 'content' ? 'Diff' : 'All'
  const bulkVisualState = bulkStageVisualState(snapshot?.status.changes, bulkStageOptimisticChecked, bulkStageToggleState)
  const closePatchActionsMenu = () => {
    if (patchActionsMenuRef.current) patchActionsMenuRef.current.open = false
  }

  return (
    <>
      <div className="change-filter-bar change-filter-bar-compact">
        <details className="changes-actions-menu search-filter-menu" ref={changesActionsMenuRef}>
          <summary title="Search scope" aria-label="Search scope">
            <ListFilter size={16} />
            {changeSearchModeLabel}
          </summary>
          <div className="changes-actions-popover search-filter-popover">
            <button
              type="button"
              className={changeSearchMode === 'path' ? 'active' : undefined}
              onClick={() => {
                setChangeSearchMode('path')
                closeChangesActionsMenu()
              }}
            >
              Name
            </button>
            <button
              type="button"
              className={changeSearchMode === 'content' ? 'active' : undefined}
              onClick={() => {
                setChangeSearchMode('content')
                closeChangesActionsMenu()
              }}
            >
              Diff
            </button>
            <button
              type="button"
              className={changeSearchMode === 'all' ? 'active' : undefined}
              onClick={() => {
                setChangeSearchMode('all')
                closeChangesActionsMenu()
              }}
            >
              All
            </button>
          </div>
        </details>
        <label className="change-filter-input" htmlFor="change-filter">
          <Search size={16} />
          <input
            id="change-filter"
            value={changeFilter}
            onChange={(event) => setChangeFilter(event.target.value)}
            placeholder="Search changed files"
          />
        </label>
        <details className="changes-actions-menu patch-actions-menu" ref={patchActionsMenuRef}>
          <summary title="Patch actions" aria-label="Patch actions">
            <UploadCloud size={16} />
          </summary>
          <div className="changes-actions-popover patch-actions-popover">
            <div className="changes-actions-section">
              <span>Export patch</span>
              <button
                type="button"
                onClick={() => {
                  closePatchActionsMenu()
                  void exportPatch('working-tree')
                }}
                disabled={busy || !snapshot}
              >
                <Copy size={15} />
                Working tree
              </button>
              <button
                type="button"
                onClick={() => {
                  closePatchActionsMenu()
                  void exportPatch('staged')
                }}
                disabled={busy || !snapshot || !snapshot.status.counts.staged}
              >
                <Copy size={15} />
                Staged changes
              </button>
            </div>
            <button
              type="button"
              onClick={() => {
                closePatchActionsMenu()
                void applyPatch()
              }}
              disabled={busy || !snapshot || snapshot.status.merge.operation !== 'none'}
            >
              <UploadCloud size={15} />
              Apply patch
            </button>
          </div>
        </details>
        <button
          type="button"
          className="icon-button search-toolbar-button"
          title="Stash changes"
          aria-label="Stash changes"
          onClick={() => { void createQuickStash() }}
          disabled={busy || !canCreateStash}
        >
          <Save size={16} />
        </button>
        {changeContentIndexing && changeSearchMode !== 'path' && changeFilter && <span>Indexing diffs...</span>}
        {changeFilter && (
          <button type="button" className="secondary" onClick={() => setChangeFilter('')}>
            <X size={15} />
            Clear
          </button>
        )}
      </div>

      <div className="change-list-header">
        <BulkStageCheckbox
          state={bulkStageToggleState}
          visualState={bulkVisualState}
          disabled={busy || bulkStagingPending}
          changedCount={totalChanges}
          onToggle={toggleBulkStage}
        />
      </div>

      <div className="change-list virtual-list-viewport" ref={changesContainerRef} onScroll={changesScroll}>
        {snapshot?.status.changes.length === 0 ? (
          <div className="quiet-box">Working tree is clean.</div>
        ) : filteredChanges.length === 0 ? (
          <div className="quiet-box">No changed files match this search.</div>
        ) : (
          <div className="virtual-list-spacer" style={{ height: changesWindow.totalHeight }}>
            {changesItems.map(({ item: change, index }) => {
              const isSelected = selectedFilePath === change.path
              const stageState = changeStageState(change)
              const stageLabel = changeStageStateLabel(change)

              return (
                <div
                  className="virtual-list-item"
                  key={change.path}
                  style={{ transform: `translateY(${index * itemHeight}px)` }}
                >
                  <div
                    className={isSelected ? 'change-row selected' : 'change-row'}
                    data-stage-state={stageState}
                    aria-selected={isSelected}
                    onContextMenu={(event) => {
                      event.preventDefault()
                      event.stopPropagation()
                      setDiffMenu({ x: event.clientX, y: event.clientY, change })
                    }}
                  >
                    <StageCheckbox
                      change={change}
                      disabled={busy || bulkStagingPending || stagingPendingPaths.has(change.path) || change.conflicted}
                      optimisticCheckedOverride={bulkStageOptimisticChecked ?? stageOptimistic.get(change.path) ?? null}
                      onToggle={toggleChangeStage}
                    />
                    <button
                      className="change-select"
                      type="button"
                      title={`${change.path} · ${stageLabel} · ${changeLabel(change)}`}
                      aria-label={`${change.path}, ${stageLabel}, ${changeLabel(change)}`}
                      onClick={() => {
                        setSelectedFilePath(change.path)
                        setDiffMode(getDefaultChangeDiffMode(change))
                      }}
                    >
                      <span className="file-label">
                        <FileTypeIcon path={change.path} />
                        <span className="file-name">{change.path}</span>
                      </span>
                      <span className="change-row-badges">
                        <span className={`file-status status-${statusTone(change)}`} title={stageLabel} aria-label={stageLabel}>
                          {statusToken(change)}
                        </span>
                      </span>
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {stashCount > 0 && (
        <button type="button" className="stash-bar" onClick={onOpenStash} title="View stashed changes">
          <Archive size={16} />
          <span className="stash-bar-label">Stashed changes</span>
          <span className="stash-bar-count">{stashCount}</span>
        </button>
      )}
    </>
  )
}
