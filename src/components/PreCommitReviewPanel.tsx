import { ExternalLink, Loader2, ShieldCheck } from 'lucide-react'
import type {
  AssistantPolicyStatus, RepositoryCounts, ReviewFinding, ReviewMode, ReviewReport, ReviewSeverity
} from '../shared/branchPilot'
import { defaultPreCommitReviewModes, reviewModeLabel, reviewSeverities } from '../lib/reviewLabels'
import { assistantPolicyBlockedLabel } from '../lib/assistantLabels'
import { FindingCard } from './FindingCard'

type PreCommitFinding = ReviewFinding & { mode: ReviewMode }

/** Optional staged-diff review shown inside the commit composer. */
export function PreCommitReviewPanel({
  preCommitReviewModes,
  preCommitFindings,
  preCommitFindingsBySeverity,
  preCommitRunningMode,
  preCommitReports,
  togglePreCommitReviewMode,
  runPreCommitReview,
  openPreCommitReviewDetails,
  canRunAssistantReview,
  busy,
  counts,
  assistantPolicy
}: {
  preCommitReviewModes: ReviewMode[]
  preCommitFindings: PreCommitFinding[]
  preCommitFindingsBySeverity: Record<ReviewSeverity, ReviewFinding[]>
  preCommitRunningMode: ReviewMode | null
  preCommitReports: ReviewReport[]
  togglePreCommitReviewMode: (mode: ReviewMode) => void
  runPreCommitReview: () => void | Promise<void>
  openPreCommitReviewDetails: () => void
  canRunAssistantReview: boolean
  busy: boolean
  counts: RepositoryCounts | undefined
  assistantPolicy: AssistantPolicyStatus | null
}) {
  const selectedModeLabels = preCommitReviewModes.map(reviewModeLabel).join(', ')
  const displayedFindings = preCommitFindings.slice(0, 5)
  const hiddenFindingCount = Math.max(0, preCommitFindings.length - displayedFindings.length)
  const hasHighRiskFindings = preCommitFindingsBySeverity.critical.length > 0 || preCommitFindingsBySeverity.high.length > 0
  const isRunning = Boolean(preCommitRunningMode)

  return (
    <section className={`precommit-review ${hasHighRiskFindings ? 'has-risk' : ''}`}>
      <div className="precommit-heading">
        <div>
          <h3>Pre-commit review</h3>
          <p>Optional staged diff review before committing.</p>
        </div>
        <span>Staged only</span>
      </div>

      <div className="precommit-controls">
        <div className="segmented precommit-modes" aria-label="Pre-commit review modes">
          {defaultPreCommitReviewModes.map((mode) => (
            <button
              aria-pressed={preCommitReviewModes.includes(mode)}
              className={preCommitReviewModes.includes(mode) ? 'active' : ''}
              type="button"
              key={mode}
              onClick={() => togglePreCommitReviewMode(mode)}
              disabled={busy}
            >
              {reviewModeLabel(mode)}
            </button>
          ))}
        </div>
        <button type="button" onClick={runPreCommitReview} disabled={busy || !counts?.staged || preCommitReviewModes.length === 0 || !canRunAssistantReview}>
          {isRunning ? <Loader2 className="spin" size={17} /> : <ShieldCheck size={17} />}
          {isRunning ? `Reviewing ${reviewModeLabel(preCommitRunningMode!)}` : 'Review staged diff'}
        </button>
      </div>

      {!counts?.staged ? (
        <div className="precommit-empty">Stage files to review the exact diff that will be committed.</div>
      ) : !canRunAssistantReview ? (
        <div className="precommit-empty">{assistantPolicyBlockedLabel('review_report', assistantPolicy)}</div>
      ) : preCommitReviewModes.length === 0 ? (
        <div className="precommit-empty">Select at least one review mode.</div>
      ) : isRunning && preCommitReports.length === 0 ? (
        <div className="precommit-empty">Running {reviewModeLabel(preCommitRunningMode!)} review for {selectedModeLabels}.</div>
      ) : preCommitReports.length === 0 ? (
        <div className="precommit-empty">Review staged diff before committing. Commit stays available either way.</div>
      ) : (
        <div className="precommit-results">
          <div className="precommit-summary">
            <strong>{preCommitFindings.length === 0 ? 'No actionable findings in staged diff.' : `${preCommitFindings.length} findings in staged diff.`}</strong>
            <span>{preCommitReports.length} mode{preCommitReports.length === 1 ? '' : 's'} reviewed{preCommitReports.some((report) => report.truncated) ? ' / truncated' : ''}</span>
          </div>

          <div className="severity-strip precommit-severity">
            {reviewSeverities.map((severity) => (
              <div className={`severity-count severity-${severity}`} key={severity}>
                <span>{severity}</span>
                <strong>{preCommitFindingsBySeverity[severity].length}</strong>
              </div>
            ))}
          </div>

          {hasHighRiskFindings && (
            <div className="precommit-warning">High-risk findings found. Commit is still available.</div>
          )}

          {displayedFindings.length > 0 && (
            <div className="precommit-finding-list">
              {displayedFindings.map((finding, index) => (
                <FindingCard
                  compact
                  severity={finding.severity}
                  title={finding.title}
                  location={`${reviewModeLabel(finding.mode)}${finding.filePath ? ` / ${finding.filePath}${finding.line ? `:${finding.line}` : ''}` : ''}`}
                  details={finding.details}
                  key={`${finding.mode}-${finding.severity}-${finding.title}-${index}`}
                />
              ))}
              {hiddenFindingCount > 0 && <div className="precommit-empty">{hiddenFindingCount} more findings in the full review.</div>}
            </div>
          )}

          <button type="button" className="secondary precommit-details" onClick={openPreCommitReviewDetails}>
            <ExternalLink size={17} />
            Open full review
          </button>
        </div>
      )}
    </section>
  )
}
