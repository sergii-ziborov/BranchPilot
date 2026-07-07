import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type {
  AssistantId,
  CodexAgentReasoning,
  CodexAgentSandbox,
  InstalledAssistantId
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

export function assistantHealthErrorMessage(error: unknown): string {
  if (error instanceof BranchPilotUserError) {
    const details = error.details ? summarizeAssistantFailure(error.details) : ''

    return details
      ? `${error.message} ${details}`
      : error.message
  }

  if (error instanceof Error) {
    return error.message
  }

  return 'Assistant health check failed.'
}

export function summarizeAssistantFailure(output: string): string {
  const usageSummary = summarizeAssistantUsageLimit(output)

  if (usageSummary) {
    return usageSummary
  }

  const lines = output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  const importantLines = lines.filter((line) =>
    /^ERROR[:\s]/i.test(line) ||
    /auth|login|token|subscription|disabled|invalid_request|invalid_json_schema|quota|rate limit|usage|remaining|resets?/i.test(line)
  )
  const summary = (importantLines.length > 0 ? importantLines : lines.slice(-8)).join('\n')

  return summary.slice(0, 2_000)
}

function summarizeAssistantUsageLimit(output: string): string | undefined {
  const text = normalizeAssistantOutputText(output)

  if (!text) {
    return undefined
  }

  const reset = extractAssistantResetLabel(text)

  if (/session limit/i.test(text)) {
    return assistantLimitSummary("You've hit your session limit", reset)
  }

  if (/usage limit/i.test(text)) {
    return assistantLimitSummary("You've hit your usage limit", reset)
  }

  if (/rate limit/i.test(text)) {
    return assistantLimitSummary('Rate limit reached', reset)
  }

  if (/\bquota\b/i.test(text)) {
    return assistantLimitSummary('Quota limit reached', reset)
  }

  const remaining = /((?:usage\s+(?:remaining|left)|remaining\s+usage)[^.\n]*)/i.exec(text)?.[1]?.trim() ||
    /(\d{1,3}%\s+(?:remaining|left))/i.exec(text)?.[1]?.trim()

  return remaining || undefined
}

function assistantLimitSummary(message: string, reset?: string): string {
  return reset ? `${message} - resets ${reset}` : message
}

function normalizeAssistantOutputText(output: string): string {
  return output
    .replaceAll('\\n', '\n')
    .replaceAll('\\"', '"')
    .replace(/\s+/g, ' ')
    .trim()
}

function extractAssistantResetLabel(text: string): string | undefined {
  const value =
    extractResetValue(text, /resets?\s+(?:at\s+)?(?<value>\d{4}-\d{2}-\d{2}[T\s][\d:.+-]+Z?)/i) ||
    extractResetValue(text, /(?:try again|retry|available again)\s+(?:at|after)\s+(?<value>\d{4}-\d{2}-\d{2}[T\s][\d:.+-]+Z?)/i) ||
    extractResetValue(text, /resets?\s+(?:at\s+)?(?<value>\d{1,2}(?::\d{2})?\s*(?:am|pm)(?:\s*\([^)]*\))?)/i) ||
    extractResetValue(text, /(?:try again|retry|available again)\s+(?:at|after)\s+(?<value>\d{1,2}(?::\d{2})?\s*(?:am|pm)(?:\s*\([^)]*\))?)/i) ||
    extractResetValue(text, /resets?\s+(?:at\s+)?(?<value>[^.\n]+)/i)

  return value ? normalizeAssistantResetValue(value) : undefined
}

function extractResetValue(text: string, pattern: RegExp): string | undefined {
  return pattern.exec(text)?.groups?.value
}

function normalizeAssistantResetValue(value: string): string {
  const clean = value
    .trim()
    .replace(/^["'`]+|["'`)]+$/g, '')
    .replace(/[.,;:]+$/g, '')
    .trim()
  const timeZone = localTimeZoneLabel()

  if (/^\d{4}-\d{2}-\d{2}/.test(clean)) {
    const timestamp = Date.parse(clean)

    if (!Number.isNaN(timestamp)) {
      const formatted = new Intl.DateTimeFormat('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
        ...(timeZone ? { timeZone } : {})
      }).format(new Date(timestamp))

      return timeZone ? `${formatted} (${timeZone})` : formatted
    }
  }

  if (/\b(?:am|pm)\b/i.test(clean) && !/\([^)]*\)\s*$/.test(clean) && timeZone) {
    return `${clean} (${timeZone})`
  }

  return clean
}

function localTimeZoneLabel(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone
  } catch {
    return undefined
  }
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

export async function runCodexAgentExec(
  runner: CommandRunner,
  assistant: ResolvedAssistantRunner,
  options: {
    rootPath: string
    prompt: string
    imagePaths: string[]
    sandbox: CodexAgentSandbox
    reasoning: CodexAgentReasoning
  }
): Promise<{ output: string; eventLog: string }> {
  if (assistant.id !== 'codex') {
    throw new BranchPilotUserError('assistant_not_found', 'Codex CLI is required for the Codex agent panel.')
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'branchpilot-codex-agent-'))
  const outputPath = path.join(tempDir, 'last-message.txt')
  const modelArgs = assistant.model ? ['--model', assistant.model] : []
  const reasoningArgs = ['--config', `model_reasoning_effort="${codexReasoningEffort(options.reasoning)}"`]
  const imageArgs = options.imagePaths.flatMap((imagePath) => ['--image', imagePath])

  try {
    const result = await runner.run(assistant.executablePath, [
      'exec',
      ...modelArgs,
      ...reasoningArgs,
      '--sandbox',
      options.sandbox,
      '--cd',
      options.rootPath,
      '--skip-git-repo-check',
      '--json',
      '--color',
      'never',
      '--output-last-message',
      outputPath,
      ...imageArgs,
      '-'
    ], {
      cwd: options.rootPath,
      input: options.prompt,
      timeoutMs: 300_000
    })
    let output = ''

    try {
      output = await fs.readFile(outputPath, 'utf8')
    } catch {
      output = ''
    }

    return {
      output: output.trim() || result.stdout.trim(),
      eventLog: result.stdout
    }
  } finally {
    await fs.rm(tempDir, { force: true, recursive: true })
  }
}

export async function runClaudeAgentExec(
  runner: CommandRunner,
  assistant: ResolvedAssistantRunner,
  options: {
    rootPath: string
    prompt: string
    imagePaths: string[]
    imageTempDir: string
    sandbox: CodexAgentSandbox
    reasoning: CodexAgentReasoning
  }
): Promise<{ output: string; eventLog: string }> {
  if (assistant.id !== 'claude') {
    throw new BranchPilotUserError('assistant_not_found', 'Claude Code is required for the Claude agent panel.')
  }

  const modelArgs = assistant.model ? ['--model', assistant.model] : []
  const imageDirArgs = options.imagePaths.length > 0 ? ['--add-dir', options.imageTempDir] : []
  const result = await runner.run(assistant.executablePath, [
    ...modelArgs,
    '--print',
    '--input-format',
    'text',
    '--output-format',
    'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--no-session-persistence',
    '--effort',
    claudeReasoningEffort(options.reasoning),
    ...imageDirArgs,
    ...claudeAccessArgs(options.sandbox)
  ], {
    cwd: options.rootPath,
    input: options.prompt,
    timeoutMs: 300_000
  })
  const parsedEvents = parseClaudeStreamEvents(result.stdout)

  return {
    output: parsedEvents.map((event) => event.text).filter(Boolean).slice(-3).join('\n\n') || result.stdout.trim(),
    eventLog: result.stdout
  }
}

function codexReasoningEffort(reasoning: CodexAgentReasoning): string {
  if (reasoning === 'light') return 'low'
  if (reasoning === 'medium') return 'medium'
  return 'high'
}

function claudeReasoningEffort(reasoning: CodexAgentReasoning): string {
  if (reasoning === 'light') return 'low'
  if (reasoning === 'medium') return 'medium'
  if (reasoning === 'high') return 'high'
  return 'xhigh'
}

function claudeAccessArgs(sandbox: CodexAgentSandbox): string[] {
  if (sandbox === 'danger-full-access') {
    return ['--dangerously-skip-permissions']
  }

  const readTools = [
    'Read',
    'Glob',
    'Grep',
    'LS',
    'Bash(git status:*)',
    'Bash(git diff:*)',
    'Bash(git log:*)',
    'Bash(git show:*)'
  ]

  if (sandbox === 'read-only') {
    return [
      '--permission-mode',
      'dontAsk',
      '--allowedTools',
      readTools.join(',')
    ]
  }

  return [
    '--permission-mode',
    'acceptEdits',
    '--allowedTools',
    [
      ...readTools,
      'Edit',
      'MultiEdit',
      'Write',
      'Bash(npm test:*)',
      'Bash(npm run lint:*)',
      'Bash(npm run build:*)',
      'Bash(node:*)'
    ].join(',')
  ]
}

function parseClaudeStreamEvents(eventLog: string): Array<{ type: string; text: string }> {
  const events: Array<{ type: string; text: string }> = []

  for (const line of eventLog.split('\n')) {
    const trimmed = line.trim()

    if (!trimmed) continue

    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>
      const text = extractClaudeStreamText(parsed)

      if (text) events.push({ type: String(parsed.type ?? 'event'), text })
    } catch {
      events.push({ type: 'stdout', text: trimmed })
    }
  }

  return events
}

function extractClaudeStreamText(value: unknown): string {
  if (typeof value === 'string') return value
  if (!value || typeof value !== 'object') return ''

  const record = value as Record<string, unknown>
  const direct = record.text ?? record.result ?? record.summary

  if (typeof direct === 'string') return direct.trim()

  if (record.message && typeof record.message === 'object') {
    return extractClaudeStreamText(record.message)
  }

  if (Array.isArray(record.content)) {
    return record.content.map(extractClaudeStreamText).filter(Boolean).join('\n').trim()
  }

  return ''
}


