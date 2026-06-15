import { useEffect, useRef, useState, type ComponentType } from 'react'
import {
  Archive, ArrowDownToLine, ArrowUpFromLine, CalendarDays, ChevronDown, Clock3, Code2, Database,
  DownloadCloud, FileCode2, FileDiff, FolderOpen, GitBranch, GitMerge, GitPullRequest,
  LayoutDashboard, RefreshCcw, Settings, ShieldCheck, Star, Terminal, Check
} from 'lucide-react'
import type { ApiResult, BranchPilotApi, RecentRepository, RepositorySnapshot } from '../shared/branchPilot'
import type { ViewMode } from '../lib/viewMode'
import { CreateBranchDialog, MergeBranchDialog, SwitchBranchDialog } from './Dialogs'
import { LinkedinIcon } from './BrandIcons'

type TabIcon = ComponentType<{ size?: number }>

const PRIMARY_TABS: { id: ViewMode; label: string; icon: TabIcon }[] = [
  { id: 'changes', label: 'Changes', icon: FileDiff },
  { id: 'history', label: 'History', icon: Clock3 }
]

const TOOL_TABS: { id: ViewMode; label: string; icon: TabIcon }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'branches', label: 'Branches', icon: GitBranch },
  { id: 'merge', label: 'Merge', icon: GitMerge },
  { id: 'review', label: 'Review', icon: ShieldCheck },
  { id: 'providers', label: 'Providers', icon: GitPullRequest },
  { id: 'config', label: 'Git Config', icon: Settings },
  { id: 'stash', label: 'Stash', icon: Archive },
  { id: 'memory', label: 'Memory', icon: Database },
  { id: 'daily', label: 'Daily', icon: CalendarDays },
  { id: 'linkedin', label: 'LinkedIn', icon: LinkedinIcon }
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
  changedCount,
  recentRepositories,
  openRepository,
  chooseRepository,
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
  changedCount: number
  recentRepositories: RecentRepository[]
  openRepository: (path: string) => void | Promise<boolean>
  chooseRepository: () => void | Promise<void>
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
  const hasChanges = (snapshot?.status.counts.changed ?? 0) > 0

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
        <details className="shell-menu shell-repo" onToggle={handleToggle}>
          <summary>
            <span className="shell-seg-label">Repository</span>
            <span className="shell-seg-value">
              <FolderOpen size={16} />
              {snapshot?.summary.name ?? 'No repository'}
              <ChevronDown size={14} />
            </span>
          </summary>
          <div className="shell-dropdown">
            <button className="shell-dropdown-primary" type="button" disabled={!apiReady || busy} onClick={(event) => { closeMenu(event); void chooseRepository() }}>
              <FolderOpen size={15} />
              Open repository…
            </button>
            <div className="shell-dropdown-list" aria-label="Recent repositories">
              {recentRepositories.length === 0 ? (
                <p className="shell-dropdown-empty">No recent repositories.</p>
              ) : (
                recentRepositories.map((repo) => (
                  <button
                    className={repo.path === currentRepoPath ? 'shell-dropdown-item active' : 'shell-dropdown-item'}
                    type="button"
                    key={repo.path}
                    onClick={(event) => { closeMenu(event); void openRepository(repo.path) }}
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

        <details className="shell-menu shell-branch" onToggle={handleToggle}>
          <summary>
            <span className="shell-seg-label">Current branch</span>
            <span className="shell-seg-value">
              <GitBranch size={16} />
              {currentBranch ?? 'No branch'}
              <ChevronDown size={14} />
            </span>
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
                branches.map((branch) => (
                  <button
                    className={branch.name === currentBranch ? 'shell-dropdown-item active' : 'shell-dropdown-item'}
                    type="button"
                    key={branch.name}
                    disabled={busy || branch.name === currentBranch}
                    onClick={(event) => { closeMenu(event); switchBranch(branch.name) }}
                  >
                    {branch.name === currentBranch ? <Check size={13} /> : <GitBranch size={13} />}
                    <span className="shell-dropdown-item-text">
                      <strong>{branch.name}</strong>
                      {branch.upstream && <span>{branch.upstream}</span>}
                    </span>
                  </button>
                ))
              )}
            </div>
            <button className="shell-dropdown-primary" type="button" disabled={!snapshot || busy || branches.length < 2} onClick={(event) => { closeMenu(event); setShowMergeInto(true) }}>
              <GitMerge size={15} />
              Merge into {currentBranch ?? 'current'}…
            </button>
            <button className="shell-dropdown-primary" type="button" onClick={(event) => { closeMenu(event); setViewMode('branches') }}>
              <GitBranch size={15} />
              Manage branches, worktrees & tags
            </button>
          </div>
        </details>

        <div className="shell-sync" aria-label="Sync">
          <button className="icon-button" type="button" title="Fetch" aria-label="Fetch" disabled={!canFetch || busy} onClick={() => currentRepoPath && runSnapshotAction('Fetch complete.', () => api!.fetch(currentRepoPath))}>
            <ArrowDownToLine size={17} />
          </button>
          <button className="icon-button" type="button" title="Pull" aria-label="Pull" disabled={!canPull || busy} onClick={() => currentRepoPath && runSnapshotAction('Pull complete.', () => api!.pull(currentRepoPath))}>
            <DownloadCloud size={17} />
          </button>
          <button className="icon-button" type="button" title="Push" aria-label="Push" disabled={!canPush || busy} onClick={() => currentRepoPath && runSnapshotAction('Push complete.', () => api!.push(currentRepoPath))}>
            <ArrowUpFromLine size={17} />
          </button>
          {hasRemote && snapshot && (
            <span className="shell-aheadbehind" title="Commits ahead / behind upstream">
              <ArrowUpFromLine size={12} />{snapshot.summary.ahead}
              <ArrowDownToLine size={12} />{snapshot.summary.behind}
            </span>
          )}
        </div>

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
        </div>
      </div>

      <nav className="shell-tabs" aria-label="Views">
        <div className="shell-tabs-primary">
          {PRIMARY_TABS.map((tab) => (
            <button
              className={viewMode === tab.id ? 'shell-tab active' : 'shell-tab'}
              type="button"
              key={tab.id}
              onClick={() => setViewMode(tab.id)}
            >
              <tab.icon size={16} />
              {tab.label}
              {tab.id === 'changes' && changedCount > 0 && <span className="shell-tab-badge">{changedCount}</span>}
            </button>
          ))}
        </div>
        <div className="shell-tabs-tools">
          {TOOL_TABS.map((tab) => (
            <button
              className={viewMode === tab.id ? 'shell-tool active' : 'shell-tool'}
              type="button"
              key={tab.id}
              title={tab.label}
              onClick={() => setViewMode(tab.id)}
            >
              <tab.icon size={15} />
              <span>{tab.label}</span>
            </button>
          ))}
        </div>
      </nav>
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
