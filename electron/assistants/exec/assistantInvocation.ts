import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type {
  AssistantId,
  InstalledAssistantId
} from '../../../src/shared/branchPilot.js'
import { CommandExecutionError, CommandRunner } from '../../lib/commandRunner.js'
import { BranchPilotUserError } from '../../lib/errors.js'
import {
  GENERATED_TEXT_SCHEMA
} from '../assistantRunner.schemas.js'
import {
  ASSISTANT_RUNNERS,
  ResolvedAssistantRunner
} from '../assistantRunner.runners.js'
import { resolveExecutablePath } from './executableResolution.js'
import { summarizeAssistantFailure } from './failureSummary.js'

export async function resolveAssistantCandidates(runner: CommandRunner, requestedAssistant: AssistantId): Promise<ResolvedAssistantRunner[]> {
  const requestedBaseAssistant = assistantBaseId(requestedAssistant)
  const requestedModel = assistantModelCliValue(requestedAssistant)
  const requestedModelLabel = requestedAssistant === 'auto' ? undefined : assistantModelLabel(requestedAssistant)
  const candidates = requestedAssistant === 'auto'
    ? ASSISTANT_RUNNERS
    : ASSISTANT_RUNNERS.filter((candidate) => candidate.id === requestedBaseAssistant)
  const resolved: ResolvedAssistantRunner[] = []

  for (const candidate of candidates) {
    const executablePath = await resolveExecutablePath(runner, candidate.executable)

    if (executablePath) {
      resolved.push({
        ...candidate,
        executablePath,
        model: requestedModel,
        modelLabel: requestedModelLabel
      })
    }
  }

  if (resolved.length > 0) {
    return resolved
  }

  const label = requestedAssistant === 'auto'
    ? 'Claude Code or Codex'
    : ASSISTANT_RUNNERS.find((candidate) => candidate.id === requestedBaseAssistant)?.label ?? requestedAssistant

  throw new BranchPilotUserError('assistant_not_found', `${label} CLI is not available on PATH or known Windows install locations.`)
}

export async function runAssistantForRequest(
  runner: CommandRunner,
  requestedAssistant: AssistantId,
  prompt: string,
  outputSchema = GENERATED_TEXT_SCHEMA
): Promise<{ assistant: ResolvedAssistantRunner; output: string }> {
  const candidates = await resolveAssistantCandidates(runner, requestedAssistant)
  let lastError: unknown

  for (const assistant of candidates) {
    try {
      return {
        assistant,
        output: await runAssistant(runner, assistant, prompt, outputSchema)
      }
    } catch (error) {
      if (
        requestedAssistant !== 'auto' ||
        !(error instanceof BranchPilotUserError) ||
        error.code !== 'assistant_failed'
      ) {
        throw error
      }

      lastError = error
    }
  }

  throw lastError
}

export async function runAssistant(
  runner: CommandRunner,
  assistant: ResolvedAssistantRunner,
  prompt: string,
  outputSchema = GENERATED_TEXT_SCHEMA
): Promise<string> {
  try {
    if (assistant.id === 'claude') {
      const modelArgs = assistant.model ? ['--model', assistant.model] : []
      const result = await runner.run(assistant.executablePath, [
        ...modelArgs,
        '--print',
        '--input-format',
        'text',
        '--output-format',
        'text',
        '--no-session-persistence',
        '--permission-mode',
        'dontAsk',
        '--tools',
        '""'
      ], {
        cwd: os.tmpdir(),
        input: prompt,
        timeoutMs: 120_000
      })

      return result.stdout
    }

    return await runCodex(runner, assistant.executablePath, prompt, outputSchema, assistant.model)
  } catch (error) {
    if (error instanceof BranchPilotUserError) {
      throw error
    }

    if (error instanceof CommandExecutionError) {
      throw new BranchPilotUserError(
        'assistant_failed',
        `${assistant.label} failed to generate text.`,
        summarizeAssistantFailure([error.result.stderr, error.result.stdout].filter(Boolean).join('\n'))
      )
    }

    throw error
  }
}

function assistantBaseId(assistant: AssistantId): InstalledAssistantId | 'auto' {
  if (assistant.startsWith('claude')) return 'claude'
  if (assistant.startsWith('codex')) return 'codex'
  return 'auto'
}

function assistantModelCliValue(assistant: AssistantId): string | undefined {
  const models: Partial<Record<AssistantId, string>> = {
    'claude:opus': 'opus',
    'claude:sonnet': 'sonnet',
    'claude:haiku': 'haiku',
    'codex:gpt-5': 'gpt-5',
    'codex:gpt-5-codex': 'gpt-5-codex',
    'codex:gpt-5-mini': 'gpt-5-mini'
  }

  return models[assistant]
}

function assistantModelLabel(assistant: AssistantId): string {
  const labels: Partial<Record<AssistantId, string>> = {
    claude: 'Default',
    'claude:opus': 'Opus',
    'claude:sonnet': 'Sonnet',
    'claude:haiku': 'Haiku',
    codex: 'Default',
    'codex:gpt-5': 'GPT-5',
    'codex:gpt-5-codex': 'GPT-5 Codex',
    'codex:gpt-5-mini': 'GPT-5 Mini'
  }

  return labels[assistant] ?? 'Default'
}

export async function runCodex(
  runner: CommandRunner,
  executablePath: string,
  prompt: string,
  outputSchema: Record<string, unknown>,
  model?: string
): Promise<string> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'branchpilot-assistant-'))
  const schemaPath = path.join(tempDir, 'commit-message.schema.json')

  try {
    await fs.writeFile(schemaPath, JSON.stringify(outputSchema), 'utf8')
    const modelArgs = model ? ['--model', model] : []
    const result = await runner.run(executablePath, [
      'exec',
      ...modelArgs,
      '--sandbox',
      'read-only',
      '--cd',
      tempDir,
      '--skip-git-repo-check',
      '--ephemeral',
      '--output-schema',
      schemaPath,
      '--color',
      'never',
      '-'
    ], {
      cwd: tempDir,
      input: prompt,
      timeoutMs: 120_000
    })

    return result.stdout
  } finally {
    await fs.rm(tempDir, { force: true, recursive: true })
  }
}
