import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type {
  AssistantId,
  AssistantStatus,
  CommitMessageGenerationRequest,
  GeneratedCommitMessage,
  GeneratedPullRequestText,
  InstalledAssistantId,
  PullRequestTextGenerationRequest
} from '../../src/shared/branchPilot.js'
import { CommandExecutionError, CommandRunner } from '../lib/commandRunner.js'
import { BranchPilotUserError } from '../lib/errors.js'

export interface AssistantRunner {
  id: InstalledAssistantId
  label: string
  executable: string
}

interface ResolvedAssistantRunner extends AssistantRunner {
  executablePath: string
}

const MAX_ASSISTANT_DIFF_BYTES = 80_000
const MAX_ASSISTANT_PR_DIFF_BYTES = 120_000

const GENERATED_TEXT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title'],
  properties: {
    title: {
      type: 'string',
      minLength: 1
    },
    description: {
      type: 'string'
    }
  }
}

const ASSISTANT_RUNNERS: AssistantRunner[] = [
  { id: 'claude', label: 'Claude Code', executable: 'claude' },
  { id: 'codex', label: 'Codex', executable: 'codex' }
]

export async function listAssistantStatuses(runner: CommandRunner): Promise<AssistantStatus[]> {
  return Promise.all(
    ASSISTANT_RUNNERS.map(async (candidate) => {
      const executablePath = await resolveExecutablePath(runner, candidate.executable)

      return {
        id: candidate.id,
        label: candidate.label,
        executable: executablePath ?? candidate.executable,
        detected: Boolean(executablePath)
      }
    })
  )
}

export async function generateCommitMessage(
  runner: CommandRunner,
  request: CommitMessageGenerationRequest
): Promise<GeneratedCommitMessage> {
  const rootPath = await resolveRepositoryRoot(runner, request.repoPath)
  const hasStagedChanges = await runner.run('/usr/bin/git', ['diff', '--cached', '--quiet'], {
    cwd: rootPath,
    allowedExitCodes: [0, 1]
  })

  if (hasStagedChanges.exitCode === 0) {
    throw new BranchPilotUserError('nothing_staged', 'Stage changes before generating a commit message.')
  }

  const diff = await runner.run('/usr/bin/git', ['diff', '--cached', '--no-ext-diff'], {
    cwd: rootPath,
    allowedExitCodes: [0, 1],
    timeoutMs: 30_000
  })
  const status = await runner.run('/usr/bin/git', ['status', '--short'], {
    cwd: rootPath,
    timeoutMs: 10_000
  })
  const branch = await runner.run('/usr/bin/git', ['branch', '--show-current'], {
    cwd: rootPath,
    allowedExitCodes: [0, 1],
    timeoutMs: 10_000
  })
  const truncatedDiff = truncateText(diff.stdout, MAX_ASSISTANT_DIFF_BYTES)
  const assistant = await resolveAssistant(runner, request.assistant)
  const prompt = buildCommitPrompt({
    branch: branch.stdout.trim() || 'Detached HEAD',
    status: status.stdout.trim(),
    diff: truncatedDiff.text,
    truncated: truncatedDiff.truncated
  })
  const output = await runAssistant(runner, assistant, prompt)
  const parsed = parseGeneratedText(output, 'commit title')

  return {
    title: parsed.title,
    description: parsed.description,
    assistant: assistant.id,
    truncated: truncatedDiff.truncated
  }
}

export async function generatePullRequestText(
  runner: CommandRunner,
  request: PullRequestTextGenerationRequest
): Promise<GeneratedPullRequestText> {
  const rootPath = await resolveRepositoryRoot(runner, request.repoPath)
  const headBranch = await getCurrentBranch(runner, rootPath)
  const base = request.baseBranch
    ? await resolveBaseRef(runner, rootPath, normalizeBranchName(request.baseBranch, 'Base branch'))
    : await resolveDefaultBaseRef(runner, rootPath)
  const commits = await runner.run('/usr/bin/git', [
    'log',
    '--max-count=50',
    '--pretty=format:%h%x00%s%x00%an',
    `${base.baseRef}..HEAD`
  ], {
    cwd: rootPath,
    allowedExitCodes: [0, 128],
    timeoutMs: 30_000
  })
  const diff = await runner.run('/usr/bin/git', ['diff', '--no-ext-diff', `${base.baseRef}...HEAD`], {
    cwd: rootPath,
    allowedExitCodes: [0, 1],
    timeoutMs: 30_000
  })

  if (!commits.stdout.trim() && !diff.stdout.trim()) {
    throw new BranchPilotUserError('no_pr_changes', 'No branch changes found for pull request generation.')
  }

  const truncatedDiff = truncateText(diff.stdout, MAX_ASSISTANT_PR_DIFF_BYTES)
  const assistant = await resolveAssistant(runner, request.assistant)
  const prompt = buildPullRequestPrompt({
    baseBranch: base.baseBranch,
    headBranch,
    commits: commits.stdout,
    diff: truncatedDiff.text,
    truncated: truncatedDiff.truncated
  })
  const output = await runAssistant(runner, assistant, prompt)
  const parsed = parseGeneratedText(output, 'pull request title')

  return {
    title: parsed.title,
    description: parsed.description,
    assistant: assistant.id,
    truncated: truncatedDiff.truncated,
    baseBranch: base.baseBranch,
    headBranch,
    commitCount: commits.stdout.trim() ? commits.stdout.trim().split('\n').length : 0
  }
}

async function resolveRepositoryRoot(runner: CommandRunner, repoPath: string): Promise<string> {
  const result = await runner.run('/usr/bin/git', ['rev-parse', '--show-toplevel'], {
    cwd: repoPath,
    timeoutMs: 10_000
  })

  return result.stdout.trim()
}

async function getCurrentBranch(runner: CommandRunner, rootPath: string): Promise<string> {
  const result = await runner.run('/usr/bin/git', ['branch', '--show-current'], {
    cwd: rootPath,
    allowedExitCodes: [0, 1],
    timeoutMs: 10_000
  })
  const branch = result.stdout.trim()

  if (!branch) {
    throw new BranchPilotUserError('git_detached_head', 'Cannot generate pull request text from a detached HEAD.')
  }

  return branch
}

async function resolveDefaultBaseRef(
  runner: CommandRunner,
  rootPath: string
): Promise<{ baseBranch: string; baseRef: string }> {
  const originHead = await runner.run('/usr/bin/git', ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'], {
    cwd: rootPath,
    allowedExitCodes: [0, 1],
    timeoutMs: 10_000
  })
  const originHeadRef = originHead.stdout.trim()

  if (originHead.exitCode === 0 && originHeadRef) {
    return {
      baseBranch: originHeadRef.replace(/^origin\//, ''),
      baseRef: originHeadRef
    }
  }

  return resolveBaseRef(runner, rootPath, 'main')
}

async function resolveBaseRef(
  runner: CommandRunner,
  rootPath: string,
  baseBranch: string
): Promise<{ baseBranch: string; baseRef: string }> {
  const normalizedBase = normalizeBranchName(baseBranch, 'Base branch').replace(/^origin\//, '')
  const remoteRef = `origin/${normalizedBase}`

  if (await refExists(runner, rootPath, remoteRef)) {
    return {
      baseBranch: normalizedBase,
      baseRef: remoteRef
    }
  }

  if (await refExists(runner, rootPath, normalizedBase)) {
    return {
      baseBranch: normalizedBase,
      baseRef: normalizedBase
    }
  }

  throw new BranchPilotUserError('invalid_base_branch', `Base branch "${normalizedBase}" was not found locally.`)
}

async function refExists(runner: CommandRunner, rootPath: string, ref: string): Promise<boolean> {
  const result = await runner.run('/usr/bin/git', ['rev-parse', '--verify', '--quiet', ref], {
    cwd: rootPath,
    allowedExitCodes: [0, 1],
    timeoutMs: 10_000
  })

  return result.exitCode === 0
}

async function resolveAssistant(runner: CommandRunner, requestedAssistant: AssistantId): Promise<ResolvedAssistantRunner> {
  const candidates = requestedAssistant === 'auto'
    ? ASSISTANT_RUNNERS
    : ASSISTANT_RUNNERS.filter((candidate) => candidate.id === requestedAssistant)

  for (const candidate of candidates) {
    const executablePath = await resolveExecutablePath(runner, candidate.executable)

    if (executablePath) {
      return {
        ...candidate,
        executablePath
      }
    }
  }

  const label = requestedAssistant === 'auto'
    ? 'Claude Code or Codex'
    : ASSISTANT_RUNNERS.find((candidate) => candidate.id === requestedAssistant)?.label ?? requestedAssistant

  throw new BranchPilotUserError('assistant_not_found', `${label} CLI is not available on PATH.`)
}

async function resolveExecutablePath(runner: CommandRunner, executable: string): Promise<string | undefined> {
  try {
    const result = await runner.run('/usr/bin/which', [executable], {
      timeoutMs: 5_000
    })
    return result.stdout.trim() || executable
  } catch {
    return undefined
  }
}

async function runAssistant(
  runner: CommandRunner,
  assistant: ResolvedAssistantRunner,
  prompt: string
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
        ''
      ], {
        cwd: os.tmpdir(),
        input: prompt,
        timeoutMs: 120_000
      })

      return result.stdout
    }

    return await runCodex(runner, assistant.executablePath, prompt)
  } catch (error) {
    if (error instanceof BranchPilotUserError) {
      throw error
    }

    if (error instanceof CommandExecutionError) {
      throw new BranchPilotUserError(
        'assistant_failed',
        `${assistant.label} failed to generate a commit message.`,
        [error.result.stderr, error.result.stdout].filter(Boolean).join('\n')
      )
    }

    throw error
  }
}

async function runCodex(runner: CommandRunner, executablePath: string, prompt: string): Promise<string> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'branchpilot-assistant-'))
  const schemaPath = path.join(tempDir, 'commit-message.schema.json')

  try {
    await fs.writeFile(schemaPath, JSON.stringify(GENERATED_TEXT_SCHEMA), 'utf8')
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

function buildPullRequestPrompt(context: {
  baseBranch: string
  headBranch: string
  commits: string
  diff: string
  truncated: boolean
}): string {
  return [
    'Generate a pull request title and description for the branch diff below.',
    'Use only the provided commits and branch diff. Do not infer from unstaged files.',
    'Return JSON only with this shape: {"title":"...","description":"..."}',
    'Rules:',
    '- title is required, concise, and suitable for a GitHub pull request;',
    '- description should summarize changes, testing, and risk when visible from the context;',
    '- do not wrap the JSON in markdown fences;',
    '- do not mention that you are an AI assistant.',
    '',
    `Base branch: ${context.baseBranch}`,
    `Head branch: ${context.headBranch}`,
    `Diff truncated: ${context.truncated ? 'yes' : 'no'}`,
    '',
    'Branch commits:',
    context.commits || '(none)',
    '',
    'Branch diff:',
    context.diff
  ].join('\n')
}

function buildCommitPrompt(context: { branch: string; status: string; diff: string; truncated: boolean }): string {
  return [
    'Generate a Git commit message for the staged diff below.',
    'Use only the provided staged diff and status. Do not infer from unstaged files.',
    'Return JSON only with this shape: {"title":"...","description":"..."}',
    'Rules:',
    '- title is required, imperative mood, 72 characters or less when practical;',
    '- description is optional, concise, and should explain why the change matters;',
    '- do not wrap the JSON in markdown fences;',
    '- do not mention that you are an AI assistant.',
    '',
    `Branch: ${context.branch}`,
    `Diff truncated: ${context.truncated ? 'yes' : 'no'}`,
    '',
    'Staged status:',
    context.status || '(none)',
    '',
    'Staged diff:',
    context.diff
  ].join('\n')
}

function truncateText(text: string, maxBytes: number): { text: string; truncated: boolean } {
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) {
    return { text, truncated: false }
  }

  return {
    text: Buffer.from(text, 'utf8').subarray(0, maxBytes).toString('utf8'),
    truncated: true
  }
}

function parseGeneratedText(output: string, titleLabel: string): { title: string; description: string } {
  const parsed = parseJsonLike(output)
  const candidate = normalizeAssistantPayload(parsed)
  const title = typeof candidate?.title === 'string' ? candidate.title.trim() : ''
  const description = typeof candidate?.description === 'string' ? candidate.description.trim() : ''

  if (!title) {
    throw new BranchPilotUserError(
      'assistant_parse_failed',
      `Assistant did not return a valid ${titleLabel}.`,
      output.slice(0, 2_000)
    )
  }

  return {
    title,
    description
  }
}

function normalizeBranchName(branchName: string, label: string): string {
  const trimmed = branchName.trim()

  if (!trimmed || trimmed.startsWith('-') || trimmed.includes('\0')) {
    throw new BranchPilotUserError('invalid_branch', `${label} is invalid.`)
  }

  return trimmed
}

function normalizeAssistantPayload(parsed: Record<string, unknown>): Record<string, unknown> {
  if (typeof parsed.result === 'string') {
    return parseJsonLike(parsed.result)
  }

  if (parsed.result && typeof parsed.result === 'object' && !Array.isArray(parsed.result)) {
    return parsed.result as Record<string, unknown>
  }

  return parsed
}

function parseJsonLike(output: string): Record<string, unknown> {
  const trimmed = output.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
  const direct = tryParseJson(trimmed)

  if (direct) {
    return direct
  }

  const firstBrace = trimmed.indexOf('{')
  const lastBrace = trimmed.lastIndexOf('}')

  if (firstBrace >= 0 && lastBrace > firstBrace) {
    const extracted = tryParseJson(trimmed.slice(firstBrace, lastBrace + 1))

    if (extracted) {
      return extracted
    }
  }

  throw new BranchPilotUserError(
    'assistant_parse_failed',
    'Assistant did not return valid JSON.',
    output.slice(0, 2_000)
  )
}

function tryParseJson(value: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(value) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined
  } catch {
    return undefined
  }
}
