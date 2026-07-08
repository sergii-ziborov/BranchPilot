import { useMemo } from 'react'
import { ArrowDownToLine, ArrowUpFromLine, ChevronDown, DownloadCloud, FolderOpen, Star } from 'lucide-react'
import { useController } from '../../hooks/AppControllerContext'

/** Repository picker segment: open/clone actions plus the recent-repositories list
 *  with per-repo dirty/ahead/behind badges. */
export function ShellRepositoryMenu({
  onOpenClone,
  handleToggle,
  closeMenu
}: {
  onOpenClone: () => void
  handleToggle: (event: { currentTarget: HTMLDetailsElement }) => void
  closeMenu: (event: { currentTarget: HTMLElement }) => void
}) {
  const {
    snapshot, busy, currentRepoPath,
    recentRepositories, openRepository, chooseRepository,
    allReposMode, setAllReposMode, repositoryDashboard
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

  return (
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
  )
}
