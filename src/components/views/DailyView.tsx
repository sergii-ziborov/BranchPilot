import { CalendarDays, Copy, Loader2 } from 'lucide-react'
import type { DailyReviewReport, RepositorySnapshot } from '../../shared/branchPilot'
import { PanelHeading } from '../PanelHeading'

export function DailyView({
  dailyReviewDate,
  setDailyReviewDate,
  runDailyReview,
  snapshot,
  dailyReviewLoading,
  dailyReview,
  copyDailyReviewMarkdown
}: {
  dailyReviewDate: string
  setDailyReviewDate: (value: string) => void
  runDailyReview: () => void | Promise<void>
  snapshot: RepositorySnapshot | null
  dailyReviewLoading: boolean
  dailyReview: DailyReviewReport | null
  copyDailyReviewMarkdown: () => void | Promise<void>
}) {
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
