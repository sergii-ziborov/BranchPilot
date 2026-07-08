import type { AssistantStatus } from '../../../src/shared/branchPilot.js'
import { CommandRunner } from '../../lib/commandRunner.js'
import { GENERATED_TEXT_SCHEMA } from '../assistantRunner.schemas.js'
import { ASSISTANT_RUNNERS } from '../assistantRunner.runners.js'
import {
  assistantHealthErrorMessage,
  resolveExecutablePath,
  runAssistant
} from '../assistantRunner.exec.js'

export async function listAssistantStatuses(runner: CommandRunner): Promise<AssistantStatus[]> {
  return Promise.all(
    ASSISTANT_RUNNERS.map(async (candidate) => {
      const executablePath = await resolveExecutablePath(runner, candidate.executable)

      return {
        id: candidate.id,
        label: candidate.label,
        executable: executablePath ?? candidate.executable,
        detected: Boolean(executablePath),
        state: executablePath ? 'detected' : 'missing',
        message: executablePath
          ? `${candidate.label} CLI was found. Run a health check to verify access.`
          : `${candidate.label} CLI was not found on PATH or known Windows install locations.`
      }
    })
  )
}

export async function checkAssistantStatuses(runner: CommandRunner): Promise<AssistantStatus[]> {
  return Promise.all(
    ASSISTANT_RUNNERS.map(async (candidate) => {
      const executablePath = await resolveExecutablePath(runner, candidate.executable)
      const checkedAt = new Date().toISOString()

      if (!executablePath) {
        return {
          id: candidate.id,
          label: candidate.label,
          executable: candidate.executable,
          detected: false,
          state: 'missing',
          message: `${candidate.label} CLI was not found on PATH or known Windows install locations.`,
          checkedAt
        }
      }

      const assistant = {
        ...candidate,
        executablePath
      }

      try {
        await runAssistant(
          runner,
          assistant,
          'Return JSON only with this shape: {"title":"Assistant health check","description":"ready"}.',
          GENERATED_TEXT_SCHEMA
        )

        return {
          id: candidate.id,
          label: candidate.label,
          executable: executablePath,
          detected: true,
          state: 'ready',
          message: `${candidate.label} is ready for BranchPilot generation.`,
          checkedAt
        }
      } catch (error) {
        return {
          id: candidate.id,
          label: candidate.label,
          executable: executablePath,
          detected: true,
          state: 'unavailable',
          message: assistantHealthErrorMessage(error),
          checkedAt
        }
      }
    })
  )
}
