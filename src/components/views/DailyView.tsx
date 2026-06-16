import { CalendarDays, Copy, Loader2, Trophy } from 'lucide-react'
import type { ContributorStat, DailyReviewReport, RepositorySnapshot } from '../../shared/branchPilot'
import { formatDate } from '../../lib/format'
import { PanelHeading } from '../PanelHeading'

const RANK_MEDAL = ['🥇', '🥈', '🥉']

function contributorInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('') || '?'
}

export function DailyView({
  dailyReviewDate,
  setDailyReviewDate,
  runDailyReview,
  snapshot,
  dailyReviewLoading,
  dailyReview,
  contributorStats,
  copyDailyReviewMarkdown
}: {
  dailyReviewDate: string
  setDailyReviewDate: (value: string) => void
  runDailyReview: () => void | Promise<void>
  snapshot: RepositorySnapshot | null
  dailyReviewLoading: boolean
  dailyReview: DailyReviewReport | null
  contributorStats: ContributorStat[]
  copyDailyReviewMarkdown: () => void | Promise<void>
}) {
  const topCommits = contributorStats[0]?.commits ?? 0
  return (
    <section className="single-panel daily-panel">
      <PanelHeading title="Daily Review" description="Repository work summary for the selected day.">
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
      </PanelHeading>

      {contributorStats.length > 0 && (
        <section className="contributor-board">
          <div className="contributor-board-heading">
            <Trophy size={16} />
            <strong>Contributor ranking</strong>
            <span>{contributorStats.length} committers</span>
          </div>
          <div className="contributor-list">
            {contributorStats.map((contributor, index) => (
              <article className={`contributor-row${index < 3 ? ' top' : ''}`} key={contributor.email}>
                <span className="contributor-rank">{RANK_MEDAL[index] ?? index + 1}</span>
                <span className="contributor-avatar" aria-hidden="true">{contributorInitials(contributor.name)}</span>
                <div className="contributor-id">
                  <strong>{contributor.name}</strong>
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
            ))}
          </div>
        </section>
      )}

      {!dailyReview ? (
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
