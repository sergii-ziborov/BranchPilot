import type {
  AssistantActionKind,
  AssistantPolicyMode,
  AssistantPolicySettings,
  AssistantPolicyStatus,
  AssistantPolicyUpdate
} from '../../src/shared/branchPilot.js'
import { BranchPilotUserError } from './errors.js'
import type { SettingsStore } from './settingsStore.js'

export const DEFAULT_ASSISTANT_POLICY_MODE: AssistantPolicyMode = 'suggest-only'
export const LOCKED_ASSISTANT_POLICY_MODES: AssistantPolicyMode[] = ['allow-local-commands', 'allow-file-edits']

const ALL_ASSISTANT_POLICY_MODES: AssistantPolicyMode[] = [
  'disabled',
  'review-only',
  'suggest-only',
  ...LOCKED_ASSISTANT_POLICY_MODES
]

const ACTION_LABELS: Record<AssistantActionKind, string> = {
  branch_draft: 'branch draft generation',
  commit_message: 'commit text generation',
  file_beautify: 'file beautify',
  codex_agent: 'Codex agent',
  linkedin_project: 'LinkedIn project generation',
  pull_request_text: 'pull request text generation',
  repository_starter: 'repository starter generation',
  review_report: 'review'
}

export class AssistantPolicyService {
  constructor(private readonly settingsStore: SettingsStore) {}

  async getAssistantPolicy(repoPath: string): Promise<AssistantPolicyStatus> {
    const normalizedRepoPath = normalizeRepoPath(repoPath)
    const persisted = await this.settingsStore.getAssistantPolicy(normalizedRepoPath)
    const settings = normalizePersistedPolicy(normalizedRepoPath, persisted)

    return buildAssistantPolicyStatus(settings)
  }

  async setAssistantPolicy(update: AssistantPolicyUpdate): Promise<AssistantPolicyStatus> {
    const repoPath = normalizeRepoPath(update.repoPath)
    const mode = normalizeMode(update.mode)

    if (LOCKED_ASSISTANT_POLICY_MODES.includes(mode)) {
      throw new BranchPilotUserError(
        'assistant_policy_mode_locked',
        'This assistant policy mode is reserved for a later version.',
        'BranchPilot v1 keeps assistants suggest-only and does not grant local command or file edit permissions.'
      )
    }

    const settings = await this.settingsStore.setAssistantPolicy({
      repoPath,
      mode,
      updatedAt: new Date().toISOString()
    })

    return buildAssistantPolicyStatus(settings)
  }

  async assertActionAllowed(repoPath: string, action: AssistantActionKind): Promise<AssistantPolicyStatus> {
    const status = await this.getAssistantPolicy(repoPath)

    if (!status.allowedActions.includes(action)) {
      throw new BranchPilotUserError(
        'assistant_policy_blocked',
        `Assistant ${ACTION_LABELS[action]} is blocked by this repository policy.`,
        assistantPolicyDetails(status.settings.mode)
      )
    }

    return status
  }
}

export function buildAssistantPolicyStatus(settings: AssistantPolicySettings): AssistantPolicyStatus {
  return {
    settings,
    allowedActions: allowedActionsForMode(settings.mode),
    lockedModes: LOCKED_ASSISTANT_POLICY_MODES
  }
}

export function allowedActionsForMode(mode: AssistantPolicyMode): AssistantActionKind[] {
  if (mode === 'disabled') {
    return []
  }

  if (mode === 'review-only') {
    return ['commit_message', 'review_report', 'linkedin_project', 'repository_starter', 'file_beautify', 'codex_agent']
  }

  return ['commit_message', 'pull_request_text', 'review_report', 'branch_draft', 'linkedin_project', 'repository_starter', 'file_beautify', 'codex_agent']
}

function normalizePersistedPolicy(repoPath: string, settings?: AssistantPolicySettings): AssistantPolicySettings {
  if (!settings || !isAssistantPolicyMode(settings.mode)) {
    return {
      repoPath,
      mode: DEFAULT_ASSISTANT_POLICY_MODE,
      updatedAt: ''
    }
  }

  return {
    repoPath,
    mode: settings.mode,
    updatedAt: settings.updatedAt
  }
}

function normalizeRepoPath(repoPath: string): string {
  const normalized = repoPath.trim()

  if (!normalized) {
    throw new BranchPilotUserError(
      'invalid_repository_path',
      'Repository path is required.'
    )
  }

  return normalized
}

function normalizeMode(mode: AssistantPolicyMode): AssistantPolicyMode {
  if (!isAssistantPolicyMode(mode)) {
    throw new BranchPilotUserError(
      'invalid_assistant_policy_mode',
      'Unknown assistant policy mode.'
    )
  }

  return mode
}

function isAssistantPolicyMode(mode: unknown): mode is AssistantPolicyMode {
  return typeof mode === 'string' && ALL_ASSISTANT_POLICY_MODES.includes(mode as AssistantPolicyMode)
}

function assistantPolicyDetails(mode: AssistantPolicyMode): string {
  if (mode === 'disabled') {
    return 'Current policy disables all Claude/Codex assistant actions for this repository.'
  }

  if (mode === 'review-only') {
    return 'Current policy allows assistant reviews and local text drafts. Pull request text generation and branch drafts are disabled.'
  }

  return 'Current policy does not allow assistants to write files, run local commands, or auto-apply changes.'
}
