import { useEffect, useRef, useState, type ComponentType } from 'react'
import {
  AlignLeft, ArrowDownToLine, ArrowUpFromLine, CalendarDays, ChevronDown, Code2,
  DownloadCloud, FileCode2, FolderOpen, GitBranch, GitMerge, GitPullRequest,
  Palette, Pencil, RefreshCcw, Settings, Star, Terminal, Trash2, X, Check
} from 'lucide-react'
import type { ApiResult, BranchPilotApi, RecentRepository, RepositorySnapshot } from '../shared/branchPilot'
import type { ViewMode } from '../lib/viewMode'
import { CreateBranchDialog, MergeBranchDialog, SwitchBranchDialog } from './Dialogs'
import { BranchPilotLogo } from './BrandIcons'

type TabIcon = ComponentType<{ size?: number }>

/** Popular VS Code color themes, applied via document.documentElement[data-theme]. */
const THEMES: { id: string; label: string; dot: string }[] = [
  { id: 'github-light', label: 'GitHub Light', dot: '#2563eb' },
  { id: 'github-dark', label: 'GitHub Dark', dot: '#2f81f7' },
  { id: 'one-dark-pro', label: 'One Dark Pro', dot: '#61afef' },
  { id: 'dracula', label: 'Dracula', dot: '#bd93f9' },
  { id: 'monokai', label: 'Monokai', dot: '#a6e22e' },
  { id: 'nord', label: 'Nord', dot: '#88c0d0' },
  { id: 'night-owl', label: 'Night Owl', dot: '#82aaff' },
  { id: 'tokyo-night', label: 'Tokyo Night', dot: '#7aa2f7' },
  { id: 'solarized-light', label: 'Solarized Light', dot: '#268bd2' }
]

const THEME_KEY = 'bp-theme'

function applyTheme(id: string) {
  const root = document.documentElement
  if (id === 'github-light') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', id)
}

function useTheme(): [string, (id: string) => void] {
  const [theme, setTheme] = useState<string>(() => {
    const saved = typeof localStorage !== 'undefined' ? localStorage.getItem(THEME_KEY) : null
    return saved && THEMES.some((t) => t.id === saved) ? saved : 'github-light'
  })
  useEffect(() => {
    applyTheme(theme)
    try { localStorage.setItem(THEME_KEY, theme) } catch { /* ignore */ }
  }, [theme])
  return [theme, setTheme]
}

const TOOL_TABS: { id: ViewMode; label: string; icon: TabIcon }[] = [
  { id: 'providers', label: 'Pull requests', icon: GitPullRequest },
  { id: 'daily', label: 'Reports', icon: CalendarDays }
]

/** GitHub-Desktop-style top bar: repository + branch pickers, sync actions, and view tabs. */
export function AppShellBar({
  snapshot,
  busy,
  apiReady,
  api,
  currentRepoPath,
  viewMode,
  setViewMode,
  recentRepositories,
  openRepository,
  chooseRepository,
  allReposMode,
  onExitAllRepos,
  onOpenClone,
  hasRemote,
  canFetch,
  canPull,
  canPush,
  selectedFileTarget,
  runSnapshotAction,
  refreshRepository,
  openRepoInEditor,
  openSelectedFileInEditor,
  openRepositoryTerminal
}: {
  snapshot: RepositorySnapshot | null
  busy: boolean
  apiReady: boolean
  api: BranchPilotApi | undefined
  currentRepoPath: string | undefined
  viewMode: ViewMode
  setViewMode: (mode: ViewMode) => void
  recentRepositories: RecentRepository[]
  openRepository: (path: string) => void | Promise<boolean>
  chooseRepository: () => void | Promise<void>
  allReposMode: boolean
  onExitAllRepos: () => void
  onOpenClone: () => void
  hasRemote: boolean
  canFetch: boolean
  canPull: boolean
  canPush: boolean
  selectedFileTarget: string | null
  runSnapshotAction: (label: string, action: () => Promise<ApiResult<RepositorySnapshot>>, progressLabel?: string) => Promise<boolean>
  refreshRepository: () => void | Promise<void>
  openRepoInEditor: () => void | Promise<void>
  openSelectedFileInEditor: () => void | Promise<void>
  openRepositoryTerminal: () => void | Promise<void>
}) {
  const branches = snapshot?.branches ?? []
  const currentBranch = snapshot?.summary.currentBranch ?? null
  const headerRef = useRef<HTMLElement>(null)
  const [showCreateBranch, setShowCreateBranch] = useState(false)
  const [newBranchName, setNewBranchName] = useState('')
  const [pendingSwitch, setPendingSwitch] = useState<string | null>(null)
  const [showMergeInto, setShowMergeInto] = useState(false)
  const [theme, setTheme] = useTheme()
  const [branchAction, setBranchAction] = useState<{ name: string; mode: 'rename' | 'describe' | 'delete' } | null>(null)
  const [branchActionValue, setBranchActionValue] = useState('')
  const hasChanges = (snapshot?.status.counts.changed ?? 0) > 0

  const startBranchAction = (name: string, mode: 'rename' | 'describe' | 'delete', value: string) => {
    setBranchAction({ name, mode })
    setBranchActionValue(value)
  }
  const cancelBranchAction = () => { setBranchAction(null); setBranchActionValue('') }
  const confirmBranchAction = () => {
    if (!branchAction || !currentRepoPath) return
    const { name, mode } = branchAction
    const value = branchActionValue.trim()
    if (mode === 'rename') {
      if (!value || value === name) return cancelBranchAction()
      void runSnapshotAction('Branch renamed.', () => api!.renameBranch({ repoPath: currentRepoPath, oldBranchName: name, newBranchName: value }))
    } else if (mode === 'describe') {
      void runSnapshotAction('Branch description updated.', () => api!.updateBranchDescription({ repoPath: currentRepoPath, branchName: name, description: value }))
    } else if (mode === 'delete') {
      void runSnapshotAction('Branch deleted.', () => api!.deleteBranch({ repoPath: currentRepoPath, branchName: name, confirmed: true, force: false }))
    }
    cancelBranchAction()
  }

  const mergeIntoBranch = (branchName: string) => {
    if (!currentRepoPath) return
    setShowMergeInto(false)
    void runSnapshotAction('Merge complete.', () => api!.mergeBranch({ repoPath: currentRepoPath, branchName }))
  }

  const openCreateBranch = () => {
    setNewBranchName('')
    setShowCreateBranch(true)
  }

  const submitCreateBranch = async () => {
    const branchName = newBranchName.trim()
    if (!branchName || !currentRepoPath) return
    const created = await runSnapshotAction('Branch created.', () => api!.createBranch({ repoPath: currentRepoPath, branchName, description: '' }))
    if (created) {
      setShowCreateBranch(false)
      setNewBranchName('')
    }
  }

  useEffect(() => {
    const closeAll = () => headerRef.current
      ?.querySelectorAll<HTMLDetailsElement>('details.shell-menu[open]')
      .forEach((d) => { d.open = false })
    const onDocClick = (event: MouseEvent) => {
      const target = event.target
      if (!(target instanceof Element) || !target.closest('.shell-menu')) closeAll()
    }
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') closeAll() }
    document.addEventListener('click', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('click', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [])

  // When one menu opens, close any other open menu.
  const handleToggle = (event: { currentTarget: HTMLDetailsElement }) => {
    const opened = event.currentTarget
    if (!opened.open) return
    headerRef.current
      ?.querySelectorAll<HTMLDetailsElement>('details.shell-menu[open]')
      .forEach((d) => { if (d !== opened) d.open = false })
  }

  const closeMenu = (event: { currentTarget: HTMLElement }) => {
    const details = event.currentTarget.closest('details')
    if (details) details.open = false
  }

  const switchBranch = (branchName: string) => {
    if (!currentRepoPath || branchName === currentBranch) return
    if (hasChanges) {
      setPendingSwitch(branchName)
      return
    }
    void runSnapshotAction('Branch switched.', () => api!.switchBranch({ repoPath: currentRepoPath, branchName }))
  }

  const confirmSwitch = (stashChanges: boolean) => {
    const branchName = pendingSwitch
    if (!branchName || !currentRepoPath) return
    setPendingSwitch(null)
    void runSnapshotAction('Branch switched.', () => api!.switchBranch({ repoPath: currentRepoPath, branchName, stashChanges }))
  }

  return (
    <>
    <header className="shell-bar" ref={headerRef}>
      <div className="shell-bar-row">
        <span className="shell-brand" title="BranchPilot" aria-label="BranchPilot">
          <BranchPilotLogo size={24} />
        </span>
        <div className="shell-segments">
        <details className="shell-menu shell-repo" onToggle={handleToggle}>
          <summary>
            <FolderOpen size={17} className="shell-seg-icon" />
            <span className="shell-seg-stack">
              <span className="shell-seg-label">Repository</span>
              <span className="shell-seg-value">
                {allReposMode ? 'All repositories' : snapshot?.summary.name ?? 'No repository'}
              </span>
            </span>
            <ChevronDown size={14} className="shell-seg-caret" />
          </summary>
          <div className="shell-dropdown">
            <button className="shell-dropdown-primary shell-dropdown-top" type="button" disabled={!apiReady || busy} onClick={(event) => { closeMenu(event); void chooseRepository() }}>
              <FolderOpen size={15} />
              Open repository…
            </button>
            <button className="shell-dropdown-primary" type="button" disabled={!apiReady || busy} onClick={(event) => { closeMenu(event); onOpenClone() }}>
              <DownloadCloud size={15} />
              Clone repository…
            </button>
            <div className="shell-dropdown-list" aria-label="Recent repositories">
              {recentRepositories.length === 0 ? (
                <p className="shell-dropdown-empty">No recent repositories.</p>
              ) : (
                recentRepositories.map((repo) => (
                  <button
                    className={!allReposMode && repo.path === currentRepoPath ? 'shell-dropdown-item active' : 'shell-dropdown-item'}
                    type="button"
                    key={repo.path}
                    onClick={(event) => { closeMenu(event); onExitAllRepos(); void openRepository(repo.path) }}
                  >
                    {repo.pinned ? <Star size={13} fill="currentColor" /> : <FolderOpen size={13} />}
                    <span className="shell-dropdown-item-text">
                      <strong>{repo.name}</strong>
                      <span>{repo.path}</span>
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>
        </details>

        {!allReposMode && (
        <>
        <details className="shell-menu shell-branch" onToggle={handleToggle}>
          <summary>
            <GitBranch size={17} className="shell-seg-icon" />
            <span className="shell-seg-stack">
              <span className="shell-seg-label">Current branch</span>
              <span className="shell-seg-value">{currentBranch ?? 'No branch'}</span>
            </span>
            <ChevronDown size={14} className="shell-seg-caret" />
          </summary>
          <div className="shell-dropdown">
            <button className="shell-dropdown-primary shell-dropdown-top" type="button" disabled={!snapshot || busy} onClick={(event) => { closeMenu(event); openCreateBranch() }}>
              <GitBranch size={15} />
              New branch…
            </button>
            <div className="shell-dropdown-list" aria-label="Branches">
              {branches.length === 0 ? (
                <p className="shell-dropdown-empty">No local branches.</p>
              ) : (
                branches.map((branch) => {
                  const editing = branchAction?.name === branch.name
                  if (editing && branchAction?.mode !== 'delete') {
                    return (
                      <form
                        key={branch.name}
                        className="shell-branch-edit"
                        onSubmit={(event) => { event.preventDefault(); confirmBranchAction() }}
                      >
                        <input
                          autoFocus
                          value={branchActionValue}
                          onChange={(event) => setBranchActionValue(event.target.value)}
                          onKeyDown={(event) => { if (event.key === 'Escape') cancelBranchAction() }}
                          placeholder={branchAction?.mode === 'rename' ? 'New branch name' : 'Branch description'}
                        />
                        <button type="submit" className="icon-button" title="Save" aria-label="Save"><Check size={14} /></button>
                        <button type="button" className="icon-button" title="Cancel" aria-label="Cancel" onClick={cancelBranchAction}><X size={14} /></button>
                      </form>
                    )
                  }
                  if (editing && branchAction?.mode === 'delete') {
                    return (
                      <div key={branch.name} className="shell-branch-confirm">
                        <span>Delete <strong>{branch.name}</strong>?</span>
                        <button type="button" className="icon-button danger" title="Confirm delete" aria-label="Confirm delete" onClick={confirmBranchAction}><Check size={14} /></button>
                        <button type="button" className="icon-button" title="Cancel" aria-label="Cancel" onClick={cancelBranchAction}><X size={14} /></button>
                      </div>
                    )
                  }
                  return (
                    <div className={branch.name === currentBranch ? 'shell-branch-row active' : 'shell-branch-row'} key={branch.name}>
                      <button
                        className="shell-branch-pick"
                        type="button"
                        disabled={busy || branch.name === currentBranch}
                        onClick={(event) => { closeMenu(event); switchBranch(branch.name) }}
                      >
                        {branch.name === currentBranch ? <Check size={13} /> : <GitBranch size={13} />}
                        <span className="shell-dropdown-item-text">
                          <strong>{branch.name}</strong>
                          {branch.upstream && <span>{branch.upstream}</span>}
                        </span>
                      </button>
                      <span className="shell-branch-actions">
                        <button type="button" className="icon-button" title="Rename branch" aria-label="Rename branch" disabled={busy} onClick={() => startBranchAction(branch.name, 'rename', branch.name)}><Pencil size={13} /></button>
                        <button type="button" className="icon-button" title="Edit description" aria-label="Edit description" disabled={busy} onClick={() => startBranchAction(branch.name, 'describe', branch.description ?? '')}><AlignLeft size={13} /></button>
                        <button type="button" className="icon-button danger" title="Delete branch" aria-label="Delete branch" disabled={busy || branch.name === currentBranch} onClick={() => startBranchAction(branch.name, 'delete', '')}><Trash2 size={13} /></button>
                      </span>
                    </div>
                  )
                })
              )}
            </div>
            <button className="shell-dropdown-primary shell-dropdown-merge" type="button" disabled={!snapshot || busy || branches.length < 2} onClick={(event) => { closeMenu(event); setShowMergeInto(true) }}>
              <GitMerge size={15} />
              Choose a branch to merge into {currentBranch ?? 'current'}…
            </button>
          </div>
        </details>

        {(() => {
          const ahead = snapshot?.summary.ahead ?? 0
          const behind = snapshot?.summary.behind ?? 0
          const doFetch = () => { if (currentRepoPath) void runSnapshotAction('Fetch complete.', () => api!.fetch(currentRepoPath)) }
          const doPull = () => { if (currentRepoPath) void runSnapshotAction('Pull complete.', () => api!.pull(currentRepoPath)) }
          const doPush = () => { if (currentRepoPath) void runSnapshotAction('Push complete.', () => api!.push(currentRepoPath)) }
          // GitHub-Desktop priority: pull what's behind first, then push what's ahead, else fetch.
          const primary = behind > 0
            ? { label: `Pull origin (${behind})`, Icon: DownloadCloud, run: doPull, disabled: !canPull || busy, hint: hasChanges ? 'Pull origin — uncommitted changes will be stashed first if needed' : 'Pull origin' }
            : ahead > 0
              ? { label: `Push origin (${ahead})`, Icon: ArrowUpFromLine, run: doPush, disabled: !canPush || busy, hint: 'Push origin' }
              : { label: 'Fetch origin', Icon: ArrowDownToLine, run: doFetch, disabled: !canFetch || busy, hint: hasRemote ? 'Fetch origin' : 'No remote configured' }
          return (
            <div className="shell-sync-split">
              <button className="shell-sync-primary" type="button" disabled={primary.disabled} title={primary.hint} onClick={primary.run}>
                <primary.Icon size={16} />
                <span>{primary.label}</span>
                {hasRemote && snapshot && (ahead > 0 || behind > 0) && (
                  <span className="shell-aheadbehind" title="Commits ahead / behind upstream">
                    <ArrowUpFromLine size={12} />{ahead}
                    <ArrowDownToLine size={12} />{behind}
                  </span>
                )}
              </button>
              <details className="shell-menu shell-sync-menu" onToggle={handleToggle}>
                <summary className="shell-sync-caret" title="More sync actions"><ChevronDown size={14} /></summary>
                <div className="shell-dropdown shell-dropdown-right">
                  <button className="shell-dropdown-primary shell-dropdown-top" type="button" disabled={!canFetch || busy} onClick={(event) => { closeMenu(event); doFetch() }}>
                    <ArrowDownToLine size={15} />
                    Fetch origin
                  </button>
                  <button className="shell-dropdown-primary" type="button" disabled={!canPull || busy} onClick={(event) => { closeMenu(event); doPull() }}>
                    <DownloadCloud size={15} />
                    Pull{behind > 0 ? ` (${behind})` : ''}
                  </button>
                  <button className="shell-dropdown-primary" type="button" disabled={!canPush || busy} onClick={(event) => { closeMenu(event); doPush() }}>
                    <ArrowUpFromLine size={15} />
                    Push{ahead > 0 ? ` (${ahead})` : ''}
                  </button>
                </div>
              </details>
            </div>
          )
        })()}
        </>
        )}
        </div>

        {!allReposMode && (
        <div className="shell-repo-actions">
          <button className="icon-button" type="button" title="Refresh repository" aria-label="Refresh repository" disabled={!snapshot || busy} onClick={() => refreshRepository()}>
            <RefreshCcw size={17} />
          </button>
          <button className="icon-button" type="button" title="Open repository in editor" aria-label="Open repository in editor" disabled={!snapshot || busy} onClick={openRepoInEditor}>
            <Code2 size={17} />
          </button>
          <button className="icon-button" type="button" title="Open selected file in editor" aria-label="Open selected file in editor" disabled={!selectedFileTarget || busy} onClick={openSelectedFileInEditor}>
            <FileCode2 size={17} />
          </button>
          <button className="icon-button" type="button" title="Open terminal" aria-label="Open terminal" disabled={!snapshot || busy} onClick={openRepositoryTerminal}>
            <Terminal size={17} />
          </button>
          <button
            className={viewMode === 'config' ? 'icon-button active' : 'icon-button'}
            type="button"
            title={viewMode === 'config' ? 'Back to Changes' : 'Git settings'}
            aria-label="Git settings"
            aria-pressed={viewMode === 'config'}
            disabled={!snapshot || busy}
            onClick={() => setViewMode(viewMode === 'config' ? 'changes' : 'config')}
          >
            <Settings size={17} />
          </button>
        </div>
        )}

        <div className="shell-tabs-tools">
          {TOOL_TABS.filter((tab) => !allReposMode || tab.id === 'daily').map((tab) => {
            const isActive = viewMode === tab.id || (tab.id === 'daily' && viewMode === 'linkedin')
            return (
            <button
              className={isActive ? 'shell-tool active' : 'shell-tool'}
              type="button"
              key={tab.id}
              title={isActive ? `Back to Changes (close ${tab.label})` : tab.label}
              aria-pressed={isActive}
              onClick={() => setViewMode(isActive ? 'changes' : tab.id)}
            >
              <tab.icon size={15} />
              <span>{tab.label}</span>
            </button>
            )
          })}

          <details className="shell-menu shell-theme" onToggle={handleToggle}>
            <summary>
              <span className="shell-seg-value">
                <Palette size={15} />
                <ChevronDown size={14} />
              </span>
            </summary>
            <div className="shell-dropdown shell-theme-dropdown">
              {THEMES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={theme === t.id ? 'shell-theme-item active' : 'shell-theme-item'}
                  onClick={(event) => { closeMenu(event); setTheme(t.id) }}
                >
                  <span className="shell-theme-dot" style={{ background: t.dot }} />
                  <span>{t.label}</span>
                  {theme === t.id && <Check size={14} />}
                </button>
              ))}
            </div>
          </details>
        </div>
      </div>
    </header>
    {showCreateBranch && (
      <CreateBranchDialog
        baseBranch={currentBranch}
        value={newBranchName}
        busy={busy}
        onChange={setNewBranchName}
        onCancel={() => { setShowCreateBranch(false); setNewBranchName('') }}
        onCreate={submitCreateBranch}
      />
    )}
    {pendingSwitch && (
      <SwitchBranchDialog
        fromBranch={currentBranch ?? 'current branch'}
        toBranch={pendingSwitch}
        busy={busy}
        onCancel={() => setPendingSwitch(null)}
        onSwitch={confirmSwitch}
      />
    )}
    {showMergeInto && (
      <MergeBranchDialog
        currentBranch={currentBranch ?? 'current branch'}
        branches={branches}
        busy={busy}
        onCancel={() => setShowMergeInto(false)}
        onMerge={mergeIntoBranch}
      />
    )}
    </>
  )
}
