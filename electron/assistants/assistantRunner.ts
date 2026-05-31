import type { AssistantStatus } from '../../src/shared/branchPilot.js'
import { CommandRunner } from '../lib/commandRunner.js'

export interface AssistantRunner {
  id: AssistantStatus['id']
  label: string
  executable: string
}

export async function listAssistantStatuses(runner: CommandRunner): Promise<AssistantStatus[]> {
  const candidates: AssistantRunner[] = [
    { id: 'claude', label: 'Claude Code', executable: 'claude' },
    { id: 'codex', label: 'Codex', executable: 'codex' }
  ]

  return Promise.all(
    candidates.map(async (candidate) => ({
      id: candidate.id,
      label: candidate.label,
      executable: candidate.executable,
      detected: await isExecutableAvailable(runner, candidate.executable)
    }))
  )
}

async function isExecutableAvailable(runner: CommandRunner, executable: string): Promise<boolean> {
  try {
    await runner.run('/usr/bin/which', [executable], {
      timeoutMs: 5_000
    })
    return true
  } catch {
    return false
  }
}
