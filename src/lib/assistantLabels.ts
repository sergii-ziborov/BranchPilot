import type {
  AssistantActionKind,
  AssistantId,
  AssistantPolicyMode,
  AssistantPolicyStatus,
  AssistantStatus
} from '../shared/branchPilot'

export type AssistantReadinessState = AssistantStatus['state'] | 'unknown'

/** Display name for a concrete assistant (Claude Code / Codex). */
export function assistantLabel(assistant: Exclude<AssistantId, 'auto'>): string {
  return assistant === 'claude' ? 'Claude Code' : 'Codex'
}

/** Short readiness word for an assistant's detection state. */
export function assistantStatusLabel(assistant: AssistantStatus): string {
  if (assistant.state === 'ready') return 'ready'
  if (assistant.state === 'unavailable') return assistantIsSessionLimited(assistant) ? 'limited' : 'unavailable'
  if (assistant.state === 'missing') return 'not found'
  return assistant.detected ? 'detected' : 'not found'
}

export function assistantIsSessionLimited(assistant: AssistantStatus): boolean {
  return /session limit|usage limit|rate limit|quota|resets?/i.test(assistant.message)
}

/** Whether the current policy permits an assistant action (open when unset). */
export function assistantPolicyAllows(policy: AssistantPolicyStatus | null, action: AssistantActionKind): boolean {
  if (!policy) {
    return true
  }

  return policy.allowedActions.includes(action)
}

/** Display label for an assistant policy mode. */
export function assistantPolicyModeLabel(mode: AssistantPolicyMode): string {
  if (mode === 'disabled') return 'Disabled'
  if (mode === 'review-only') return 'Review only'
  if (mode === 'allow-local-commands') return 'Allow local commands'
  if (mode === 'allow-file-edits') return 'Allow file edits'
  return 'Suggest only'
}

/** Human-readable label for an assistant action kind. */
export function assistantActionLabel(action: AssistantActionKind): string {
  if (action === 'branch_draft') return 'Branch draft generation'
  if (action === 'commit_message') return 'Commit text generation'
  if (action === 'linkedin_project') return 'LinkedIn project generation'
  if (action === 'pull_request_text') return 'PR text generation'
  if (action === 'repository_starter') return 'Repository starter generation'
  return 'Assistant reviews'
}

/** Summarise assistant readiness for the selected assistant (or Auto). */
export function assistantReadinessSummary(
  assistants: AssistantStatus[],
  selectedAssistant: AssistantId
): { state: AssistantReadinessState; title: string; message: string } {
  if (assistants.length === 0) {
    return {
      state: 'unknown',
      title: 'Assistant status not loaded',
      message: 'BranchPilot has not loaded Claude/Codex detection yet.'
    }
  }

  if (selectedAssistant !== 'auto') {
    const assistant = assistants.find((candidate) => candidate.id === selectedAssistant)

    if (!assistant) {
      return {
        state: 'missing',
        title: `${assistantLabel(selectedAssistant)} is not configured`,
        message: 'Select Auto or install the requested assistant CLI.'
      }
    }

    return {
      state: assistant.state,
      title: `${assistant.label}: ${assistantStatusLabel(assistant)}`,
      message: assistant.message
    }
  }

  const ready = assistants.find((assistant) => assistant.state === 'ready')

  if (ready) {
    return {
      state: 'ready',
      title: `Auto will use ${ready.label}`,
      message: ready.message
    }
  }

  const detected = assistants.find((assistant) => assistant.state === 'detected')

  if (detected) {
    return {
      state: 'detected',
      title: 'Auto has detected assistants',
      message: 'Run a health check to verify that generation access works before relying on Auto.'
    }
  }

  const unavailable = assistants.find((assistant) => assistant.state === 'unavailable')

  if (unavailable) {
    return {
      state: 'unavailable',
      title: 'Auto has no ready assistant',
      message: assistants.map((assistant) => `${assistant.label}: ${assistantStatusLabel(assistant)}`).join(' · ')
    }
  }

  return {
    state: 'missing',
    title: 'No assistant CLI found',
    message: 'Install Claude Code or Codex, then reload assistant detection.'
  }
}

/** Explain why an assistant action is blocked under the current policy. */
export function assistantPolicyBlockedLabel(action: AssistantActionKind, policy: AssistantPolicyStatus | null): string {
  const mode = policy?.settings.mode ?? 'suggest-only'

  if (mode === 'disabled') {
    return `${assistantActionLabel(action)} is blocked because assistant policy is Disabled.`
  }

  if (mode === 'review-only') {
    return `${assistantActionLabel(action)} is blocked because assistant policy is Review only.`
  }

  return `${assistantActionLabel(action)} is not available under the current assistant policy.`
}
