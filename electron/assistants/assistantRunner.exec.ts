import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type {
  AssistantId
} from '../../src/shared/branchPilot.js'
import { CommandExecutionError, CommandRunner } from '../lib/commandRunner.js'
import { BranchPilotUserError } from '../lib/errors.js'
import { WHICH_EXECUTABLE } from '../lib/platformExecutables.js'
import {
  GENERATED_TEXT_SCHEMA
} from './assistantRunner.schemas.js'
import {
  ASSISTANT_RUNNERS,
  ResolvedAssistantRunner
} from './assistantRunner.runners.js'

export async function resolveAssistantCandidates(runner: CommandRunner, requestedAssistant: AssistantId): Promise<ResolvedAssistantRunner[]> {
  const candidates = requestedAssistant === 'auto'
    ? ASSISTANT_RUNNERS
    : ASSISTANT_RUNNERS.filter((candidate) => candidate.id === requestedAssistant)
  const resolved: ResolvedAssistantRunner[] = []

  for (const candidate of candidates) {
    const executablePath = await resolveExecutablePath(runner, candidate.executable)

    if (executablePath) {
      resolved.push({
        ...candidate,
        executablePath
      })
    }
  }

  if (resolved.length > 0) {
    return resolved
  }

  const label = requestedAssistant === 'auto'
    ? 'Claude Code or Codex'
    : ASSISTANT_RUNNERS.find((candidate) => candidate.id === requestedAssistant)?.label ?? requestedAssistant

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

export async function resolveExecutablePath(runner: CommandRunner, executable: string): Promise<string | undefined> {
  if (process.platform === 'win32') {
    return resolveWindowsExecutablePath(runner, executable)
  }

  try {
    const result = await runner.run(WHICH_EXECUTABLE, [executable], {
      timeoutMs: 5_000
    })
    return result.stdout.split('\n').map((line) => line.trim()).filter(Boolean)[0] ?? executable
  } catch {
    return undefined
  }
}

async function resolveWindowsExecutablePath(runner: CommandRunner, executable: string): Promise<string | undefined> {
  const candidates = await findWithWhere(runner, executable)
  const normalized = await Promise.all(candidates.map((candidate) => normalizeWindowsExecutableCandidate(candidate, executable)))
  const unique = uniquePaths(normalized.filter((candidate): candidate is string => Boolean(candidate)))

  return unique.sort(compareWindowsExecutablePreference)[0]
}

async function findWithWhere(runner: CommandRunner, executable: string): Promise<string[]> {
  try {
    const result = await runner.run(WHICH_EXECUTABLE, [executable], {
      timeoutMs: 5_000
    })

    return result.stdout.split('\n').map((line) => line.trim()).filter(Boolean)
  } catch {
    return []
  }
}

async function normalizeWindowsExecutableCandidate(candidate: string, executable: string): Promise<string | undefined> {
  if (!isWindowsPath(candidate)) {
    return candidate
  }

  const directCandidate = await existingFile(candidate)

  if (!directCandidate) {
    return undefined
  }

  if (path.extname(directCandidate).toLowerCase() === '.exe') {
    return directCandidate
  }

  const shimFileTarget = await resolveWindowsShimFileTarget(directCandidate)

  if (shimFileTarget) {
    return shimFileTarget
  }

  const shimTarget = await resolveKnownWindowsShimTarget(directCandidate, executable)

  if (shimTarget) {
    return shimTarget
  }

  return undefined
}

async function resolveKnownWindowsShimTarget(shimPath: string, executable: string): Promise<string | undefined> {
  const directory = path.dirname(shimPath)
  const knownTargets: Record<string, string[]> = {
    claude: [
      path.join(directory, 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe')
    ],
    codex: [
      path.join(directory, 'node_modules', '@openai', 'codex', 'bin', 'codex.exe'),
      path.join(directory, 'node_modules', '@openai', 'codex', 'bin', 'codex-x86_64-pc-windows-msvc.exe')
    ]
  }

  for (const target of knownTargets[executable] ?? []) {
    const existingTarget = await existingFile(target)

    if (existingTarget) {
      return existingTarget
    }
  }

  return undefined
}

async function resolveWindowsShimFileTarget(shimPath: string): Promise<string | undefined> {
  let content: string

  try {
    content = await fs.readFile(shimPath, 'utf8')
  } catch {
    return undefined
  }

  const directory = path.dirname(shimPath)
  const targetPatterns = [
    /"%dp0%[\\/](?<target>[^"]+?\.exe)"/i,
    /"\$basedir[\\/](?<target>[^"]+?\.exe)"/i
  ]

  for (const pattern of targetPatterns) {
    const match = content.match(pattern)
    const target = match?.groups?.target

    if (!target) {
      continue
    }

    const resolvedTarget = await existingFile(path.join(directory, target.replaceAll('/', path.sep).replaceAll('\\', path.sep)))

    if (resolvedTarget) {
      return resolvedTarget
    }
  }

  return undefined
}

async function existingFile(filePath: string): Promise<string | undefined> {
  try {
    const stats = await fs.stat(filePath)

    return stats.isFile() ? path.normalize(filePath) : undefined
  } catch {
    return undefined
  }
}

function isWindowsPath(candidate: string): boolean {
  return /^[a-z]:[\\/]/i.test(candidate) || candidate.startsWith('\\\\')
}

function uniquePaths(paths: Array<string | undefined>): string[] {
  const seen = new Set<string>()
  const unique: string[] = []

  for (const candidate of paths) {
    if (!candidate) {
      continue
    }

    const key = candidate.toLowerCase()

    if (!seen.has(key)) {
      seen.add(key)
      unique.push(candidate)
    }
  }

  return unique
}

function compareWindowsExecutablePreference(left: string, right: string): number {
  return windowsExecutablePreference(left) - windowsExecutablePreference(right)
}

function windowsExecutablePreference(filePath: string): number {
  const normalized = filePath.toLowerCase()

  if (normalized.includes('\\.vscode\\extensions\\openai.chatgpt-')) {
    return 0
  }

  if (normalized.endsWith('\\claude.exe') || normalized.endsWith('\\codex.exe')) {
    return 1
  }

  if (path.extname(normalized) === '.exe') {
    return 2
  }

  return 3
}

export async function runAssistant(
  runner: CommandRunner,
  assistant: ResolvedAssistantRunner,
  prompt: string,
  outputSchema = GENERATED_TEXT_SCHEMA
): Promise<string> {
  try {
    if (assistant.id === 'claude') {
      const result = await runner.run(assistant.executablePath, [
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

    return await runCodex(runner, assistant.executablePath, prompt, outputSchema)
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

export function assistantHealthErrorMessage(error: unknown): string {
  if (error instanceof BranchPilotUserError) {
    return error.details
      ? `${error.message} ${error.details}`
      : error.message
  }

  if (error instanceof Error) {
    return error.message
  }

  return 'Assistant health check failed.'
}

export function summarizeAssistantFailure(output: string): string {
  const lines = output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  const importantLines = lines.filter((line) =>
    /^ERROR[:\s]/i.test(line) ||
    /auth|login|token|subscription|disabled|invalid_request|invalid_json_schema|quota|rate limit/i.test(line)
  )
  const summary = (importantLines.length > 0 ? importantLines : lines.slice(-8)).join('\n')

  return summary.slice(0, 2_000)
}

export async function runCodex(
  runner: CommandRunner,
  executablePath: string,
  prompt: string,
  outputSchema: Record<string, unknown>
): Promise<string> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'branchpilot-assistant-'))
  const schemaPath = path.join(tempDir, 'commit-message.schema.json')

  try {
    await fs.writeFile(schemaPath, JSON.stringify(outputSchema), 'utf8')
    const result = await runner.run(executablePath, [
      'exec',
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


