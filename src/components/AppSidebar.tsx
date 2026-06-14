import {
  CalendarDays, Check, Clock3, Database, FolderOpen, GitBranch, GitCommitHorizontal,
  GitMerge, GitPullRequest, LayoutDashboard, Save, Search, Settings, ShieldCheck, Star, X
} from 'lucide-react'
import type { RecentRepository, RepositorySnapshot } from '../shared/branchPilot'
import type { ViewMode } from '../lib/viewMode'

const navigation: { id: ViewMode; label: string; icon: typeof LayoutDashboard }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'changes', label: 'Changes', icon: GitCommitHorizontal },
  { id: 'history', label: 'History', icon: Clock3 },
  { id: 'merge', label: 'Merge', icon: GitMerge },
  { id: 'branches', label: 'Branches', icon: GitBranch },
  { id: 'config', label: 'Git Config', icon: Settings },
  { id: 'stash', label: 'Stash', icon: Save },
  { id: 'review', label: 'Review', icon: ShieldCheck },
  { id: 'providers', label: 'Providers', icon: GitPullRequest },
  { id: 'memory', label: 'Memory', icon: Database },
  { id: 'daily', label: 'Daily', icon: CalendarDays },
  { id: 'linkedin', label: 'LinkedIn', icon: Star }
]

/** Left navigation sidebar: brand, repo picker, view nav, recent repositories. */
export function AppSidebar({
  apiReady,
  busy,
  snapshot,
  viewMode,
  setViewMode,
  chooseRepository,
  filteredRecentRepositories,
  recentRepositories,
  recentRepositoryFilter,
  setRecentRepositoryFilter,
  openRepository,
  toggleRepositoryPinned,
  appVersion
}: {
  apiReady: boolean
  busy: boolean
  snapshot: RepositorySnapshot | null
  viewMode: ViewMode
  setViewMode: (mode: ViewMode) => void
  chooseRepository: () => void | Promise<void>
  filteredRecentRepositories: RecentRepository[]
  recentRepositories: RecentRepository[]
  recentRepositoryFilter: string
  setRecentRepositoryFilter: (value: string) => void
  openRepository: (path: string) => void | Promise<boolean>
  toggleRepositoryPinned: (repo: RecentRepository) => void | Promise<void>
  appVersion: string
}) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">BP</div>
        <div>
          <strong>BranchPilot</strong>
          <span>Local-first Git client</span>
        </div>
      </div>

      <button className="repo-picker" type="button" onClick={chooseRepository} disabled={!apiReady || busy}>
        <FolderOpen size={18} />
        <span>{snapshot?.summary.name ?? 'Open repository'}</span>
      </button>

      <nav className="nav-list" aria-label="Primary">
        {navigation.map((item) => (
          <button
            className={viewMode === item.id ? 'active' : ''}
            type="button"
            key={item.id}
            onClick={() => setViewMode(item.id)}
          >
            <item.icon size={18} />
            {item.label}
          </button>
        ))}
      </nav>

      <div className="recent-list">
        <div className="recent-list-heading">
          <span className="section-label">Recent repositories</span>
          <span>{filteredRecentRepositories.length} / {recentRepositories.length}</span>
        </div>
        {recentRepositories.length > 0 && (
          <div className="recent-filter">
            <label htmlFor="recent-repository-filter">
              <Search size={14} />
              <input
                id="recent-repository-filter"
                value={recentRepositoryFilter}
                onChange={(event) => setRecentRepositoryFilter(event.target.value)}
                placeholder="Search repos"
              />
            </label>
            {recentRepositoryFilter && (
              <button type="button" aria-label="Clear repository search" onClick={() => setRecentRepositoryFilter('')}>
                <X size={14} />
              </button>
            )}
          </div>
        )}
        {recentRepositories.length === 0 ? (
          <p>No recent repositories.</p>
        ) : filteredRecentRepositories.length === 0 ? (
          <p>No repositories match this search.</p>
        ) : (
          filteredRecentRepositories.map((repo) => (
            <article className={repo.pinned ? 'recent-repo-row pinned' : 'recent-repo-row'} key={repo.path}>
              <button className="recent-repo-open" type="button" onClick={() => openRepository(repo.path)}>
                <strong>{repo.name}</strong>
                <span>{repo.path}</span>
              </button>
              <button
                className={repo.pinned ? 'recent-pin-button pinned' : 'recent-pin-button'}
                type="button"
                aria-label={repo.pinned ? `Unpin ${repo.name}` : `Pin ${repo.name}`}
                title={repo.pinned ? 'Unpin repository' : 'Pin repository'}
                onClick={() => toggleRepositoryPinned(repo)}
                disabled={!apiReady || busy}
              >
                <Star size={16} fill={repo.pinned ? 'currentColor' : 'none'} />
              </button>
            </article>
          ))
        )}
      </div>

      <div className="runtime-status">
        <span>
          <Check size={15} />
          v{appVersion}
        </span>
      </div>
    </aside>
  )
}
