import type {
  AssistantActionKind,
  AssistantId,
  AssistantPolicyMode,
  AssistantPolicyStatus,
  AssistantStatus
} from '../shared/branchPilot'

/** Display name for a concrete assistant (Claude Code / Codex). */
export function assistantLabel(assistant: Exclude<AssistantId, 'auto'>): string {
  return assistant === 'claude' ? 'Claude Code' : 'Codex'
}

/** Short readiness word for an assistant's detection state. */
export function assistantStatusLabel(assistant: AssistantStatus): string {
  if (assistant.state === 'ready') return 'ready'
  if (assistant.state === 'unavailable') return 'unavailable'
  if (assistant.state === 'missing') return 'not found'
  return assistant.detected ? 'detected' : 'not found'
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
  return 'Assistant reviews'
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
