import { useEffect, useState, type ReactNode } from 'react'
import { Copy, Loader2, ShieldCheck, Wand2, X } from 'lucide-react'
import { SegmentedControl } from '../SegmentedControl'
import { SeverityCountStrip } from '../SeverityCountStrip'
import { FindingCard } from '../FindingCard'
import { Meter } from '../Meter'
import { AssistantModelSelect } from '../AssistantModelSelect'
import type {
  AssistantId, AssistantPolicyStatus, AssistantStatus,
  ReviewMode, ReviewReport, ReviewScope, ReviewSeverity, RepositorySnapshot
} from '../../shared/branchPilot'
import { groupFindingsBySeverity, reviewModeDescription, reviewModeLabel, reviewModes, reviewScopeLabel } from '../../lib/reviewLabels'
import { selectedAssistantDescription } from '../../lib/assistantSelection'
import {
  assistantLabel,
  assistantPolicyBlockedLabel
} from '../../lib/assistantLabels'

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
  selectedFilePath,
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
  selectedFilePath: string | null
  renderAssistantPolicyPanel: () => ReactNode
}) {
  const findings = reviewReport?.findings ?? []
  const findingsBySeverity = groupFindingsBySeverity(findings)
  const [reviewRunning, setReviewRunning] = useState(false)
  const [fixPromptOpen, setFixPromptOpen] = useState(false)
  const [fixPromptCopied, setFixPromptCopied] = useState(false)
  const readyAssistant = assistants.find((assistant) => assistant.state === 'ready')
  const selectedAssistantCopy = selectedAssistantDescription(selectedAssistant, readyAssistant, assistants)
  const selectedScopeCopy = selectedFilePath
    ? `Only ${selectedFilePath} will be sent as explicit context to the selected local assistant.`
    : 'Select a changed file before running a selected-file review.'
  const runReviewDisabled = !snapshot || busy || reviewRunning || !canRunAssistantReview
  const reviewFixPrompt = reviewReport ? buildReviewFixPrompt(reviewReport, snapshot) : ''
  const runReview = async () => {
    if (runReviewDisabled) return
    setReviewRunning(true)
    try {
      await runReviewReport()
    } finally {
      setReviewRunning(false)
    }
  }
  const openFixPrompt = () => {
    setFixPromptCopied(false)
    setFixPromptOpen(true)
  }
  const copyFixPrompt = async () => {
    if (!reviewFixPrompt) return
    try {
      await navigator.clipboard.writeText(reviewFixPrompt)
      setFixPromptCopied(true)
    } catch {
      setFixPromptCopied(false)
    }
  }

  useEffect(() => {
    if (!fixPromptOpen) {
      return undefined
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setFixPromptOpen(false)
      }
    }

    document.addEventListener('keydown', handleKeyDown)

    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [fixPromptOpen])

  return (
    <section className="single-panel review-panel">
      <div className="panel-heading">
        <div>
          <h2>Review modes</h2>
          <p>Run local assistant reviews on staged, unstaged, or branch changes.</p>
        </div>
        <button type="button" onClick={runReview} disabled={runReviewDisabled} aria-busy={reviewRunning}>
          {reviewRunning ? <Loader2 className="spin" size={17} /> : <ShieldCheck size={17} />}
          {reviewRunning ? 'Running review...' : 'Run review'}
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
              <SegmentedControl
                className="review-mode-segmented"
                value={reviewMode}
                onChange={(value) => setReviewMode(value as ReviewMode)}
                options={reviewModes.map((mode) => ({
                  value: mode,
                  label: reviewModeLabel(mode),
                  title: reviewModeDescription(mode)
                }))}
              />
            </div>

            <div className="control-group">
              <span>Scope</span>
              <SegmentedControl
                value={reviewScope}
                onChange={(value) => setReviewScope(value as ReviewScope)}
                options={(['selected', 'staged', 'unstaged', 'branch'] as ReviewScope[]).map((scope) => ({
                  value: scope,
                  label: reviewScopeLabel(scope),
                  disabled: scope === 'selected' && !selectedFilePath,
                  title: scope === 'selected' ? selectedScopeCopy : undefined
                }))}
              />
            </div>

            <div className="control-group control-group-assistant">
              <AssistantModelSelect
                id="review-assistant"
                label="Assistant"
                selectedAssistant={selectedAssistant}
                setSelectedAssistant={setSelectedAssistant}
                assistants={assistants}
                assistantsChecking={assistantsChecking}
                checkAssistants={checkAssistants}
              />
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
          ) : reviewRunning ? (
            <div className="review-empty review-running" role="status" aria-live="polite">
              <Loader2 className="spin" size={28} />
              <strong>Running {reviewModeLabel(reviewMode)} review</strong>
              <span>
                {reviewScopeLabel(reviewScope)} context is being sent to {selectedAssistantCopy.title}
                {selectedAssistantCopy.meta ? ` (${selectedAssistantCopy.meta})` : ''}.
              </span>
              <Meter indeterminate value={0} />
            </div>
          ) : !reviewReport ? (
            <div className="review-empty">
              <ShieldCheck size={24} />
              <strong>{reviewModeLabel(reviewMode)} review</strong>
              <span>{reviewModeDescription(reviewMode)}</span>
              <span>{reviewScope === 'selected' ? selectedScopeCopy : `${reviewScopeLabel(reviewScope)} changes will be sent as explicit context to the selected local assistant.`}</span>
            </div>
          ) : (
            <section className="review-results">
              <div className="review-summary">
                <div>
                  <span>{reviewModeLabel(reviewReport.mode)} / {reviewScopeLabel(reviewReport.scope)}</span>
                  <strong>{reviewReport.summary}</strong>
                </div>
                <div className="review-summary-actions">
                  <span>{reviewReport.findings.length} findings{reviewReport.truncated ? ' / truncated' : ''}</span>
                  <button className="secondary review-fix-prompt-open" type="button" onClick={openFixPrompt}>
                    <Wand2 size={15} />
                    Open fix prompt
                  </button>
                </div>
              </div>

              <SeverityCountStrip
                counts={(['critical', 'high', 'medium', 'low', 'info'] as ReviewSeverity[]).map((severity) => ({
                  severity,
                  count: findingsBySeverity[severity].length
                }))}
              />

              {findings.length === 0 ? (
                <div className="quiet-box">No actionable findings for this review.</div>
              ) : (
                <div className="finding-list">
                  {findings.map((finding, index) => (
                    <FindingCard
                      key={`${finding.severity}-${finding.title}-${index}`}
                      severity={finding.severity}
                      title={finding.title}
                      location={
                        finding.filePath || finding.line
                          ? `${finding.filePath ?? 'Unknown file'}${finding.line ? `:${finding.line}` : ''}`
                          : undefined
                      }
                      details={finding.details}
                      recommendation={finding.recommendation}
                    />
                  ))}
                </div>
              )}
            </section>
          )}
        </main>
      </div>

      {fixPromptOpen && reviewReport && (
        <div className="review-fix-prompt-backdrop" role="presentation" onMouseDown={() => setFixPromptOpen(false)}>
          <section
            aria-labelledby="review-fix-prompt-title"
            aria-modal="true"
            className="review-fix-prompt-modal"
            role="dialog"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header className="review-fix-prompt-head">
              <div>
                <h3 id="review-fix-prompt-title">Fix prompt</h3>
                <p>Instruction for an AI assistant based on this review report.</p>
              </div>
              <button type="button" aria-label="Close fix prompt" onClick={() => setFixPromptOpen(false)}>
                <X size={18} />
              </button>
            </header>
            <textarea readOnly value={reviewFixPrompt} aria-label="Generated fix prompt" />
            <footer className="review-fix-prompt-actions">
              <button type="button" className="secondary" onClick={() => setFixPromptOpen(false)}>
                Close
              </button>
              <button type="button" onClick={() => void copyFixPrompt()}>
                <Copy size={16} />
                {fixPromptCopied ? 'Copied' : 'Copy prompt'}
              </button>
            </footer>
          </section>
        </div>
      )}
    </section>
  )
}

function buildReviewFixPrompt(report: ReviewReport, snapshot: RepositorySnapshot | null): string {
  const summary = snapshot?.summary
  const repoName = summary?.name ?? 'current repository'
  const repoPath = summary?.rootPath ?? 'unknown local path'
  const branch = summary?.currentBranch ?? 'current branch'
  const upstream = summary?.upstream ?? 'no upstream'
  const assistant = assistantLabel(report.assistant)

  const findingText = report.findings.length
    ? report.findings.map((finding, index) => formatFindingForPrompt(finding, index + 1)).join('\n\n')
    : 'No actionable findings were reported.'

  return [
    'You are fixing review findings in a local Git repository.',
    '',
    'Working rules:',
    '- Keep the change focused on the findings below.',
    '- Preserve existing architecture, naming, UI style, and tests unless a finding requires changing them.',
    '- Do not rewrite unrelated code or churn formatting.',
    '- Add or update targeted tests when the finding is about behavior, regressions, security, or parsing.',
    '- If a finding is not valid, explain why before skipping it.',
    '- After implementing, run the narrowest relevant checks and summarize what changed.',
    '',
    'Repository context:',
    `- Repository: ${repoName}`,
    `- Local path: ${repoPath}`,
    `- Branch: ${branch}`,
    `- Upstream: ${upstream}`,
    `- Review mode: ${reviewModeLabel(report.mode)}`,
    `- Review scope: ${reviewScopeLabel(report.scope)}`,
    `- Reviewing assistant: ${assistant}`,
    `- Truncated report: ${report.truncated ? 'yes' : 'no'}`,
    '',
    'Review summary:',
    report.summary,
    '',
    'Findings to address, in priority order:',
    findingText,
    '',
    'Expected response after the fix:',
    '- Concise change summary.',
    '- Tests or checks run.',
    '- Any remaining risk or follow-up that could not be completed.'
  ].join('\n')
}

function formatFindingForPrompt(finding: ReviewReport['findings'][number], index: number): string {
  const location = finding.filePath
    ? `${finding.filePath}${finding.line ? `:${finding.line}` : ''}`
    : 'No specific file'

  return [
    `${index}. [${finding.severity.toUpperCase()}] ${finding.title}`,
    `   Location: ${location}`,
    `   Details: ${finding.details}`,
    `   Recommendation: ${finding.recommendation || 'Use engineering judgment to address the risk with the smallest safe change.'}`
  ].join('\n')
}
