import { useEffect, useState, type ReactNode, type RefObject } from 'react'
import { ArrowDownToLine, Bot, Copy, GitCommitHorizontal, ListFilter, Loader2, Pencil, Save, Search, Trash2, UploadCloud, Users, X } from 'lucide-react'
import type {
  ApiResult, AssistantId, AssistantPolicyStatus, BranchPilotApi, CoAuthor, DiffHunk, DiffResult, ImagePreview,
  FileChange, PatchScope, RepositorySnapshot
} from '../../shared/branchPilot'
import type { ChangeDiffMode } from '../../shared/changeStaging'
import { getBulkStageToggleState, getDefaultChangeDiffMode } from '../../shared/changeStaging'
import { getAmendCommitActionState, getCommitActionState, getCommitAndPushActionState } from '../../shared/commitPreconditions'
import { virtualRangeLabel } from '../../shared/virtualList'
import { useVirtualList } from '../../hooks/useVirtualList'
import { changeLabel, statusToken } from '../../lib/fileChangeLabels'
import { assistantPolicyBlockedLabel } from '../../lib/assistantLabels'
import { ActionBlockers } from '../ActionBlockers'
import { DiffPreview } from '../DiffView'
import { BulkStageCheckbox, StageCheckbox } from '../StageCheckbox'

export function ChangesView({
  snapshot, counts, busy, itemHeight,
  changeFilter, setChangeFilter,
  filteredChanges, virtualChanges,
  changesActionsMenuRef, closeChangesActionsMenu,
  createQuickStash, canCreateStash,
  patchScope, setPatchScope, exportPatch, applyPatch,
  bulkStageToggleState, toggleBulkStage, toggleChangeStage,
  selectedFilePath, setSelectedFilePath, setDiffMode,
  commitTitle, setCommitTitle, commitDescription, setCommitDescription,
  commitCoAuthors, setCommitCoAuthors,
  selectedAssistant, setSelectedAssistant,
  generateCommitText, canGenerateCommitText, checkAssistants, assistantsChecking, assistantPolicy,
  renderPreCommitReviewPanel,
  commitActionState, commitAndPushActionState, amendCommitActionState,
  commitChanges, amendLastCommit,
  currentRepoPath, runSnapshotAction, api,
  selectedChange, selectedDiffStats, discardSelected,
  diffMode, diffDisplayMode, setDiffDisplayMode, diffIgnoreWhitespace, setDiffIgnoreWhitespace,
  diff, imagePreview, stageSelectedHunk, unstageSelectedHunk, openSelectedFileLineInEditor
}: {
  snapshot: RepositorySnapshot | null
  counts: RepositorySnapshot['status']['counts'] | undefined
  busy: boolean
  itemHeight: number
  changeFilter: string
  setChangeFilter: (value: string) => void
  filteredChanges: FileChange[]
  virtualChanges: ReturnType<typeof useVirtualList<FileChange>>
  changesActionsMenuRef: RefObject<HTMLDetailsElement | null>
  closeChangesActionsMenu: () => void
  createQuickStash: () => void | Promise<void>
  canCreateStash: boolean
  patchScope: PatchScope
  setPatchScope: (scope: PatchScope) => void
  exportPatch: () => void | Promise<void>
  applyPatch: () => void | Promise<void>
  bulkStageToggleState: ReturnType<typeof getBulkStageToggleState>
  toggleBulkStage: () => void | Promise<void>
  toggleChangeStage: (change: FileChange) => void | Promise<void>
  selectedFilePath: string | null
  setSelectedFilePath: (path: string) => void
  setDiffMode: (mode: ChangeDiffMode) => void
  commitTitle: string
  setCommitTitle: (value: string) => void
  commitDescription: string
  setCommitDescription: (value: string) => void
  commitCoAuthors: string
  setCommitCoAuthors: (value: string) => void
  selectedAssistant: AssistantId
  setSelectedAssistant: (assistant: AssistantId) => void
  generateCommitText: () => void | Promise<void>
  canGenerateCommitText: boolean
  checkAssistants: () => void | Promise<void>
  assistantsChecking: boolean
  assistantPolicy: AssistantPolicyStatus | null
  renderPreCommitReviewPanel: () => ReactNode
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
  discardSelected: () => void | Promise<void>
  diffMode: ChangeDiffMode
  diffDisplayMode: 'unified' | 'split'
  setDiffDisplayMode: (mode: 'unified' | 'split') => void
  diffIgnoreWhitespace: boolean
  setDiffIgnoreWhitespace: (value: boolean) => void
  diff: DiffResult | null
  imagePreview: ImagePreview | null
  stageSelectedHunk: (hunk: DiffHunk) => void
  unstageSelectedHunk: (hunk: DiffHunk) => void
  openSelectedFileLineInEditor: (line?: number) => void
}) {
    const totalChanges = snapshot?.status.changes.length ?? 0
  const { containerRef: changesContainerRef, onScroll: changesScroll, window: changesWindow, items: changesItems } = virtualChanges
  const [showCoAuthors, setShowCoAuthors] = useState(false)
  const coAuthorsVisible = showCoAuthors || commitCoAuthors.trim().length > 0
  const [contributors, setContributors] = useState<CoAuthor[]>([])
  const [coAuthorFilter, setCoAuthorFilter] = useState('')

  useEffect(() => {
    if (!coAuthorsVisible || !currentRepoPath || !api) return
    let cancelled = false
    const load = async () => {
      const merged = new Map<string, CoAuthor>()
      const seenNames = new Set<string>()
      // GitHub contributors first (carry avatars + @login), then fill gaps from git log.
      if (typeof api.getGitHubContributors === 'function') {
        const result = await api.getGitHubContributors(currentRepoPath).catch(() => null)
        if (result?.ok) {
          for (const contributor of result.data) {
            merged.set(contributor.email.toLowerCase(), contributor)
            if (contributor.login) seenNames.add(contributor.login.toLowerCase())
          }
        }
      }
      if (typeof api.getContributors === 'function') {
        const result = await api.getContributors(currentRepoPath).catch(() => null)
        if (result?.ok) {
          for (const contributor of result.data) {
            const key = contributor.email.toLowerCase()
            if (merged.has(key) || seenNames.has(contributor.name.toLowerCase())) continue
            merged.set(key, contributor)
          }
        }
      }
      if (!cancelled) setContributors([...merged.values()])
    }
    void load()
    return () => { cancelled = true }
  }, [coAuthorsVisible, currentRepoPath, api])

  const addCoAuthor = (contributor: CoAuthor) => {
    if (commitCoAuthors.includes(contributor.email)) return
    const entry = `${contributor.name} <${contributor.email}>`
    setCommitCoAuthors(commitCoAuthors.trim() ? `${commitCoAuthors.trim()}\n${entry}` : entry)
    setCoAuthorFilter('')
  }

  const coAuthorQuery = coAuthorFilter.trim().toLowerCase()
  const coAuthorSuggestions = contributors
    .filter((contributor) => !commitCoAuthors.includes(contributor.email))
    .filter((contributor) => !coAuthorQuery
      || contributor.name.toLowerCase().includes(coAuthorQuery)
      || contributor.email.toLowerCase().includes(coAuthorQuery))
    .slice(0, 8)
  const visibleRange = virtualRangeLabel(changesWindow, filteredChanges.length)
  const visibleSummary = changeFilter
    ? `${filteredChanges.length} of ${totalChanges}`
    : `${totalChanges}`

  if (totalChanges === 0) {
    return (
      <section className="single-panel">
        <div className="diff-empty">
          <GitCommitHorizontal size={30} />
          <strong>No local changes</strong>
          <span>There are no uncommitted changes in this branch. Open History to review past commits.</span>
        </div>
      </section>
    )
  }

  return (
    <section className="content-grid changes-workflow-grid">
      <div className="changes-panel changes-panel-compact">
        <div className="changes-topbar">
          <h2>
            Changes
            <span>{counts?.changed ?? 0}</span>
          </h2>
        </div>

        <div className="change-filter-bar change-filter-bar-compact">
          <details className="changes-actions-menu" ref={changesActionsMenuRef}>
            <summary>
              <ListFilter size={16} />
              Actions
            </summary>
            <div className="changes-actions-popover">
              <button
                type="button"
                onClick={() => {
                  closeChangesActionsMenu()
                  void createQuickStash()
                }}
                disabled={busy || !canCreateStash}
              >
                <Save size={15} />
                Stash changes
              </button>
              <label>
                Patch scope
                <select
                  aria-label="Patch export scope"
                  value={patchScope}
                  onChange={(event) => setPatchScope(event.target.value as PatchScope)}
                  disabled={busy}
                >
                  <option value="working-tree">Working tree</option>
                  <option value="staged">Staged</option>
                </select>
              </label>
              <button
                type="button"
                onClick={() => {
                  closeChangesActionsMenu()
                  void exportPatch()
                }}
                disabled={busy || !snapshot}
              >
                <Copy size={15} />
                Export patch
              </button>
              <button
                type="button"
                onClick={() => {
                  closeChangesActionsMenu()
                  void applyPatch()
                }}
                disabled={busy || !snapshot || snapshot.status.merge.operation !== 'none'}
              >
                <ArrowDownToLine size={15} />
                Apply patch
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
          <span>{visibleSummary}{visibleRange}</span>
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
            disabled={busy}
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
              {changesItems.map(({ item: change, index }) => (
                <div
                  className="virtual-list-item"
                  key={change.path}
                  style={{ transform: `translateY(${index * itemHeight}px)` }}
                >
                  <div className={selectedFilePath === change.path ? 'change-row selected' : 'change-row'}>
                    <StageCheckbox
                      change={change}
                      disabled={busy || change.conflicted}
                      onToggle={toggleChangeStage}
                    />
                    <button
                      className="change-select"
                      type="button"
                      title={`${change.path} · ${changeLabel(change)}`}
                      aria-label={`${change.path}, ${changeLabel(change)}`}
                      onClick={() => {
                        setSelectedFilePath(change.path)
                        setDiffMode(getDefaultChangeDiffMode(change))
                      }}
                    >
                      <span className="file-name">{change.path}</span>
                      <span className={`file-status status-${change.status}`}>{statusToken(change)}</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="commit-box">
          <input
            id="commit-title"
            aria-label="Commit title"
            value={commitTitle}
            onChange={(event) => setCommitTitle(event.target.value)}
            placeholder="Summary (required)"
          />
          <textarea
            id="commit-description"
            aria-label="Commit description"
            value={commitDescription}
            onChange={(event) => setCommitDescription(event.target.value)}
            placeholder="Description"
          />
          {coAuthorsVisible && (
            <div className="coauthor-box">
              <textarea
                id="commit-coauthors"
                className="commit-coauthors"
                aria-label="Commit co-authors"
                value={commitCoAuthors}
                onChange={(event) => setCommitCoAuthors(event.target.value)}
                placeholder="Co-authors: Name <email>, one per line"
              />
              <input
                className="coauthor-filter"
                value={coAuthorFilter}
                onChange={(event) => setCoAuthorFilter(event.target.value)}
                placeholder="Add a co-author from contributors…"
                aria-label="Search contributors"
              />
              {coAuthorSuggestions.length > 0 && (
                <div className="coauthor-suggestions">
                  {coAuthorSuggestions.map((contributor) => (
                    <button
                      type="button"
                      key={contributor.email}
                      className="coauthor-chip"
                      title={contributor.login ? `@${contributor.login} · ${contributor.email}` : contributor.email}
                      onClick={() => addCoAuthor(contributor)}
                    >
                      {contributor.avatarUrl
                        ? <img className="coauthor-avatar" src={contributor.avatarUrl} alt="" />
                        : <Users size={13} />}
                      <span>{contributor.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          <div className="commit-assistant-row">
            <button
              className={coAuthorsVisible ? 'icon-button active' : 'icon-button'}
              type="button"
              title="Add co-authors"
              aria-label="Add co-authors"
              aria-pressed={coAuthorsVisible}
              onClick={() => setShowCoAuthors((value) => !value)}
            >
              <Users size={16} />
            </button>
            <select
              id="assistant-select"
              aria-label="Commit text assistant"
              value={selectedAssistant}
              onChange={(event) => setSelectedAssistant(event.target.value as AssistantId)}
            >
              <option value="auto">Auto</option>
              <option value="claude">Claude Code</option>
              <option value="codex">Codex</option>
            </select>
            <button type="button" onClick={generateCommitText} disabled={busy || !counts?.staged || !canGenerateCommitText}>
              <Bot size={17} />
              Generate text
            </button>
            <button type="button" className="secondary" onClick={checkAssistants} disabled={assistantsChecking}>
              {assistantsChecking ? <Loader2 className="spin" size={15} /> : <Bot size={15} />}
              Check
            </button>
          </div>
          {!canGenerateCommitText && (
            <div className="assistant-policy-note">{assistantPolicyBlockedLabel('commit_message', assistantPolicy)}</div>
          )}
          {renderPreCommitReviewPanel()}
          {commitActionState.reasons.length > 0 && (
            <ActionBlockers
              title="Commit blocked"
              reasons={commitActionState.reasons}
            />
          )}
          {commitActionState.enabled && !commitAndPushActionState.enabled && commitAndPushActionState.reasons.length > 0 && (
            <ActionBlockers
              title="Commit & push blocked"
              reasons={commitAndPushActionState.reasons}
            />
          )}
          <div className="commit-actions">
            <button type="button" onClick={commitChanges} disabled={busy || !commitActionState.enabled}>
              <GitCommitHorizontal size={17} />
              Commit
            </button>
            <button type="button" className="danger-button" onClick={amendLastCommit} disabled={busy || !amendCommitActionState.enabled}>
              <Pencil size={17} />
              Amend last
            </button>
            <button
              type="button"
              className="secondary"
              onClick={async () => {
                const committed = await commitChanges()
                if (committed && currentRepoPath) {
                  await runSnapshotAction('Push complete.', () => api!.push(currentRepoPath))
                }
              }}
              disabled={busy || !commitAndPushActionState.enabled}
            >
              <UploadCloud size={17} />
              Commit & push
            </button>
          </div>
        </div>
      </div>

      <div className="diff-panel">
        <div className="panel-heading">
          <div>
            <h2>Diff</h2>
            <p>{selectedChange?.path ?? 'Select a changed file'}</p>
            {selectedDiffStats && (
              <div className="diff-stats" aria-label="Selected file diff stats">
                <span className="additions">+{selectedDiffStats.additions}</span>
                <span className="deletions">-{selectedDiffStats.deletions}</span>
              </div>
            )}
          </div>
          <div className="panel-actions">
            <button
              className="danger-button"
              type="button"
              onClick={discardSelected}
              disabled={busy || !selectedChange || (!selectedChange.unstaged && !selectedChange.untracked)}
            >
              <Trash2 size={17} />
              {selectedChange?.untracked ? 'Delete' : 'Discard'}
            </button>
          </div>
        </div>

        {selectedChange && (
          <div className="diff-options">
            <div className="segmented">
              <button
                className={diffMode === 'unstaged' ? 'active' : ''}
                type="button"
                onClick={() => setDiffMode('unstaged')}
                disabled={!selectedChange.unstaged && !selectedChange.untracked}
              >
                Unstaged
              </button>
              <button
                className={diffMode === 'staged' ? 'active' : ''}
                type="button"
                onClick={() => setDiffMode('staged')}
                disabled={!selectedChange.staged}
              >
                Staged
              </button>
            </div>
            <label className="diff-whitespace-toggle">
              <input
                type="checkbox"
                checked={diffIgnoreWhitespace}
                onChange={(event) => setDiffIgnoreWhitespace(event.target.checked)}
              />
              Ignore whitespace
            </label>
            <div className="segmented diff-display-toggle" aria-label="Diff display mode">
              <button
                className={diffDisplayMode === 'unified' ? 'active' : ''}
                type="button"
                onClick={() => setDiffDisplayMode('unified')}
              >
                Unified
              </button>
              <button
                className={diffDisplayMode === 'split' ? 'active' : ''}
                type="button"
                onClick={() => setDiffDisplayMode('split')}
              >
                Split
              </button>
            </div>
          </div>
        )}

        <DiffPreview
          diff={diff}
          imagePreview={imagePreview}
          mode={diffMode}
          displayMode={diffDisplayMode}
          busy={busy}
          onStageHunk={stageSelectedHunk}
          onUnstageHunk={unstageSelectedHunk}
          onOpenLine={openSelectedFileLineInEditor}
        />
      </div>
    </section>
  )
}
