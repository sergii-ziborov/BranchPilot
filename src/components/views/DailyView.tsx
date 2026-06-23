import { CalendarDays, Copy, ExternalLink, Loader2, Trophy } from 'lucide-react'
import type { ContributorStat, ContributorStatsWindow, DailyReviewReport, RepositorySnapshot } from '../../shared/branchPilot'
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

export function DailyView({
  dailyReviewDate,
  setDailyReviewDate,
  runDailyReview,
  snapshot,
  dailyReviewLoading,
  dailyReview,
  contributorStats,
  contributorWindow,
  setContributorWindow,
  copyDailyReviewMarkdown,
  allReposMode,
  openExternalLink
}: {
  dailyReviewDate: string
  setDailyReviewDate: (value: string) => void
  runDailyReview: () => void | Promise<void>
  snapshot: RepositorySnapshot | null
  dailyReviewLoading: boolean
  dailyReview: DailyReviewReport | null
  contributorStats: ContributorStat[]
  contributorWindow: ContributorStatsWindow
  setContributorWindow: (value: ContributorStatsWindow) => void
  copyDailyReviewMarkdown: () => void | Promise<void>
  allReposMode: boolean
  openExternalLink: (url: string | undefined, label?: string) => void
}) {
  const topCommits = contributorStats[0]?.commits ?? 0
  return (
    <section className="single-panel daily-panel">
      <PanelHeading
        title={allReposMode ? 'Reports' : 'Daily Review'}
        description={allReposMode ? 'Commit activity across all repositories.' : 'Repository work summary for the selected day.'}
      >
        {!allReposMode && (
          <div className="daily-controls">
            <input
              aria-label="Daily review date"
              type="date"
              value={dailyReviewDate}
              onChange={(event) => setDailyReviewDate(event.target.value)}
            />
            <button type="button" onClick={runDailyReview} disabled={!snapshot || dailyReviewLoading}>
              {dailyReviewLoading ? <Loader2 className="spin" size={17} /> : <CalendarDays size={17} />}
              Run daily review
            </button>
          </div>
        )}
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
              const aliasNames = [...new Set((contributor.aliases ?? [])
                .map((alias) => alias.name)
                .filter((name) => contributorNameKey(name) !== contributorNameKey(contributor.name)))]
              const identityDetails = [
                aliasNames.length > 0 ? `Also committed as ${aliasNames.slice(0, 2).join(', ')}${aliasNames.length > 2 ? '...' : ''}` : undefined,
                emails.length > 1 ? `${emails.length} commit emails` : undefined
              ].filter(Boolean)
              const displayedEmails = `${emails.slice(0, 2).join(' - ')}${emails.length > 2 ? ` - +${emails.length - 2}` : ''}`

              return (
                <article className={`contributor-row${index < 3 ? ' top' : ''}`} key={`${contributor.name}-${emails.join('|')}`} title={`${contributor.name} <${emails.join(', ')}>`}>
                  <span className="contributor-rank">{RANK_MEDAL[index] ?? index + 1}</span>
                  <span className="contributor-avatar" aria-hidden="true">
                    {contributor.avatarUrl
                      ? (
                          <img
                            src={contributor.avatarUrl}
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
                      {contributor.profileUrl && (
                        <button
                          type="button"
                          className="contributor-profile-link"
                          title={`Open @${contributor.login ?? contributor.name} on GitHub`}
                          onClick={() => openExternalLink(contributor.profileUrl, 'GitHub profile')}
                        >
                          <ExternalLink size={13} />
                          Profile
                        </button>
                      )}
                    </div>
                    <span className="contributor-email">
                      {contributor.login ? `@${contributor.login} - ${displayedEmails}` : displayedEmails}
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

      {allReposMode ? (
        contributorStats.length === 0 && (
          <div className="review-empty">
            <CalendarDays size={24} />
            <strong>No commit activity yet</strong>
            <span>Open or clone repositories to populate the portfolio report.</span>
          </div>
        )
      ) : !dailyReview ? (
        <div className="review-empty">
          <CalendarDays size={24} />
          <strong>{dailyReviewLoading ? 'Generating daily review' : 'No daily review yet'}</strong>
          <span>{snapshot ? 'Run a review to summarize commits, current worktree state, sync state, and BranchPilot activity.' : 'Open a repository before generating a daily review.'}</span>
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
