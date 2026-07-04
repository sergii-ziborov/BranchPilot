import { useEffect, useMemo, useRef, useState, type ComponentType } from 'react'
import {
  AlignLeft, ArrowDownToLine, ArrowUpFromLine, CalendarDays, ChevronDown,
  DownloadCloud, FolderOpen, GitBranch, GitMerge, GitPullRequest,
  Palette, Pencil, RefreshCcw, Settings, Star, Trash2, UploadCloud, X, Check
} from 'lucide-react'
import type { ViewMode } from '../lib/viewMode'
import { CreateBranchDialog, MergeBranchDialog, SwitchBranchDialog } from './Dialogs'
import { BranchPilotLogo } from './BrandIcons'
import { IconButton } from './IconButton'
import { useController } from '../hooks/AppControllerContext'
import { APP_THEMES, useAppTheme } from '../hooks/useAppTheme'
import { mergeBranchCandidates } from '../lib/mergeCandidates'

type TabIcon = ComponentType<{ size?: number }>

const TOOL_TABS: { id: ViewMode; label: string; icon: TabIcon }[] = [
  { id: 'providers', label: 'Pull requests', icon: GitPullRequest },
  { id: 'daily', label: 'Reports', icon: CalendarDays }
]

/** GitHub-Desktop-style top bar: repository + branch pickers, sync actions, and view tabs. */
export function AppShellBar({
  onOpenClone,
  onOpenPublishRepository
}: {
  onOpenClone: () => void
  onOpenPublishRepository: () => void
}) {
  const {
    snapshot, busy, currentRepoPath, viewMode, setViewMode,
    recentRepositories, openRepository, chooseRepository,
    allReposMode, setAllReposMode, hasRemote, canFetch, canPull, canPush,
    runSnapshotAction, requestConfirmation, refreshRepository,
    repositoryDashboard
  } = useController()
  const api = window.branchPilot
  const apiReady = Boolean(api)
  const onExitAllRepos = () => setAllReposMode(false)
  const repoStatuses: Record<string, { state: string; changed: number; ahead: number; behind: number }> = useMemo(() => {
    const statuses: Record<string, { state: string; changed: number; ahead: number; behind: number }> = Object.fromEntries(
      (repositoryDashboard?.repositories ?? []).map((r) => [
        r.path,
        { state: r.state, changed: r.changed, ahead: r.ahead, behind: r.behind }
      ])
    )

    if (snapshot) {
      statuses[snapshot.summary.rootPath] = {
        state: snapshot.status.counts.conflicted > 0 ? 'conflicted' : snapshot.status.counts.changed > 0 ? 'dirty' : 'clean',
        changed: snapshot.status.counts.changed,
        ahead: snapshot.summary.ahead,
        behind: snapshot.summary.behind
      }
    }

    return statuses
  }, [repositoryDashboard, snapshot])
  const branches = snapshot?.branches ?? []
  const remoteBranches = snapshot?.remoteBranches ?? []
  const mergeCandidates = mergeBranchCandidates(snapshot)
  const currentBranch = snapshot?.summary.currentBranch ?? null
  // Remote branches that have no local counterpart — surfaced in the switcher so
  // you can check one out (git switch DWIMs a local tracking branch from its
  // short name). Mirrors the dedup the merge dialog uses.
  const localBranchNames = new Set(branches.map((branch) => branch.name))
  const switchableRemoteBranches = remoteBranches.filter(
    (branch) =>
      Boolean(branch.branchName) &&
      branch.branchName !== 'HEAD' &&
      !localBranchNames.has(branch.branchName) &&
      !localBranchNames.has(branch.name)
  )
  const headerRef = useRef<HTMLElement>(null)
  const [showCreateBranch, setShowCreateBranch] = useState(false)
  const [newBranchName, setNewBranchName] = useState('')
  const [newBranchBaseRef, setNewBranchBaseRef] = useState('')
  const [createBranchStep, setCreateBranchStep] = useState<'name' | 'options'>('name')
  const [createBranchChangesMode, setCreateBranchChangesMode] = useState<'move' | 'leave'>('move')
  const [pendingSwitch, setPendingSwitch] = useState<string | null>(null)
  const [showMergeInto, setShowMergeInto] = useState(false)
  const [theme, setTheme] = useAppTheme()
  const [branchAction, setBranchAction] = useState<{ name: string; mode: 'rename' | 'describe' | 'delete' } | null>(null)
  const [branchActionValue, setBranchActionValue] = useState('')
  const [branchMenuOpen, setBranchMenuOpen] = useState(false)
  const hasChanges = (snapshot?.status.counts.changed ?? 0) > 0

  const startBranchAction = (name: string, mode: 'rename' | 'describe' | 'delete', value: string) => {
    setBranchAction({ name, mode })
    setBranchActionValue(value)
    setBranchMenuOpen(true)
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
    setNewBranchBaseRef(currentBranch ?? 'HEAD')
    setCreateBranchStep('name')
    setCreateBranchChangesMode('move')
    setShowCreateBranch(true)
  }

  const cancelCreateBranch = () => {
    setShowCreateBranch(false)
    setNewBranchName('')
    setNewBranchBaseRef('')
    setCreateBranchStep('name')
    setCreateBranchChangesMode('move')
  }

  const submitCreateBranch = async () => {
    const branchName = newBranchName.trim()
    if (!branchName || !currentRepoPath) return
    const created = await runSnapshotAction('Branch created.', () => api!.createBranch({
      repoPath: currentRepoPath,
      branchName,
      baseRef: newBranchBaseRef.trim() || undefined,
      checkout: !hasChanges || createBranchChangesMode === 'move',
      description: ''
    }))
    if (created) {
      cancelCreateBranch()
    }
  }

  useEffect(() => {
    const closeAll = () => {
      setBranchMenuOpen(false)
      setBranchAction(null)
      setBranchActionValue('')
      headerRef.current
        ?.querySelectorAll<HTMLDetailsElement>('details.shell-menu[open]')
        .forEach((d) => { d.open = false })
    }
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
    if (opened.classList.contains('shell-branch')) {
      setBranchMenuOpen(opened.open)
      if (!opened.open) {
        setBranchAction(null)
        setBranchActionValue('')
      }
    }
    if (!opened.open) return
    headerRef.current
      ?.querySelectorAll<HTMLDetailsElement>('details.shell-menu[open]')
      .forEach((d) => {
        if (d !== opened) {
          if (d.classList.contains('shell-branch')) {
            setBranchMenuOpen(false)
          }
          d.open = false
        }
      })
  }

  const closeMenu = (event: { currentTarget: HTMLElement }) => {
    const details = event.currentTarget.closest('details')
    if (details) {
      if (details.classList.contains('shell-branch')) {
        setBranchMenuOpen(false)
        setBranchAction(null)
        setBranchActionValue('')
      }
      details.open = false
    }
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
                recentRepositories.map((repo) => {
                  const st = repoStatuses[repo.path]
                  return (
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
                    {st && (st.changed > 0 || st.ahead > 0 || st.behind > 0 || st.state === 'conflicted') && (
                      <span className="shell-repo-status">
                        {st.behind > 0 && (
                          <span className="shell-repo-ab" title={`${st.behind} commit(s) behind`}>
                            <ArrowDownToLine size={11} />{st.behind}
                          </span>
                        )}
                        {st.ahead > 0 && (
                          <span className="shell-repo-ab" title={`${st.ahead} commit(s) ahead`}>
                            <ArrowUpFromLine size={11} />{st.ahead}
                          </span>
                        )}
                        {st.changed > 0 && (
                          <span
                            className={st.state === 'conflicted' ? 'shell-repo-dot conflicted' : 'shell-repo-dot dirty'}
                            title={`${st.changed} uncommitted change(s)${st.state === 'conflicted' ? ' · conflicts' : ''}`}
                          >
                            {st.changed}
                          </span>
                        )}
                      </span>
                    )}
                  </button>
                  )
                })
              )}
            </div>
          </div>
        </details>

        {!allReposMode && (
        <>
        <details className="shell-menu shell-branch" open={branchMenuOpen} onToggle={handleToggle}>
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
                        <button type="submit" className="icon-button" title="Save" aria-label="Save" onClick={(event) => event.stopPropagation()}><Check size={14} /></button>
                        <button type="button" className="icon-button" title="Cancel" aria-label="Cancel" onClick={(event) => { event.stopPropagation(); cancelBranchAction() }}><X size={14} /></button>
                      </form>
                    )
                  }
                  if (editing && branchAction?.mode === 'delete') {
                    return (
                      <div key={branch.name} className="shell-branch-confirm">
                        <span>Delete <strong>{branch.name}</strong>?</span>
                        <button type="button" className="icon-button danger" title="Confirm delete" aria-label="Confirm delete" onClick={(event) => { event.stopPropagation(); confirmBranchAction() }}><Check size={14} /></button>
                        <button type="button" className="icon-button" title="Cancel" aria-label="Cancel" onClick={(event) => { event.stopPropagation(); cancelBranchAction() }}><X size={14} /></button>
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
                        <button type="button" className="icon-button" title="Rename branch" aria-label="Rename branch" disabled={busy} onClick={(event) => { event.stopPropagation(); startBranchAction(branch.name, 'rename', branch.name) }}><Pencil size={13} /></button>
                        <button type="button" className="icon-button" title="Edit description" aria-label="Edit description" disabled={busy} onClick={(event) => { event.stopPropagation(); startBranchAction(branch.name, 'describe', branch.description ?? '') }}><AlignLeft size={13} /></button>
                        <button type="button" className="icon-button danger" title="Delete branch" aria-label="Delete branch" disabled={busy || branch.name === currentBranch} onClick={(event) => { event.stopPropagation(); startBranchAction(branch.name, 'delete', '') }}><Trash2 size={13} /></button>
                      </span>
                    </div>
                  )
                })
              )}
              {switchableRemoteBranches.length > 0 && (
                <>
                  <p className="shell-dropdown-section">Remote branches</p>
                  {switchableRemoteBranches.map((branch) => (
                    <div className="shell-branch-row" key={branch.name}>
                      <button
                        className="shell-branch-pick"
                        type="button"
                        disabled={busy}
                        title={`Check out ${branch.branchName} (tracking ${branch.name})`}
                        onClick={(event) => { closeMenu(event); switchBranch(branch.branchName) }}
                      >
                        <GitBranch size={13} />
                        <span className="shell-dropdown-item-text">
                          <strong>{branch.branchName}</strong>
                          <span>{branch.name}</span>
                        </span>
                      </button>
                    </div>
                  ))}
                </>
              )}
            </div>
            <button className="shell-dropdown-primary shell-dropdown-merge" type="button" disabled={!snapshot || busy || mergeCandidates.length === 0} onClick={(event) => { closeMenu(event); setShowMergeInto(true) }}>
              <GitMerge size={15} />
              Choose a branch to merge into {currentBranch ?? 'current'}…
            </button>
          </div>
        </details>

        {(() => {
          const ahead = snapshot?.summary.ahead ?? 0
          const behind = snapshot?.summary.behind ?? 0
          const doFetch = () => { if (currentRepoPath) void runSnapshotAction('Fetch complete.', () => api!.fetch(currentRepoPath), 'Fetching origin...') }
          const doPull = () => { if (currentRepoPath) void runSnapshotAction('Pull complete.', () => api!.pull(currentRepoPath), 'Pulling origin...') }
          const doPush = () => { if (currentRepoPath) void runSnapshotAction('Push complete.', () => api!.push(currentRepoPath), 'Pushing origin...') }
          const doForcePush = async () => {
            if (!currentRepoPath) return
            const confirmed = await requestConfirmation(
              `Force push ${currentBranch ?? 'the current branch'} with lease? This can rewrite the remote branch if it still points to the value you last fetched.`,
              { title: 'Force Push', confirmLabel: 'Force push with lease', variant: 'danger' }
            )
            if (!confirmed) return
            void runSnapshotAction('Force push complete.', () => api!.forcePush({ repoPath: currentRepoPath, confirmed }), 'Force pushing with lease...')
          }
          const doPublishRepository = () => { if (snapshot) onOpenPublishRepository() }
          // GitHub-Desktop priority: pull what's behind first, then push what's ahead, else fetch.
          const remotePrimary = behind > 0
            ? { label: `Pull origin (${behind})`, Icon: DownloadCloud, run: doPull, disabled: !canPull || busy, hint: hasChanges ? 'Pull origin — uncommitted changes will be stashed first if needed' : 'Pull origin' }
            : ahead > 0
              ? { label: `Push origin (${ahead})`, Icon: ArrowUpFromLine, run: doPush, disabled: !canPush || busy, hint: 'Push origin' }
              : { label: 'Fetch origin', Icon: ArrowDownToLine, run: doFetch, disabled: !canFetch || busy, hint: hasRemote ? 'Fetch origin' : 'No remote configured' }
          const primary = hasRemote
            ? remotePrimary
            : { label: 'Publish repository', Icon: UploadCloud, run: doPublishRepository, disabled: !snapshot || busy, hint: 'Create a GitHub repository and add origin' }

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
                  {!hasRemote && (
                    <button className="shell-dropdown-primary shell-dropdown-top" type="button" disabled={!snapshot || busy} onClick={(event) => { closeMenu(event); doPublishRepository() }}>
                      <UploadCloud size={15} />
                      Publish repository...
                    </button>
                  )}
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
                  <button className="shell-dropdown-primary danger" type="button" disabled={!canPush || busy} onClick={(event) => { closeMenu(event); void doForcePush() }}>
                    <UploadCloud size={15} />
                    Force push with lease
                  </button>
                </div>
              </details>
            </div>
          )
        })()}
        </>
        )}
        </div>

        <div className="shell-tabs-tools">
          {TOOL_TABS.filter((tab) => !allReposMode || tab.id === 'daily').map((tab) => {
            const isActive = viewMode === tab.id || (tab.id === 'daily' && (viewMode === 'linkedin' || viewMode === 'memory' || viewMode === 'wiki' || viewMode === 'mcp'))
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

          {!allReposMode && (
            <>
              <IconButton icon={<RefreshCcw size={17} />} label="Refresh repository" disabled={!snapshot || busy} onClick={() => refreshRepository()} />
              <IconButton
                icon={<Settings size={17} />}
                label="Git settings"
                title={viewMode === 'config' ? 'Back to Changes' : 'Git settings'}
                active={viewMode === 'config'}
                disabled={!snapshot || busy}
                onClick={() => setViewMode(viewMode === 'config' ? 'changes' : 'config')}
              />
            </>
          )}

          <details className="shell-menu shell-theme" onToggle={handleToggle}>
            <summary>
              <span className="shell-seg-value">
                <Palette size={15} />
                <ChevronDown size={14} />
              </span>
            </summary>
            <div className="shell-dropdown shell-theme-dropdown">
              {APP_THEMES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={theme === t.id ? 'shell-theme-item active' : 'shell-theme-item'}
                  onClick={(event) => { closeMenu(event); setTheme(t.id) }}
                >
                  <span className="shell-theme-dot" style={{ background: t.dot }} />
                  <span>
                    <strong>{t.label}</strong>
                    <small>{t.description}</small>
                  </span>
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
        branches={branches}
        remoteBranches={remoteBranches}
        value={newBranchName}
        step={createBranchStep}
        baseRef={newBranchBaseRef}
        changesMode={createBranchChangesMode}
        hasChanges={hasChanges}
        changeCount={snapshot?.status.counts.changed ?? 0}
        busy={busy}
        onChange={setNewBranchName}
        onBaseRefChange={setNewBranchBaseRef}
        onChangesModeChange={setCreateBranchChangesMode}
        onBack={() => setCreateBranchStep('name')}
        onNext={() => setCreateBranchStep('options')}
        onCancel={cancelCreateBranch}
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
        branches={mergeCandidates}
        busy={busy}
        onCancel={() => setShowMergeInto(false)}
        onMerge={mergeIntoBranch}
      />
    )}
    </>
  )
}
