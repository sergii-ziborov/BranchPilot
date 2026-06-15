import { ExternalLink, FolderOpen, GitMerge, GitPullRequest, Loader2, RefreshCcw, Search, X } from 'lucide-react'
import type { ContributionGraph, GitHubCliStatus, GitHubPullRequest, RepositoryDashboardSnapshot } from '../../shared/branchPilot'
import { ContributionHeatmap } from '../ContributionHeatmap'
import type { ViewMode } from '../../lib/viewMode'
import { dashboardRepoMeta, dashboardStateLabel, matchesDashboardRepository, matchesDashboardStaleBranch } from '../../lib/dashboardLabels'
import { formatDate } from '../../lib/format'
import { Stat } from '../primitives'

export function DashboardView({
  repositoryDashboard,
  contributionGraph,
  dashboardRepositoryFilter,
  setDashboardRepositoryFilter,
  currentPullRequest,
  githubCliStatus,
  pullRequests,
  dashboardLoading,
  busy,
  loadRepositoryDashboard,
  openRepository,
  setViewMode,
  openExternalLink
}: {
  repositoryDashboard: RepositoryDashboardSnapshot | null
  contributionGraph: ContributionGraph | null
  dashboardRepositoryFilter: string
  setDashboardRepositoryFilter: (value: string) => void
  currentPullRequest: GitHubPullRequest | null
  githubCliStatus: GitHubCliStatus | null
  pullRequests: GitHubPullRequest[]
  dashboardLoading: boolean
  busy: boolean
  loadRepositoryDashboard: () => void | Promise<void>
  openRepository: (path: string) => Promise<boolean>
  setViewMode: (mode: ViewMode) => void
  openExternalLink: (url: string | undefined, label?: string) => void
}) {
    const dashboard = repositoryDashboard
  const repositories = dashboard?.repositories ?? []
  const dashboardQuery = dashboardRepositoryFilter.trim().toLowerCase()
  const filteredRepositories = dashboardQuery
    ? repositories.filter((repo) => matchesDashboardRepository(repo, dashboardQuery))
    : repositories
  const attentionRepositories = filteredRepositories.filter((repo) => repo.state !== 'clean' || repo.ahead > 0 || repo.behind > 0)
  const conflictedRepositories = filteredRepositories.filter((repo) => repo.state === 'conflicted')
  const staleBranches = (dashboard?.staleBranches ?? []).filter((branch) =>
    !dashboardQuery || matchesDashboardStaleBranch(branch, dashboardQuery)
  )
  const currentPrSummary = currentPullRequest
    ? `#${currentPullRequest.number} · ${currentPullRequest.state}${currentPullRequest.draft ? ' · draft' : ''}`
    : githubCliStatus?.ghAuthenticated
      ? 'Open Providers to load pull requests.'
      : 'GitHub CLI auth is needed for PR attention.'

  return (
    <section className="single-panel dashboard-panel">
      <div className="panel-heading">
        <div>
          <h2>Dashboard</h2>
          <p>
            {dashboard
              ? `${dashboard.totals.repositories} repositories scanned · generated ${formatDate(dashboard.generatedAt)}`
              : 'Scan recent repositories for worktree, sync, conflict, PR, and stale branch signals.'}
          </p>
        </div>
        <button type="button" onClick={loadRepositoryDashboard} disabled={dashboardLoading || busy}>
          {dashboardLoading ? <Loader2 className="spin" size={17} /> : <RefreshCcw size={17} />}
          Refresh
        </button>
      </div>

      {dashboardLoading && !dashboard ? (
        <div className="quiet-box">Scanning recent repositories.</div>
      ) : !dashboard ? (
        <div className="quiet-box">Dashboard is not loaded yet.</div>
      ) : (
        <>
          <section className="dashboard-heatmap-card">
            <div className="dashboard-section-heading">
              <div>
                <h3>Commit activity</h3>
                <p>Commits across your repositories over the last year.</p>
              </div>
            </div>
            <ContributionHeatmap graph={contributionGraph} />
          </section>

          <details className="dashboard-all-repos">
            <summary>
              <span>All repositories</span>
              <span className="dashboard-all-repos-meta">{dashboard.totals.repositories} scanned</span>
            </summary>
          <div className="dashboard-stat-grid" aria-label="Dashboard totals">
            <Stat
              label="Dirty repos"
              value={dashboard.totals.dirty}
              tone={dashboard.totals.dirty > 0 ? 'warn' : 'ok'}
              hint="Repositories with uncommitted changes in the working tree"
            />
            <Stat
              label="Conflicts"
              value={dashboard.totals.conflicted}
              tone={dashboard.totals.conflicted > 0 ? 'danger' : 'ok'}
              hint="Repositories in a merge, rebase, or cherry-pick conflict"
            />
            <Stat
              label="Ahead / behind"
              value={`${dashboard.totals.ahead} / ${dashboard.totals.behind}`}
              tone="info"
              hint="Total commits ahead of and behind upstream across repositories"
            />
            <Stat
              label="Stale branches"
              value={dashboard.totals.staleBranches}
              tone={dashboard.totals.staleBranches > 0 ? 'warn' : 'ok'}
              hint={`Local branches with no commits for over ${dashboard.staleBranchThresholdDays} days`}
            />
          </div>

          <div className="dashboard-filter-bar">
            <label className="list-filter-input" htmlFor="dashboard-repository-filter">
              <Search size={16} />
              <input
                id="dashboard-repository-filter"
                value={dashboardRepositoryFilter}
                onChange={(event) => setDashboardRepositoryFilter(event.target.value)}
                placeholder="Search repositories, branches, remotes"
              />
            </label>
            <span>
              {filteredRepositories.length} / {repositories.length} repos
              {dashboardQuery ? ` · ${staleBranches.length} stale branches` : ''}
            </span>
            {dashboardRepositoryFilter && (
              <button type="button" className="secondary" onClick={() => setDashboardRepositoryFilter('')}>
                <X size={15} />
                Clear
              </button>
            )}
          </div>

          <div className="dashboard-workspace">
            <section className="dashboard-section">
              <div className="dashboard-section-heading">
                <div>
                  <h3>Repository attention</h3>
                  <p>Dirty, conflicted, ahead, behind, and unavailable repositories.</p>
                </div>
                <span className="dash-count tone-warn">{attentionRepositories.length}</span>
              </div>
              {attentionRepositories.length === 0 ? (
                <div className="quiet-box">No repository needs attention.</div>
              ) : (
                <div className="dashboard-repo-list">
                  {attentionRepositories.map((repo) => (
                    <article className={`dashboard-repo-row state-${repo.state}`} key={repo.path}>
                      <div>
                        <strong>{repo.name}</strong>
                        <span>{dashboardRepoMeta(repo)}</span>
                        <p>{repo.error ?? repo.path}</p>
                      </div>
                      <div className="dashboard-repo-metrics">
                        <span className={`dashboard-state-badge state-badge-${repo.state}`} title="Repository working-tree state">{dashboardStateLabel(repo)}</span>
                        <span title="Changed files in the working tree">{repo.changed} changed</span>
                        <span title="Commits ahead / behind upstream">{repo.ahead} / {repo.behind}</span>
                      </div>
                      <button className="secondary icon-button" type="button" title="Open repository" aria-label="Open repository" onClick={() => openRepository(repo.path)} disabled={busy || repo.state === 'unavailable'}>
                        <FolderOpen size={16} />
                      </button>
                    </article>
                  ))}
                </div>
              )}
            </section>

            <section className="dashboard-section">
              <div className="dashboard-section-heading">
                <div>
                  <h3>PR/MR attention</h3>
                  <p>Current branch pull request signal from the GitHub CLI bridge.</p>
                </div>
                <span className="dash-count tone-info">{pullRequests.length > 0 ? pullRequests.length : <GitPullRequest size={15} />}</span>
              </div>
              <article className="dashboard-callout">
                <strong>{currentPullRequest?.title ?? 'Current branch PR'}</strong>
                <span>{currentPrSummary}</span>
                {pullRequests.length > 0 && <p>{pullRequests.length} recent GitHub pull request{pullRequests.length === 1 ? '' : 's'} loaded.</p>}
                <div className="panel-actions">
                  <button type="button" onClick={() => setViewMode('providers')} disabled={busy}>
                    <GitPullRequest size={16} />
                    Providers
                  </button>
                  {currentPullRequest && (
                    <button type="button" className="secondary" onClick={() => openExternalLink(currentPullRequest.url, 'Pull request link')}>
                      <ExternalLink size={16} />
                      Open PR
                    </button>
                  )}
                </div>
              </article>
            </section>

            <section className="dashboard-section">
              <div className="dashboard-section-heading">
                <div>
                  <h3>Conflicts</h3>
                  <p>Merge, rebase, cherry-pick, and conflicted-file signals.</p>
                </div>
                <span className="dash-count tone-danger">{conflictedRepositories.length}</span>
              </div>
              {conflictedRepositories.length === 0 ? (
                <div className="quiet-box">No conflicts detected.</div>
              ) : (
                <div className="dashboard-repo-list">
                  {conflictedRepositories.map((repo) => (
                    <article className="dashboard-compact-row" key={repo.path}>
                      <div>
                        <strong>{repo.name}</strong>
                        <span>{repo.mergeOperation} · {repo.conflicted} conflicted files</span>
                      </div>
                      <button type="button" className="secondary" disabled={busy} onClick={async () => {
                        if (await openRepository(repo.path)) {
                          setViewMode('merge')
                        }
                      }}>
                        <GitMerge size={16} />
                        Merge
                      </button>
                    </article>
                  ))}
                </div>
              )}
            </section>

            <section className="dashboard-section">
              <div className="dashboard-section-heading">
                <div>
                  <h3>Stale branches</h3>
                  <p>Local branches older than {dashboard.staleBranchThresholdDays} days.</p>
                </div>
                <span className="dash-count tone-muted">{staleBranches.length}</span>
              </div>
              {staleBranches.length === 0 ? (
                <div className="quiet-box">No stale local branches detected.</div>
              ) : (
                <div className="dashboard-repo-list">
                  {staleBranches.slice(0, 10).map((branch) => (
                    <article className="dashboard-compact-row" key={`${branch.repoPath}-${branch.name}`}>
                      <div>
                        <strong>{branch.name}</strong>
                        <span>{branch.repoName} · {branch.daysSinceCommit} days · {formatDate(branch.lastCommitAt)}</span>
                      </div>
                      <button type="button" className="secondary" onClick={() => openRepository(branch.repoPath)} disabled={busy}>
                        <FolderOpen size={16} />
                        Open
                      </button>
                    </article>
                  ))}
                  {staleBranches.length > 10 && (
                    <div className="quiet-box">Showing 10 of {staleBranches.length} stale branches.</div>
                  )}
                </div>
              )}
            </section>
          </div>
          </details>
        </>
      )}
    </section>
  )
}
