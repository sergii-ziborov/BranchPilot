import { CalendarDays, Check, Copy, ExternalLink, Layers3, Loader2, Search, Trophy } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { ContributorStat, ContributorStatsWindow, DailyReviewReport, GitHubAccountSummary, RecentRepository, RepositorySnapshot } from '../../shared/branchPilot'
import { formatDate } from '../../lib/format'
import { PanelHeading } from '../PanelHeading'

const RANK_MEDAL = ['🥇', '🥈', '🥉']

const CONTRIBUTOR_WINDOWS: { id: ContributorStatsWindow; label: string }[] = [
  { id: 'all', label: 'All time' },
  { id: 'year', label: 'Year' },
  { id: 'month', label: 'Month' },
  { id: 'week', label: 'Week' },
  { id: 'day', label: 'Day' }
]

function contributorInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('') || '?'
}

function contributorNameKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ')
}

function shortRepoPath(path: string): string {
  const parts = path.split(/[\\/]+/).filter(Boolean)
  return parts.slice(-3).join(' / ') || path
}

function effectiveReportRepoPaths({
  selectedReportRepoPaths,
  allReposMode,
  recentRepositories,
  currentRepoPath
}: {
  selectedReportRepoPaths: string[]
  allReposMode: boolean
  recentRepositories: RecentRepository[]
  currentRepoPath: string | undefined
}): string[] {
  if (selectedReportRepoPaths.length > 0) return selectedReportRepoPaths
  if (allReposMode) return recentRepositories.map((repo) => repo.path)
  return currentRepoPath ? [currentRepoPath] : []
}

export function ReportScopeMenu({
  snapshot,
  recentRepositories,
  selectedReportRepoPaths,
  updateReportRepoPaths,
  allReposMode,
  currentRepoPath
}: {
  snapshot: RepositorySnapshot | null
  recentRepositories: RecentRepository[]
  selectedReportRepoPaths: string[]
  updateReportRepoPaths: (paths: string[]) => void
  allReposMode: boolean
  currentRepoPath: string | undefined
}) {
  const [repoScopeSearch, setRepoScopeSearch] = useState('')
  const recentRepoPaths = useMemo(() => recentRepositories.map((repo) => repo.path), [recentRepositories])
  const explicitScope = selectedReportRepoPaths.length > 0
  const scopePaths = effectiveReportRepoPaths({ selectedReportRepoPaths, allReposMode, recentRepositories, currentRepoPath })
  const scopeSet = new Set(scopePaths.map((repoPath) => repoPath.toLowerCase()))
  const filteredScopeRepos = useMemo(() => {
    const query = repoScopeSearch.trim().toLowerCase()
    if (!query) return recentRepositories
    return recentRepositories.filter((repo) =>
      [repo.name, repo.path].some((value) => value.toLowerCase().includes(query))
    )
  }, [recentRepositories, repoScopeSearch])
  const scopeLabel = explicitScope
    ? `${selectedReportRepoPaths.length} repos`
    : allReposMode
      ? `${recentRepositories.length || 'All'} recent`
      : snapshot?.summary.name ?? 'Current repo'

  function toggleScopeRepo(repoPath: string) {
    const key = repoPath.toLowerCase()
    const next = scopeSet.has(key)
      ? scopePaths.filter((path) => path.toLowerCase() !== key)
      : [...scopePaths, repoPath]
    updateReportRepoPaths(next)
  }

  return (
    <details className="report-scope-menu">
      <summary title="Choose repositories for heatmap, daily review, and contributor ranking">
        <Layers3 size={16} />
        {scopeLabel}
      </summary>
      <div className="report-scope-popover">
        <div className="report-scope-head">
          <strong>Report scope</strong>
          <span>{scopePaths.length} repositories used</span>
        </div>
        <div className="report-scope-actions">
          <button type="button" onClick={() => currentRepoPath && updateReportRepoPaths([currentRepoPath])} disabled={!currentRepoPath}>
            Current
          </button>
          <button type="button" onClick={() => updateReportRepoPaths(recentRepoPaths)} disabled={recentRepositories.length === 0}>
            All recent
          </button>
          <button type="button" onClick={() => updateReportRepoPaths([])} disabled={!explicitScope}>
            Default
          </button>
        </div>
        <label className="report-scope-search">
          <Search size={15} />
          <input
            type="search"
            value={repoScopeSearch}
            onChange={(event) => setRepoScopeSearch(event.target.value)}
            placeholder="Search repositories"
          />
        </label>
        <div className="report-scope-list">
          {filteredScopeRepos.length > 0 ? filteredScopeRepos.map((repo) => {
            const selected = scopeSet.has(repo.path.toLowerCase())
            return (
              <button
                type="button"
                key={repo.path}
                className={`report-scope-repo${selected ? ' selected' : ''}`}
                onClick={() => toggleScopeRepo(repo.path)}
              >
                <span className="report-scope-check" aria-hidden="true">
                  {selected && <Check size={13} />}
                </span>
                <span>
                  <strong>{repo.name}</strong>
                  <small>{shortRepoPath(repo.path)}</small>
                </span>
              </button>
            )
          }) : (
            <div className="report-scope-empty">No recent repositories match this search.</div>
          )}
        </div>
      </div>
    </details>
  )
}

export function DailyView({
  dailyReviewDate,
  setDailyReviewDate,
  runDailyReview,
  dailyReviewLoading,
  dailyReview,
  contributorStats,
  githubAccounts,
  contributorWindow,
  setContributorWindow,
  copyDailyReviewMarkdown,
  recentRepositories,
  selectedReportRepoPaths,
  allReposMode,
  currentRepoPath,
  openExternalLink
}: {
  dailyReviewDate: string
  setDailyReviewDate: (value: string) => void
  runDailyReview: () => void | Promise<void>
  dailyReviewLoading: boolean
  dailyReview: DailyReviewReport | null
  contributorStats: ContributorStat[]
  githubAccounts: GitHubAccountSummary[]
  contributorWindow: ContributorStatsWindow
  setContributorWindow: (value: ContributorStatsWindow) => void
  copyDailyReviewMarkdown: () => void | Promise<void>
  recentRepositories: RecentRepository[]
  selectedReportRepoPaths: string[]
  allReposMode: boolean
  currentRepoPath: string | undefined
  openExternalLink: (url: string | undefined, label?: string) => void
}) {
  const topCommits = contributorStats[0]?.commits ?? 0
  const effectiveScopePaths = effectiveReportRepoPaths({ selectedReportRepoPaths, allReposMode, recentRepositories, currentRepoPath })

  return (
    <section className="single-panel daily-panel">
      <PanelHeading
        title={allReposMode ? 'Reports' : 'Daily Review'}
        description={allReposMode ? 'Commit activity across all repositories.' : 'Repository work summary for the selected day.'}
        compact
      >
        <div className="daily-controls">
          <input
            aria-label="Daily review date"
            type="date"
            value={dailyReviewDate}
            onChange={(event) => setDailyReviewDate(event.target.value)}
          />
          <button type="button" onClick={runDailyReview} disabled={effectiveScopePaths.length === 0 || dailyReviewLoading}>
            {dailyReviewLoading ? <Loader2 className="spin" size={17} /> : <CalendarDays size={17} />}
            Run daily review
          </button>
        </div>
      </PanelHeading>

      {contributorStats.length > 0 && (
        <section className="contributor-board">
          <div className="contributor-board-heading">
            <Trophy size={16} />
            <strong>Contributor ranking</strong>
            <div className="contributor-filter" role="group" aria-label="Contributor ranking period">
              {CONTRIBUTOR_WINDOWS.map((window) => (
                <button
                  type="button"
                  key={window.id}
                  className={contributorWindow === window.id ? 'active' : ''}
                  onClick={() => setContributorWindow(window.id)}
                >
                  {window.label}
                </button>
              ))}
            </div>
            <span>{contributorStats.length} committers</span>
          </div>
          <div className="contributor-list">
            {contributorStats.map((contributor, index) => {
              const emails = contributor.emails?.length ? contributor.emails : [contributor.email]
              const profile = resolveContributorProfile(contributor, githubAccounts)
              const avatarUrl = profile.avatarUrl ?? contributor.avatarUrl
              const aliasNames = [...new Set((contributor.aliases ?? [])
                .map((alias) => alias.name)
                .filter((name) => contributorNameKey(name) !== contributorNameKey(contributor.name)))]
              const identityDetails = [
                aliasNames.length > 0 ? `Also committed as ${aliasNames.slice(0, 2).join(', ')}${aliasNames.length > 2 ? '...' : ''}` : undefined,
                emails.length > 1 ? `${emails.length} commit emails` : undefined
              ].filter(Boolean)

              return (
                <article className={`contributor-row${index < 3 ? ' top' : ''}`} key={`${contributor.name}-${emails.join('|')}`} title={`${contributor.name} <${emails.join(', ')}>`}>
                  <span className="contributor-rank">{RANK_MEDAL[index] ?? index + 1}</span>
                  <span className="contributor-avatar" aria-hidden="true">
                    {avatarUrl
                      ? (
                          <img
                            src={avatarUrl}
                            alt=""
                            onError={(event) => {
                              event.currentTarget.style.display = 'none'
                            }}
                          />
                        )
                      : null}
                    <span>{contributorInitials(contributor.name)}</span>
                  </span>
                  <div className="contributor-id">
                    <div className="contributor-title-row">
                      <strong>{contributor.name}</strong>
                      {profile.profileUrl && (
                        <button
                          type="button"
                          className="contributor-profile-link"
                          title={`Open @${profile.login ?? contributor.name} on GitHub`}
                          onClick={() => openExternalLink(profile.profileUrl, 'GitHub profile')}
                        >
                          <span>@{profile.login ?? 'GitHub'}</span>
                          <ExternalLink size={13} />
                        </button>
                      )}
                    </div>
                    <span className="contributor-email-list" title={emails.join(', ')}>
                      {emails.slice(0, 3).map((email) => (
                        <code key={email}>{email}</code>
                      ))}
                      {emails.length > 3 && <code>+{emails.length - 3}</code>}
                    </span>
                    {identityDetails.length > 0 && <span className="contributor-identity">{identityDetails.join(' | ')}</span>}
                    <span>Last commit {formatDate(contributor.lastCommitAt)}</span>
                  </div>
                  <div className="contributor-meter">
                    <div className="contributor-bar" style={{ width: `${topCommits > 0 ? Math.max(6, Math.round((contributor.commits / topCommits) * 100)) : 0}%` }} />
                  </div>
                  <div className="contributor-metrics">
                    <strong>{contributor.commits}</strong>
                    <span>{Math.round(contributor.share * 100)}%</span>
                  </div>
                </article>
              )
            })}
          </div>
        </section>
      )}

      {!dailyReview ? (
        <div className="review-empty">
          <CalendarDays size={24} />
          <strong>{dailyReviewLoading ? 'Generating daily review' : 'No daily review yet'}</strong>
          <span>{effectiveScopePaths.length > 0 ? 'Run a review to summarize commits, current worktree state, sync state, and BranchPilot activity.' : 'Open or select repositories before generating a daily review.'}</span>
        </div>
      ) : (
        <>
          <div className="daily-workspace">
            <section className="daily-section-list">
              {dailyReview.sections.map((section) => (
                <article className="daily-section" key={section.id}>
                  <div className="daily-section-heading">
                    <strong>{section.title}</strong>
                    <span>{section.items.length}</span>
                  </div>
                  <ul>
                    {section.items.map((item, index) => (
                      <li key={`${section.id}-${index}`}>{item}</li>
                    ))}
                  </ul>
                </article>
              ))}
            </section>

            <aside className="daily-export">
              <section className="daily-section">
                <div className="daily-section-heading">
                  <strong>Action items</strong>
                  <span>{dailyReview.actionItems.length}</span>
                </div>
                {dailyReview.actionItems.length === 0 ? (
                  <div className="quiet-box">No immediate local actions detected.</div>
                ) : (
                  <div className="daily-action-list">
                    {dailyReview.actionItems.map((item, index) => (
                      <article className={`daily-action priority-${item.priority}`} key={`${item.priority}-${item.title}-${index}`}>
                        <span>{item.priority}</span>
                        <strong>{item.title}</strong>
                        <p>{item.details}</p>
                      </article>
                    ))}
                  </div>
                )}
              </section>

              <section className="daily-section">
                <div className="daily-section-heading">
                  <strong>Markdown</strong>
                  <button type="button" onClick={copyDailyReviewMarkdown}>
                    <Copy size={15} />
                    Copy
                  </button>
                </div>
                <pre className="daily-markdown-preview"><code>{dailyReview.markdown}</code></pre>
              </section>
            </aside>
          </div>
        </>
      )}
    </section>
  )
}

interface ContributorProfileView {
  login?: string
  profileUrl?: string
  avatarUrl?: string
}

function resolveContributorProfile(contributor: ContributorStat, accounts: GitHubAccountSummary[]): ContributorProfileView {
  if (contributor.profileUrl) {
    return {
      login: contributor.login,
      profileUrl: contributor.profileUrl,
      avatarUrl: contributor.avatarUrl
    }
  }

  const emails = new Set((contributor.emails?.length ? contributor.emails : [contributor.email])
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean))
  const account = accounts.find((candidate) =>
    candidate.type === 'user' && (candidate.emails ?? []).some((email) => emails.has(email.trim().toLowerCase()))
  )

  if (!account) {
    return {
      avatarUrl: contributor.avatarUrl
    }
  }

  return {
    login: account.login,
    profileUrl: account.url,
    avatarUrl: `https://github.com/${encodeURIComponent(account.login)}.png?size=96`
  }
}
