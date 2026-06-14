import { Bot, Check, Loader2, X } from 'lucide-react'
import type {
  AssistantActionKind, AssistantId, AssistantPolicyMode, AssistantPolicyStatus, AssistantStatus, RepositorySnapshot
} from '../shared/branchPilot'
import {
  assistantActionLabel, assistantPolicyAllows, assistantPolicyModeLabel, assistantReadinessSummary
} from '../lib/assistantLabels'
import { formatDate } from '../lib/format'

/** Readiness banner for a specific assistant action, with a quick check button. */
export function AssistantReadiness({
  action,
  assistants,
  selectedAssistant,
  checkAssistants,
  assistantsChecking
}: {
  action: AssistantActionKind
  assistants: AssistantStatus[]
  selectedAssistant: AssistantId
  checkAssistants: () => void | Promise<void>
  assistantsChecking: boolean
}) {
  const summary = assistantReadinessSummary(assistants, selectedAssistant)

  return (
    <div className={`assistant-readiness state-${summary.state}`}>
      <div>
        <span>{assistantActionLabel(action)}</span>
        <strong>{summary.title}</strong>
        <p>{summary.message}</p>
      </div>
      <button type="button" onClick={checkAssistants} disabled={assistantsChecking}>
        {assistantsChecking ? <Loader2 className="spin" size={15} /> : <Bot size={15} />}
        {assistantsChecking ? 'Checking' : 'Check'}
      </button>
    </div>
  )
}

/** Per-repository assistant policy mode selector and permission summary. */
export function AssistantPolicyPanel({
  assistantPolicy,
  assistantPolicyLoading,
  assistantPolicyModes,
  snapshot,
  updateAssistantPolicy
}: {
  assistantPolicy: AssistantPolicyStatus | null
  assistantPolicyLoading: boolean
  assistantPolicyModes: AssistantPolicyMode[]
  snapshot: RepositorySnapshot | null
  updateAssistantPolicy: (mode: AssistantPolicyMode) => void | Promise<void>
}) {
  const mode = assistantPolicy?.settings.mode ?? 'suggest-only'
  const lockedModes = assistantPolicy?.lockedModes ?? ['allow-local-commands', 'allow-file-edits']
  const actions: AssistantActionKind[] = ['commit_message', 'branch_draft', 'pull_request_text', 'linkedin_project', 'review_report']

  return (
    <section className="assistant-policy-panel">
      <div className="assistant-policy-heading">
        <div>
          <h3>Assistant policy</h3>
          <p>Per-repository permissions for Claude Code and Codex.</p>
        </div>
        <span>{assistantPolicyLoading ? 'Loading' : assistantPolicyModeLabel(mode)}</span>
      </div>

      <div className="segmented assistant-policy-modes" aria-label="Assistant policy modes">
        {assistantPolicyModes.map((candidateMode) => {
          const locked = lockedModes.includes(candidateMode)

          return (
            <button
              aria-pressed={mode === candidateMode}
              className={`${mode === candidateMode ? 'active' : ''} ${locked ? 'locked' : ''}`.trim()}
              disabled={!snapshot || assistantPolicyLoading || locked}
              key={candidateMode}
              onClick={() => updateAssistantPolicy(candidateMode)}
              type="button"
            >
              {assistantPolicyModeLabel(candidateMode)}
              {locked ? ' · future' : ''}
            </button>
          )
        })}
      </div>

      <div className="assistant-policy-actions">
        {actions.map((action) => {
          const allowed = assistantPolicyAllows(assistantPolicy, action)

          return (
            <div className={allowed ? 'allowed' : 'blocked'} key={action}>
              {allowed ? <Check size={15} /> : <X size={15} />}
              <span>{assistantActionLabel(action)}</span>
            </div>
          )
        })}
      </div>

      <div className="assistant-policy-copy">
        Assistants receive explicit local context only. BranchPilot v1 does not grant file write access, shell write access, auto-apply, or silent approval expansion.
        Destructive Git operations still require their own confirmations.
      </div>

      {assistantPolicy?.settings.updatedAt && (
        <div className="assistant-policy-updated">Updated {formatDate(assistantPolicy.settings.updatedAt)}</div>
      )}
    </section>
  )
}
