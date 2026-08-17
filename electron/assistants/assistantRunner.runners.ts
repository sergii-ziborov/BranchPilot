import type { InstalledAssistantId } from '../../src/shared/branchPilot.js'

export interface AssistantRunner {
  id: InstalledAssistantId
  label: string
  executable: string
  /** Shown verbatim when the CLI reports it is not signed in. */
  signInHint: string
}

export interface ResolvedAssistantRunner extends AssistantRunner {
  executablePath: string
  model?: string
  modelLabel?: string
}

export const ASSISTANT_RUNNERS: AssistantRunner[] = [
  {
    id: 'claude',
    label: 'Claude Code',
    executable: 'claude',
    signInHint: 'Run "claude" in a terminal and sign in with /login, then try again.'
  },
  {
    id: 'codex',
    label: 'Codex',
    executable: 'codex',
    signInHint: 'Run "codex login" in a terminal, then try again.'
  }
]
