import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Check, ChevronDown, Loader2, RefreshCw, ShieldCheck } from 'lucide-react'
import type {
  AssistantId, AssistantPolicyStatus, AssistantStatus, InstalledAssistantId,
  ReviewMode, ReviewReport, ReviewScope, ReviewSeverity, RepositorySnapshot
} from '../../shared/branchPilot'
import { groupFindingsBySeverity, reviewModeLabel, reviewScopeLabel } from '../../lib/reviewLabels'
import {
  assistantBaseId,
  assistantLabel,
  assistantModelLabel,
  assistantPolicyBlockedLabel,
  assistantStatusLabel,
  CLAUDE_MODEL_OPTIONS,
  CODEX_MODEL_OPTIONS
} from '../../lib/assistantLabels'

const REVIEW_ASSISTANT_GROUPS: Array<{
  id: InstalledAssistantId
  label: string
  options: Array<{ id: AssistantId; label: string; description: string }>
}> = [
  { id: 'claude', label: 'Claude Code', options: CLAUDE_MODEL_OPTIONS },
  { id: 'codex', label: 'Codex', options: CODEX_MODEL_OPTIONS }
]

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
  const [assistantMenuOpen, setAssistantMenuOpen] = useState(false)
  const assistantMenuRef = useRef<HTMLDivElement | null>(null)
  const assistantStatuses = new Map<InstalledAssistantId, AssistantStatus>(assistants.map((assistant) => [assistant.id, assistant]))
  const readyAssistant = assistants.find((assistant) => assistant.state === 'ready')
  const selectedAssistantBaseId = assistantBaseId(selectedAssistant)
  const selectedAssistantStatus = selectedAssistantBaseId === 'auto'
    ? readyAssistant ?? assistants.find((assistant) => assistant.state === 'detected') ?? assistants[0]
    : assistantStatuses.get(selectedAssistantBaseId)
  const assistantSelectState = assistantVisualState(selectedAssistantStatus)
  const selectedAssistantCopy = selectedAssistantDescription(selectedAssistant, readyAssistant, assistants)

  useEffect(() => {
    if (!assistantMenuOpen) {
      return undefined
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (assistantMenuRef.current?.contains(event.target as Node)) {
        return
      }

      setAssistantMenuOpen(false)
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setAssistantMenuOpen(false)
      }
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [assistantMenuOpen])

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
                <div className="assistant-model-menu" ref={assistantMenuRef}>
                  <button
                    id="review-assistant"
                    aria-expanded={assistantMenuOpen}
                    aria-haspopup="listbox"
                    className={`assistant-select assistant-model-trigger assistant-select-${assistantSelectState}`}
                    type="button"
                    onClick={() => setAssistantMenuOpen((open) => !open)}
                  >
                    <span className="assistant-model-trigger-copy">
                      <strong>{selectedAssistantCopy.title}</strong>
                      <span>{selectedAssistantCopy.meta}</span>
                    </span>
                    <ChevronDown size={16} />
                  </button>
                  {assistantMenuOpen && (
                    <div className="assistant-model-popover" role="listbox" aria-label="Assistant and model">
                      <AssistantModelOption
                        title="Auto"
                        meta={autoAssistantLabel(readyAssistant, assistants)}
                        selected={selectedAssistant === 'auto'}
                        state={assistantSelectState}
                        onSelect={() => {
                          setSelectedAssistant('auto')
                          setAssistantMenuOpen(false)
                        }}
                      />
                      {REVIEW_ASSISTANT_GROUPS.map((group) => {
                        const status = assistantStatuses.get(group.id)
                        const state = assistantVisualState(status)

                        return (
                          <section className="assistant-model-group" key={group.id}>
                            <div className="assistant-model-group-heading">
                              <span>{group.label}</span>
                              <small className={`assistant-model-status state-${state}`}>
                                {status ? assistantStatusLabel(status) : 'not loaded'}
                              </small>
                            </div>
                            <div className="assistant-model-options">
                              {group.options.map((option) => (
                                <AssistantModelOption
                                  title={option.label}
                                  meta={option.description}
                                  key={option.id}
                                  selected={selectedAssistant === option.id}
                                  state={state}
                                  onSelect={() => {
                                    setSelectedAssistant(option.id)
                                    setAssistantMenuOpen(false)
                                  }}
                                />
                              ))}
                            </div>
                          </section>
                        )
                      })}
                    </div>
                  )}
                </div>
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

function AssistantModelOption({
  title,
  meta,
  selected,
  state,
  onSelect
}: {
  title: string
  meta: string
  selected: boolean
  state: string
  onSelect: () => void
}) {
  return (
    <button
      aria-selected={selected}
      className={`assistant-model-option state-${state} ${selected ? 'active' : ''}`.trim()}
      role="option"
      type="button"
      onClick={onSelect}
    >
      <span className={`assistant-model-dot state-${state}`} />
      <span className="assistant-model-copy">
        <strong>{title}</strong>
        <span>{meta}</span>
      </span>
      {selected && <Check size={15} />}
    </button>
  )
}

function autoAssistantLabel(readyAssistant: AssistantStatus | undefined, assistants: AssistantStatus[]): string {
  if (readyAssistant) {
    return `Uses ${readyAssistant.label} when ready`
  }

  if (assistants.some((assistant) => assistant.state === 'detected')) {
    return 'Check access before running'
  }

  return 'First available assistant'
}

function selectedAssistantDescription(
  assistant: AssistantId,
  readyAssistant: AssistantStatus | undefined,
  assistants: AssistantStatus[]
): { title: string; meta: string } {
  if (assistant === 'auto') {
    return {
      title: 'Auto',
      meta: autoAssistantLabel(readyAssistant, assistants)
    }
  }

  const model = assistantModelLabel(assistant)

  return {
    title: assistantLabel(assistant),
    meta: model === 'Default' ? 'Default model' : model
  }
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
