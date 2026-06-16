import type { ReactNode } from 'react'
import { Bot, Loader2, ShieldCheck } from 'lucide-react'
import type {
  AssistantId, AssistantPolicyStatus, AssistantStatus,
  ReviewMode, ReviewReport, ReviewScope, ReviewSeverity, RepositorySnapshot
} from '../../shared/branchPilot'
import { groupFindingsBySeverity, reviewModeLabel, reviewScopeLabel } from '../../lib/reviewLabels'
import { assistantPolicyBlockedLabel, assistantStatusLabel } from '../../lib/assistantLabels'
import { formatDate } from '../../lib/format'

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

  return (
    <section className="single-panel">
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

      <div className="review-workspace">
        {renderAssistantPolicyPanel()}

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

          <div className="control-group">
            <label htmlFor="review-assistant">Assistant</label>
            <select
              id="review-assistant"
              value={selectedAssistant}
              onChange={(event) => setSelectedAssistant(event.target.value as AssistantId)}
            >
              <option value="auto">Auto</option>
              <option value="claude">Claude Code</option>
              <option value="codex">Codex</option>
            </select>
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
      </div>

      <div className="assistant-health-heading">
        <div>
          <h3>Assistant health</h3>
          <p>PATH detection is fast. Health check verifies that the CLI can actually generate JSON for BranchPilot.</p>
        </div>
        <button type="button" onClick={checkAssistants} disabled={assistantsChecking}>
          {assistantsChecking ? <Loader2 className="spin" size={17} /> : <Bot size={17} />}
          {assistantsChecking ? 'Checking' : 'Check assistants'}
        </button>
      </div>

      <div className="assistant-grid">
        {assistants.map((assistant) => (
          <div className={`provider-card assistant-card state-${assistant.state}`} key={assistant.id}>
            <Bot size={20} />
            <strong>{assistant.label}</strong>
            <span>{assistantStatusLabel(assistant)}</span>
            <code>{assistant.executable ?? assistant.id}</code>
            <p>{assistant.message}</p>
            {assistant.checkedAt && <span>Checked {formatDate(assistant.checkedAt)}</span>}
          </div>
        ))}
      </div>
    </section>
  )
}
