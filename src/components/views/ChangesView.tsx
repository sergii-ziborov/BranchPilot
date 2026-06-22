import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'
import { Archive, ArrowDownToLine, Bot, Clock3, Code2, Columns2, Copy, GitCommitHorizontal, GitPullRequest, ListFilter, MinusSquare, Pencil, Pilcrow, PlusSquare, Rows3, Save, Search, ShieldCheck, Trash2, UploadCloud, Users, X } from 'lucide-react'
import type {
  ApiResult, BranchPilotApi, CoAuthor, DiffHunk, DiffResult, ImagePreview,
  FileChange, PatchScope, RepositorySnapshot
} from '../../shared/branchPilot'
import type { ChangeDiffMode } from '../../shared/changeStaging'
import type { ViewMode } from '../../lib/viewMode'
import { getBulkStageToggleState, getDefaultChangeDiffMode } from '../../shared/changeStaging'
import { ViewSwitch } from '../ViewSwitch'
import { getAmendCommitActionState, getCommitActionState, getCommitAndPushActionState } from '../../shared/commitPreconditions'
import { useVirtualList } from '../../hooks/useVirtualList'
import { changeLabel, statusToken } from '../../lib/fileChangeLabels'
import { DiffPreview } from '../DiffView'
import { BulkStageCheckbox, StageCheckbox } from '../StageCheckbox'

const CHANGES_SPLIT_STORAGE_KEY = 'branchpilot:changes-pane-width'
const DEFAULT_CHANGES_PANE_WIDTH = 430
const MIN_CHANGES_PANE_WIDTH = 320
const MAX_CHANGES_PANE_WIDTH = 760
const MIN_DIFF_PANE_WIDTH = 520
const CHANGES_SPLITTER_WIDTH = 10

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function actionTooltip(actionLabel: string, blockedLabel: string, state: { enabled: boolean; reasons: string[] }, busy: boolean): string {
  if (busy) return 'Another repository operation is running.'
  if (state.enabled) return actionLabel
  return `${blockedLabel}: ${state.reasons.join(' ')}`
}

function buildCoAuthorSuggestions(
  repositoryContributors: CoAuthor[],
  githubContributors: CoAuthor[],
  selectedText: string,
  query: string
): CoAuthor[] {
  const selected = selectedText.toLowerCase()
  const suggestions = new Map<string, CoAuthor>()

  for (const contributor of [...repositoryContributors, ...githubContributors]) {
    if (selected.includes(contributor.email.toLowerCase())) continue

    const login = contributor.login?.toLowerCase()
    if (login && selected.includes(`+${login}@users.noreply.github.com`)) continue

    if (query && ![
      contributor.name,
      contributor.email,
      contributor.login ?? '',
      contributor.organization ?? ''
    ].some((value) => value.toLowerCase().includes(query))) {
      continue
    }

    const key = contributor.email.toLowerCase()
    if (!suggestions.has(key)) suggestions.set(key, contributor)
  }

  return [...suggestions.values()].slice(0, 10)
}

function coAuthorSourceLabel(contributor: CoAuthor): string {
  if (contributor.organization) return `${contributor.organization} member`
  if (contributor.source === 'github') return 'GitHub'
  return 'Repository'
}

function coAuthorTitle(contributor: CoAuthor): string {
  return [
    contributor.login ? `@${contributor.login}` : '',
    contributor.organization ? `from ${contributor.organization}` : coAuthorSourceLabel(contributor),
    contributor.email
  ].filter(Boolean).join(' - ')
}

function clampChangesPaneWidth(width: number, containerWidth?: number): number {
  const maxForContainer = containerWidth && containerWidth > 0
    ? Math.max(MIN_CHANGES_PANE_WIDTH, containerWidth - CHANGES_SPLITTER_WIDTH - MIN_DIFF_PANE_WIDTH)
    : MAX_CHANGES_PANE_WIDTH

  return Math.round(clamp(width, MIN_CHANGES_PANE_WIDTH, Math.min(MAX_CHANGES_PANE_WIDTH, maxForContainer)))
}

function readStoredChangesPaneWidth(): number {
  try {
    const rawWidth = window.localStorage.getItem(CHANGES_SPLIT_STORAGE_KEY)
    if (rawWidth === null) return DEFAULT_CHANGES_PANE_WIDTH

    const stored = Number(rawWidth)
    if (Number.isFinite(stored)) return clampChangesPaneWidth(stored)
  } catch {
    /* ignore unavailable storage */
  }

  return DEFAULT_CHANGES_PANE_WIDTH
}

export function ChangesView({
  snapshot, counts, busy, itemHeight,
  changeFilter, setChangeFilter,
  filteredChanges, virtualChanges,
  changesActionsMenuRef, closeChangesActionsMenu,
  createQuickStash, canCreateStash,
  exportPatch, applyPatch,
  bulkStageToggleState, toggleBulkStage, toggleChangeStage,
  selectedFilePath, setSelectedFilePath, setDiffMode, setViewMode,
  commitTitle, setCommitTitle, commitDescription, setCommitDescription,
  commitCoAuthors, setCommitCoAuthors,
  setNotice, onOpenReview, onOpenStash, stashCount,
  generateCommitText, canGenerateCommitText,
  commitActionState, commitAndPushActionState, amendCommitActionState,
  commitChanges, amendLastCommit,
  currentRepoPath, runSnapshotAction, api,
  selectedChange, selectedDiffStats, discardSelected,
  diffMode, diffDisplayMode, setDiffDisplayMode, diffIgnoreWhitespace, setDiffIgnoreWhitespace,
  diff, imagePreview, stageSelectedHunk, unstageSelectedHunk, discardSelectedHunk, discardSelectedLines
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
  exportPatch: (scope?: PatchScope) => void | Promise<void>
  applyPatch: () => void | Promise<void>
  bulkStageToggleState: ReturnType<typeof getBulkStageToggleState>
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
  discardSelected: (change?: FileChange | null) => void | Promise<void>
  diffMode: ChangeDiffMode
  diffDisplayMode: 'unified' | 'split'
  setDiffDisplayMode: (mode: 'unified' | 'split') => void
  diffIgnoreWhitespace: boolean
  setDiffIgnoreWhitespace: (value: boolean) => void
  diff: DiffResult | null
  imagePreview: ImagePreview | null
  stageSelectedHunk: (hunk: DiffHunk) => void
  unstageSelectedHunk: (hunk: DiffHunk) => void
  discardSelectedHunk: (hunk: DiffHunk) => void
  discardSelectedLines: (patch: string) => void
}) {
    const totalChanges = snapshot?.status.changes.length ?? 0
  const { containerRef: changesContainerRef, onScroll: changesScroll, window: changesWindow, items: changesItems } = virtualChanges
  const splitGridRef = useRef<HTMLElement | null>(null)
  const [changesPaneWidth, setChangesPaneWidth] = useState(readStoredChangesPaneWidth)
  const [showCoAuthors, setShowCoAuthors] = useState(false)
  const coAuthorsVisible = showCoAuthors || commitCoAuthors.trim().length > 0
  const [contributors, setContributors] = useState<CoAuthor[]>([])
  const [githubCoAuthors, setGithubCoAuthors] = useState<CoAuthor[]>([])
  const [githubCoAuthorsLoading, setGithubCoAuthorsLoading] = useState(false)
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
            merged.set(key, { ...contributor, source: 'repository' })
          }
        }
      }
      if (!cancelled) setContributors([...merged.values()])
    }
    void load()
    return () => { cancelled = true }
  }, [coAuthorsVisible, currentRepoPath, api])

  useEffect(() => {
    const query = coAuthorFilter.trim()

    if (!coAuthorsVisible || !currentRepoPath || !api || query.length < 2) {
      setGithubCoAuthors([])
      setGithubCoAuthorsLoading(false)
      return
    }

    let cancelled = false
    setGithubCoAuthorsLoading(true)

    const timeout = window.setTimeout(() => {
      void api.searchGitHubCoAuthors({ repoPath: currentRepoPath, query, limit: 12 })
        .then((result) => {
          if (!cancelled) setGithubCoAuthors(result.ok ? result.data : [])
        })
        .catch(() => {
          if (!cancelled) setGithubCoAuthors([])
        })
        .finally(() => {
          if (!cancelled) setGithubCoAuthorsLoading(false)
        })
    }, 250)

    return () => {
      cancelled = true
      window.clearTimeout(timeout)
    }
  }, [api, coAuthorFilter, coAuthorsVisible, currentRepoPath])

  const addCoAuthor = (contributor: CoAuthor) => {
    if (commitCoAuthors.includes(contributor.email)) return
    const entry = `${contributor.name} <${contributor.email}>`
    setCommitCoAuthors(commitCoAuthors.trim() ? `${commitCoAuthors.trim()}\n${entry}` : entry)
    setCoAuthorFilter('')
  }

  const coAuthorQuery = coAuthorFilter.trim().toLowerCase()
  const coAuthorSuggestions = buildCoAuthorSuggestions(
    contributors,
    githubCoAuthors,
    commitCoAuthors,
    coAuthorQuery
  )
  const commitTooltip = actionTooltip('Commit staged changes', 'Commit blocked', commitActionState, busy)
  const amendTooltip = actionTooltip('Amend the previous commit with current staged changes', 'Amend blocked', amendCommitActionState, busy)
  const commitAndPushTooltip = actionTooltip('Commit staged changes and push to the upstream branch', 'Commit & push blocked', commitAndPushActionState, busy)

  const notifyBlocked = (title: string, reasons: string[]) => {
    setNotice(reasons.length > 0 ? `${title}: ${reasons.join(' · ')}` : title)
  }

  const [diffMenu, setDiffMenu] = useState<{ x: number; y: number; change: FileChange | null } | null>(null)
  const splitStyle = {
    '--changes-pane-width': `${changesPaneWidth}px`,
    '--changes-pane-min-width': `${MIN_CHANGES_PANE_WIDTH}px`,
    '--diff-pane-min-width': `${MIN_DIFF_PANE_WIDTH}px`
  } as CSSProperties

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
    const clampToGrid = () => {
      const grid = splitGridRef.current
      if (!grid) return
      setChangesPaneWidth((width) => clampChangesPaneWidth(width, grid.getBoundingClientRect().width))
    }

    let frame = window.requestAnimationFrame(() => {
      frame = window.requestAnimationFrame(clampToGrid)
    })
    window.addEventListener('resize', clampToGrid)

    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('resize', clampToGrid)
    }
  }, [])

  const persistChangesPaneWidth = (width: number) => {
    try {
      window.localStorage.setItem(CHANGES_SPLIT_STORAGE_KEY, String(width))
    } catch {
      /* ignore unavailable storage */
    }
  }

  const resizeChangesPane = (clientX: number) => {
    const grid = splitGridRef.current
    if (!grid) return changesPaneWidth

    const rect = grid.getBoundingClientRect()
    const nextWidth = clampChangesPaneWidth(clientX - rect.left, rect.width)
    setChangesPaneWidth(nextWidth)
    return nextWidth
  }

  const nudgeChangesPane = (delta: number) => {
    const grid = splitGridRef.current
    const containerWidth = grid?.getBoundingClientRect().width
    setChangesPaneWidth((width) => {
      const nextWidth = clampChangesPaneWidth(width + delta, containerWidth)
      persistChangesPaneWidth(nextWidth)
      return nextWidth
    })
  }

  const startChangesPaneResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return

    event.preventDefault()
    let latestWidth = resizeChangesPane(event.clientX)
    document.body.classList.add('is-resizing-changes')

    const handlePointerMove = (moveEvent: PointerEvent) => {
      latestWidth = resizeChangesPane(moveEvent.clientX)
    }

    const stopResize = () => {
      document.body.classList.remove('is-resizing-changes')
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', stopResize)
      window.removeEventListener('pointercancel', stopResize)
      persistChangesPaneWidth(latestWidth)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', stopResize)
    window.addEventListener('pointercancel', stopResize)
  }

  const handleSplitKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      nudgeChangesPane(event.shiftKey ? -72 : -24)
    } else if (event.key === 'ArrowRight') {
      event.preventDefault()
      nudgeChangesPane(event.shiftKey ? 72 : 24)
    } else if (event.key === 'Home') {
      event.preventDefault()
      setChangesPaneWidth(MIN_CHANGES_PANE_WIDTH)
      persistChangesPaneWidth(MIN_CHANGES_PANE_WIDTH)
    } else if (event.key === 'End') {
      event.preventDefault()
      const grid = splitGridRef.current
      const nextWidth = clampChangesPaneWidth(MAX_CHANGES_PANE_WIDTH, grid?.getBoundingClientRect().width)
      setChangesPaneWidth(nextWidth)
      persistChangesPaneWidth(nextWidth)
    }
  }

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
    void api.openInEditor({ targetPath: `${currentRepoPath}/${change.path}` })
  }

  const copyPathFromMenu = () => {
    const change = diffMenu?.change ?? selectedChange
    setDiffMenu(null)
    if (!change || !currentRepoPath) return
    void navigator.clipboard.writeText(`${currentRepoPath}/${change.path}`)
  }

  const copyNameFromMenu = () => {
    const change = diffMenu?.change ?? selectedChange
    setDiffMenu(null)
    if (!change) return
    void navigator.clipboard.writeText(change.path.split('/').pop() ?? change.path)
  }

  const noChanges = totalChanges === 0
  const contextMenuChange = diffMenu?.change ?? selectedChange
  const canStageSelectedFile = Boolean(selectedChange && (selectedChange.unstaged || selectedChange.untracked))
  const canUnstageSelectedFile = Boolean(selectedChange?.staged)
  const canDiscardSelectedFile = Boolean(selectedChange && (selectedChange.unstaged || selectedChange.untracked))

  return (
    <section className="content-grid changes-workflow-grid" ref={splitGridRef} style={splitStyle}>
      <div className="changes-panel changes-panel-compact">
        <ViewSwitch viewMode="changes" setViewMode={setViewMode} changedCount={counts?.changed ?? 0} />
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
              <div className="changes-actions-section">
                <span>Export patch</span>
                <button
                  type="button"
                  onClick={() => {
                    closeChangesActionsMenu()
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
                    closeChangesActionsMenu()
                    void exportPatch('staged')
                  }}
                  disabled={busy || !snapshot || !counts?.staged}
                >
                  <Copy size={15} />
                  Staged changes
                </button>
              </div>
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
                  <div
                    className={selectedFilePath === change.path ? 'change-row selected' : 'change-row'}
                    onContextMenu={(event) => {
                      event.preventDefault()
                      setDiffMenu({ x: event.clientX, y: event.clientY, change })
                    }}
                  >
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

        {stashCount > 0 && (
          <button type="button" className="stash-bar" onClick={onOpenStash} title="View stashed changes">
            <Archive size={16} />
            <span className="stash-bar-label">Stashed changes</span>
            <span className="stash-bar-count">{stashCount}</span>
          </button>
        )}

        <div className="commit-box">
          <div className="commit-summary-row">
            <input
              id="commit-title"
              aria-label="Commit title"
              value={commitTitle}
              onChange={(event) => setCommitTitle(event.target.value)}
              placeholder="Summary (required)"
            />
            <button
              type="button"
              className="commit-generate"
              title="Generate commit text with the selected AI assistant"
              aria-label="Generate commit text"
              onClick={generateCommitText}
              disabled={busy || !counts?.staged || !canGenerateCommitText}
            >
              <Bot size={16} />
              Generate
            </button>
          </div>
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
                placeholder="Search contributors and organization members..."
                aria-label="Search contributors and GitHub organization members"
              />
              {(coAuthorSuggestions.length > 0 || githubCoAuthorsLoading) && (
                <div className="coauthor-suggestions">
                  {coAuthorSuggestions.map((contributor) => (
                    <button
                      type="button"
                      key={contributor.email}
                      className="coauthor-chip"
                      title={coAuthorTitle(contributor)}
                      onClick={() => addCoAuthor(contributor)}
                    >
                      {contributor.avatarUrl
                        ? <img className="coauthor-avatar" src={contributor.avatarUrl} alt="" />
                        : <Users size={13} />}
                      <span className="coauthor-chip-text">
                        <strong>{contributor.name}</strong>
                        <small>{coAuthorSourceLabel(contributor)}</small>
                      </span>
                    </button>
                  ))}
                  {githubCoAuthorsLoading && <span className="coauthor-searching">Searching GitHub...</span>}
                </div>
              )}
            </div>
          )}
          <div className="commit-actions">
            <button
              className={coAuthorsVisible ? 'icon-button active' : 'icon-button'}
              type="button"
              title={coAuthorsVisible ? 'Hide co-authors' : 'Add co-authors'}
              aria-label="Add co-authors"
              aria-pressed={coAuthorsVisible}
              onClick={() => setShowCoAuthors((value) => !value)}
            >
              <Users size={16} />
            </button>
            <button className="icon-button" type="button" title="Review changes" aria-label="Review changes" onClick={onOpenReview}>
              <ShieldCheck size={16} />
            </button>
            <button
              type="button"
              className={commitActionState.enabled ? undefined : 'blocked'}
              title={commitTooltip}
              aria-disabled={busy || !commitActionState.enabled}
              onClick={() => {
                if (busy) return
                if (!commitActionState.enabled) {
                  notifyBlocked('Commit blocked', commitActionState.reasons)
                  return
                }
                void commitChanges()
              }}
            >
              <GitCommitHorizontal size={17} />
              Commit
            </button>
            <button
              type="button"
              className={amendCommitActionState.enabled ? 'danger-button' : 'danger-button blocked'}
              title={amendTooltip}
              aria-disabled={busy || !amendCommitActionState.enabled}
              onClick={() => {
                if (busy) return
                if (!amendCommitActionState.enabled) {
                  notifyBlocked('Amend blocked', amendCommitActionState.reasons)
                  return
                }
                void amendLastCommit()
              }}
            >
              <Pencil size={17} />
              Amend last
            </button>
            <button
              type="button"
              className={commitAndPushActionState.enabled ? 'secondary' : 'secondary blocked'}
              title={commitAndPushTooltip}
              aria-disabled={busy || !commitAndPushActionState.enabled}
              onClick={async () => {
                if (busy) return
                if (!commitAndPushActionState.enabled) {
                  notifyBlocked('Commit & push blocked', commitAndPushActionState.reasons)
                  return
                }
                const committed = await commitChanges()
                if (committed && currentRepoPath) {
                  await runSnapshotAction('Push complete.', () => api!.push(currentRepoPath))
                }
              }}
            >
              <UploadCloud size={17} />
              Commit & push
            </button>
          </div>
        </div>
      </div>

      <div
        className="changes-splitter"
        role="separator"
        aria-label="Resize changes and diff panes"
        aria-orientation="vertical"
        aria-valuemin={MIN_CHANGES_PANE_WIDTH}
        aria-valuemax={MAX_CHANGES_PANE_WIDTH}
        aria-valuenow={changesPaneWidth}
        tabIndex={0}
        onPointerDown={startChangesPaneResize}
        onKeyDown={handleSplitKeyDown}
      >
        <span />
      </div>

      <div
        className="diff-panel"
        onContextMenu={(event) => {
          if (!selectedChange) return
          event.preventDefault()
          setDiffMenu({ x: event.clientX, y: event.clientY, change: selectedChange })
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
            <button type="button" className="no-changes-card" disabled={!currentRepoPath || busy || !api} onClick={() => currentRepoPath && api && void api.openInEditor({ targetPath: currentRepoPath })}>
              <Code2 size={18} />
              <span className="no-changes-card-text">
                <strong>Open in your editor</strong>
                <span>Edit files in your configured editor.</span>
              </span>
            </button>
            <button type="button" className="no-changes-card" onClick={() => setViewMode('history')}>
              <Clock3 size={18} />
              <span className="no-changes-card-text">
                <strong>Review history</strong>
                <span>Browse past commits on this branch.</span>
              </span>
            </button>
            <button type="button" className="no-changes-card" onClick={() => setViewMode('providers')}>
              <GitPullRequest size={18} />
              <span className="no-changes-card-text">
                <strong>Pull requests</strong>
                <span>Open or create a pull request.</span>
              </span>
            </button>
          </div>
        </div>
        ) : (
        <>
        <div className="panel-heading diff-heading">
          <div className="diff-heading-main">
            <h2>Diff</h2>
            <p>{selectedChange?.path ?? 'Select a changed file'}</p>
            {selectedDiffStats && (
              <div className="diff-stats" aria-label="Selected file diff stats">
                <span className="additions">+{selectedDiffStats.additions}</span>
                <span className="deletions">-{selectedDiffStats.deletions}</span>
              </div>
            )}
          </div>
          <div className="panel-actions diff-controls">
            {selectedChange && (
              <div className="diff-file-actions" aria-label="Selected file actions">
                <button
                  type="button"
                  title="Stage all changes in this file"
                  onClick={stageSelectedFile}
                  disabled={busy || !api || !currentRepoPath || !canStageSelectedFile}
                >
                  <PlusSquare size={15} />
                  Stage
                </button>
                <button
                  type="button"
                  title="Exclude this file from the next commit"
                  onClick={unstageSelectedFile}
                  disabled={busy || !api || !currentRepoPath || !canUnstageSelectedFile}
                >
                  <MinusSquare size={15} />
                  Unstage
                </button>
                <button
                  type="button"
                  className="danger"
                  title={canDiscardSelectedFile ? (selectedChange.untracked ? 'Delete this untracked file' : 'Discard unstaged changes in this file') : 'Unstage this file before discarding staged-only changes'}
                  onClick={discardFromMenu}
                  disabled={busy || !api || !currentRepoPath || !canDiscardSelectedFile}
                >
                  <Trash2 size={15} />
                  {selectedChange.untracked ? 'Delete' : 'Discard'}
                </button>
              </div>
            )}
            <button
              type="button"
              className={diffIgnoreWhitespace ? 'icon-button active' : 'icon-button'}
              title="Ignore whitespace-only changes"
              aria-label="Ignore whitespace"
              aria-pressed={diffIgnoreWhitespace}
              onClick={() => setDiffIgnoreWhitespace(!diffIgnoreWhitespace)}
            >
              <Pilcrow size={16} />
            </button>
            <div className="segmented diff-display-toggle" aria-label="Diff display mode">
              <button
                className={diffDisplayMode === 'unified' ? 'active' : ''}
                type="button"
                title="Unified diff (single column)"
                aria-label="Unified diff"
                onClick={() => setDiffDisplayMode('unified')}
              >
                <Rows3 size={16} />
              </button>
              <button
                className={diffDisplayMode === 'split' ? 'active' : ''}
                type="button"
                title="Split diff (side by side)"
                aria-label="Split diff"
                onClick={() => setDiffDisplayMode('split')}
              >
                <Columns2 size={16} />
              </button>
            </div>
          </div>
        </div>

        <DiffPreview
          diff={diff}
          imagePreview={imagePreview}
          mode={diffMode}
          displayMode={diffDisplayMode}
          busy={busy}
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
          onDiscardLines={discardSelectedLines}
        />
        </>
        )}

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
      </div>
    </section>
  )
}
