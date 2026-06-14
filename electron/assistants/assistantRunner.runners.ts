import type { InstalledAssistantId } from '../../src/shared/branchPilot.js'

export interface AssistantRunner {
  id: InstalledAssistantId
  label: string
  executable: string
}

export interface ResolvedAssistantRunner extends AssistantRunner {
  executablePath: string
}

export const ASSISTANT_RUNNERS: AssistantRunner[] = [
  { id: 'claude', label: 'Claude Code', executable: 'claude' },
  { id: 'codex', label: 'Codex', executable: 'codex' }
]
