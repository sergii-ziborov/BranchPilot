import type { ReactNode } from 'react'
import { Loader2, RefreshCw, ShieldCheck } from 'lucide-react'
import type {
  AssistantId, AssistantPolicyStatus, AssistantStatus,
  ReviewMode, ReviewReport, ReviewScope, ReviewSeverity, RepositorySnapshot
} from '../../shared/branchPilot'
import { groupFindingsBySeverity, reviewModeLabel, reviewScopeLabel } from '../../lib/reviewLabels'
import { assistantLabel, assistantPolicyBlockedLabel, assistantStatusLabel } from '../../lib/assistantLabels'

export function ReviewView({
  reviewReport,
  snapshot,
  busy,
  canRunAssistantReview,
  runReviewReport,
  reviewMode,
  setReviewMode,
  reviewScope,
  setReviewScope,
  selectedAssistant,
  setSelectedAssistant,
  assistantPolicy,
  assistants,
  assistantsChecking,
  checkAssistants,
  renderAssistantPolicyPanel
}: {
  reviewReport: ReviewReport | null
  snapshot: RepositorySnapshot | null
  busy: boolean
  canRunAssistantReview: boolean
  runReviewReport: () => void | Promise<void>
  reviewMode: ReviewMode
  setReviewMode: (mode: ReviewMode) => void
  reviewScope: ReviewScope
  setReviewScope: (scope: ReviewScope) => void
  selectedAssistant: AssistantId
  setSelectedAssistant: (assistant: AssistantId) => void
  assistantPolicy: AssistantPolicyStatus | null
  assistants: AssistantStatus[]
  assistantsChecking: boolean
  checkAssistants: () => void | Promise<void>
  renderAssistantPolicyPanel: () => ReactNode
}) {
  const findings = reviewReport?.findings ?? []
  const findingsBySeverity = groupFindingsBySeverity(findings)
  const assistantStatuses = new Map(assistants.map((assistant) => [assistant.id, assistant]))
  const readyAssistant = assistants.find((assistant) => assistant.state === 'ready')
  const selectedAssistantStatus = selectedAssistant === 'auto'
    ? readyAssistant ?? assistants.find((assistant) => assistant.state === 'detected') ?? assistants[0]
    : assistantStatuses.get(selectedAssistant)
  const assistantSelectState = assistantVisualState(selectedAssistantStatus)

  return (
    <section className="single-panel review-panel">
      <div className="panel-heading">
        <div>
          <h2>Review modes</h2>
          <p>Run local assistant reviews on staged, unstaged, or branch changes.</p>
        </div>
        <button type="button" onClick={runReviewReport} disabled={!snapshot || busy || !canRunAssistantReview}>
          <ShieldCheck size={17} />
          Run review
        </button>
      </div>

      <div className="review-layout">
        <aside className="review-sidebar">
          {renderAssistantPolicyPanel()}
        </aside>

        <main className="review-main">
          <section className="review-controls">
            <div className="control-group">
              <span>Mode</span>
              <div className="segmented">
                {(['consistency', 'security', 'quality'] as ReviewMode[]).map((mode) => (
                  <button
                    className={reviewMode === mode ? 'active' : ''}
                    type="button"
                    key={mode}
                    onClick={() => setReviewMode(mode)}
                  >
                    {reviewModeLabel(mode)}
                  </button>
                ))}
              </div>
            </div>

            <div className="control-group">
              <span>Scope</span>
              <div className="segmented">
                {(['staged', 'unstaged', 'branch'] as ReviewScope[]).map((scope) => (
                  <button
                    className={reviewScope === scope ? 'active' : ''}
                    type="button"
                    key={scope}
                    onClick={() => setReviewScope(scope)}
                  >
                    {reviewScopeLabel(scope)}
                  </button>
                ))}
              </div>
            </div>

            <div className="control-group control-group-assistant">
              <label htmlFor="review-assistant">Assistant</label>
              <div className="assistant-select-row">
                <select
                  id="review-assistant"
                  className={`assistant-select assistant-select-${assistantSelectState}`}
                  value={selectedAssistant}
                  onChange={(event) => setSelectedAssistant(event.target.value as AssistantId)}
                >
                  <option value="auto">{autoAssistantLabel(readyAssistant, assistants)}</option>
                  {(['claude', 'codex'] as Array<Exclude<AssistantId, 'auto'>>).map((assistantId) => {
                    const status = assistantStatuses.get(assistantId)

                    return (
                      <option className={`assistant-option assistant-option-${assistantVisualState(status)}`} key={assistantId} value={assistantId}>
                        {concreteAssistantLabel(assistantId, status)}
                      </option>
                    )
                  })}
                </select>
                <button
                  className="assistant-check-button"
                  type="button"
                  title="Check assistants"
                  aria-label="Check assistants"
                  onClick={checkAssistants}
                  disabled={assistantsChecking}
                >
                  {assistantsChecking ? <Loader2 className="spin" size={16} /> : <RefreshCw size={16} />}
                </button>
              </div>
            </div>
          </section>

          {!snapshot ? (
            <div className="quiet-box">Open a repository before running a review.</div>
          ) : !canRunAssistantReview ? (
            <div className="review-empty">
              <ShieldCheck size={24} />
              <strong>Assistant reviews blocked</strong>
              <span>{assistantPolicyBlockedLabel('review_report', assistantPolicy)}</span>
            </div>
          ) : !reviewReport ? (
            <div className="review-empty">
              <ShieldCheck size={24} />
              <strong>{reviewModeLabel(reviewMode)} review</strong>
              <span>{reviewScopeLabel(reviewScope)} changes will be sent as explicit context to the selected local assistant.</span>
            </div>
          ) : (
            <section className="review-results">
              <div className="review-summary">
                <div>
                  <span>{reviewModeLabel(reviewReport.mode)} / {reviewScopeLabel(reviewReport.scope)}</span>
                  <strong>{reviewReport.summary}</strong>
                </div>
                <span>{reviewReport.findings.length} findings{reviewReport.truncated ? ' / truncated' : ''}</span>
              </div>

              <div className="severity-strip">
                {(['critical', 'high', 'medium', 'low', 'info'] as ReviewSeverity[]).map((severity) => (
                  <div className={`severity-count severity-${severity}`} key={severity}>
                    <span>{severity}</span>
                    <strong>{findingsBySeverity[severity].length}</strong>
                  </div>
                ))}
              </div>

              {findings.length === 0 ? (
                <div className="quiet-box">No actionable findings for this review.</div>
              ) : (
                <div className="finding-list">
                  {findings.map((finding, index) => (
                    <article className={`finding-card severity-${finding.severity}`} key={`${finding.severity}-${finding.title}-${index}`}>
                      <div className="finding-heading">
                        <span>{finding.severity}</span>
                        <strong>{finding.title}</strong>
                      </div>
                      {(finding.filePath || finding.line) && (
                        <code>{finding.filePath ?? 'Unknown file'}{finding.line ? `:${finding.line}` : ''}</code>
                      )}
                      <p>{finding.details}</p>
                      {finding.recommendation && <p className="finding-recommendation">{finding.recommendation}</p>}
                    </article>
                  ))}
                </div>
              )}
            </section>
          )}
        </main>
      </div>
    </section>
  )
}

function autoAssistantLabel(readyAssistant: AssistantStatus | undefined, assistants: AssistantStatus[]): string {
  if (readyAssistant) {
    return `Auto - ${readyAssistant.label} ready`
  }

  if (assistants.some((assistant) => assistant.state === 'detected')) {
    return 'Auto - check access'
  }

  return 'Auto'
}

function concreteAssistantLabel(assistantId: Exclude<AssistantId, 'auto'>, status?: AssistantStatus): string {
  return status
    ? `${assistantLabel(assistantId)} - ${assistantStatusLabel(status)}`
    : `${assistantLabel(assistantId)} - not found`
}

function assistantVisualState(status?: AssistantStatus): string {
  if (!status) {
    return 'missing'
  }

  const label = assistantStatusLabel(status)

  if (label === 'limited') {
    return 'limited'
  }

  return status.state
}
