import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type {
  AssistantId,
  AssistantStatus,
  BranchDescriptionGenerationRequest,
  BranchDraftGenerationRequest,
  CommitMessageGenerationRequest,
  GeneratedBranchDescription,
  GeneratedBranchDraft,
  GeneratedCommitMessage,
  GeneratedPullRequestText,
  InstalledAssistantId,
  PullRequestTextGenerationRequest,
  ReviewFinding,
  ReviewMode,
  ReviewReport,
  ReviewReportRequest,
  ReviewScope,
  ReviewSeverity
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
const MAX_ASSISTANT_BRANCH_CONTEXT_BYTES = 100_000
const MAX_ASSISTANT_PR_DIFF_BYTES = 120_000
const MAX_ASSISTANT_REVIEW_DIFF_BYTES = 120_000

const GENERATED_TEXT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'description'],
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

const BRANCH_DRAFT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['branchName', 'description'],
  properties: {
    branchName: {
      type: 'string',
      minLength: 1
    },
    description: {
      type: 'string'
    }
  }
}

const BRANCH_DESCRIPTION_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['description'],
  properties: {
    description: {
      type: 'string',
      minLength: 1
    }
  }
}

const REVIEW_REPORT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'findings'],
  properties: {
    summary: {
      type: 'string'
    },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['severity', 'title', 'details', 'filePath', 'line', 'recommendation'],
        properties: {
          severity: {
            type: 'string',
            enum: ['critical', 'high', 'medium', 'low', 'info']
          },
          title: {
            type: 'string'
          },
          details: {
            type: 'string'
          },
          filePath: {
            type: ['string', 'null']
          },
          line: {
            type: ['number', 'null']
          },
          recommendation: {
            type: ['string', 'null']
          }
        }
      }
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
        detected: Boolean(executablePath),
        state: executablePath ? 'detected' : 'missing',
        message: executablePath
          ? `${candidate.label} CLI was found on PATH. Run a health check to verify access.`
          : `${candidate.label} CLI was not found on PATH.`
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
          message: `${candidate.label} CLI was not found on PATH.`,
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
  const prompt = buildCommitPrompt({
    branch: branch.stdout.trim() || 'Detached HEAD',
    status: status.stdout.trim(),
    diff: truncatedDiff.text,
    truncated: truncatedDiff.truncated
  })
  const { assistant, output } = await runAssistantForRequest(runner, request.assistant, prompt)
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
  const prompt = buildPullRequestPrompt({
    baseBranch: base.baseBranch,
    headBranch,
    commits: commits.stdout,
    diff: truncatedDiff.text,
    truncated: truncatedDiff.truncated
  })
  const { assistant, output } = await runAssistantForRequest(runner, request.assistant, prompt)
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

export async function generateBranchDraft(
  runner: CommandRunner,
  request: BranchDraftGenerationRequest
): Promise<GeneratedBranchDraft> {
  const rootPath = await resolveRepositoryRoot(runner, request.repoPath)
  const currentBranch = await getBranchLabel(runner, rootPath)
  const status = await runner.run('/usr/bin/git', ['status', '--short'], {
    cwd: rootPath,
    timeoutMs: 10_000
  })
  const stagedDiff = await runner.run('/usr/bin/git', ['diff', '--cached', '--no-ext-diff'], {
    cwd: rootPath,
    allowedExitCodes: [0, 1],
    timeoutMs: 30_000
  })
  const unstagedDiff = await runner.run('/usr/bin/git', ['diff', '--no-ext-diff'], {
    cwd: rootPath,
    allowedExitCodes: [0, 1],
    timeoutMs: 30_000
  })
  const recentCommits = await runner.run('/usr/bin/git', [
    'log',
    '--max-count=8',
    '--pretty=format:%h%x00%s%x00%an'
  ], {
    cwd: rootPath,
    allowedExitCodes: [0, 128],
    timeoutMs: 30_000
  })
  const goal = request.goal?.trim() ?? ''

  if (!goal && !status.stdout.trim() && !stagedDiff.stdout.trim() && !unstagedDiff.stdout.trim()) {
    throw new BranchPilotUserError(
      'no_branch_context',
      'Add a branch goal or create local changes before generating a branch draft.'
    )
  }

  const context = truncateText([
    'Staged diff:',
    stagedDiff.stdout || '(none)',
    '',
    'Unstaged diff:',
    unstagedDiff.stdout || '(none)'
  ].join('\n'), MAX_ASSISTANT_BRANCH_CONTEXT_BYTES)
  const prompt = buildBranchDraftPrompt({
    goal,
    currentBranch,
    status: status.stdout,
    recentCommits: recentCommits.stdout,
    diffContext: context.text,
    truncated: context.truncated
  })
  const { assistant, output } = await runAssistantForRequest(runner, request.assistant, prompt, BRANCH_DRAFT_SCHEMA)
  const parsed = parseBranchDraft(output)
  const branchName = await validateGeneratedBranchName(runner, rootPath, parsed.branchName)

  return {
    branchName,
    description: parsed.description,
    assistant: assistant.id,
    truncated: context.truncated
  }
}

export async function generateBranchDescription(
  runner: CommandRunner,
  request: BranchDescriptionGenerationRequest
): Promise<GeneratedBranchDescription> {
  const rootPath = await resolveRepositoryRoot(runner, request.repoPath)
  const branchName = normalizeBranchName(request.branchName, 'Branch name')

  if (!await refExists(runner, rootPath, `refs/heads/${branchName}`)) {
    throw new BranchPilotUserError('invalid_branch', 'Local branch was not found.')
  }

  const currentBranch = await getBranchLabel(runner, rootPath)
  const currentDescription = await runner.run('/usr/bin/git', ['config', '--get', `branch.${branchName}.description`], {
    cwd: rootPath,
    allowedExitCodes: [0, 1],
    timeoutMs: 10_000
  })
  const recentCommits = await runner.run('/usr/bin/git', [
    'log',
    '--max-count=12',
    '--pretty=format:%h%x00%s%x00%an',
    branchName
  ], {
    cwd: rootPath,
    allowedExitCodes: [0, 128],
    timeoutMs: 30_000
  })
  let status = ''
  let diffContext = ''
  let truncated = false

  if (currentBranch === branchName) {
    const statusResult = await runner.run('/usr/bin/git', ['status', '--short'], {
      cwd: rootPath,
      timeoutMs: 10_000
    })
    const stagedDiff = await runner.run('/usr/bin/git', ['diff', '--cached', '--no-ext-diff'], {
      cwd: rootPath,
      allowedExitCodes: [0, 1],
      timeoutMs: 30_000
    })
    const unstagedDiff = await runner.run('/usr/bin/git', ['diff', '--no-ext-diff'], {
      cwd: rootPath,
      allowedExitCodes: [0, 1],
      timeoutMs: 30_000
    })
    const context = truncateText([
      'Staged diff:',
      stagedDiff.stdout || '(none)',
      '',
      'Unstaged diff:',
      unstagedDiff.stdout || '(none)'
    ].join('\n'), MAX_ASSISTANT_BRANCH_CONTEXT_BYTES)

    status = statusResult.stdout
    diffContext = context.text
    truncated = context.truncated
  }

  if (!recentCommits.stdout.trim() && !status.trim() && !diffContext.trim()) {
    throw new BranchPilotUserError(
      'no_branch_context',
      'No branch commits or local changes found for description generation.'
    )
  }

  const prompt = buildBranchDescriptionPrompt({
    branchName,
    currentBranch,
    currentDescription: currentDescription.stdout,
    recentCommits: recentCommits.stdout,
    status,
    diffContext,
    truncated
  })
  const { assistant, output } = await runAssistantForRequest(runner, request.assistant, prompt, BRANCH_DESCRIPTION_SCHEMA)
  const description = parseBranchDescription(output)

  return {
    branchName,
    description,
    assistant: assistant.id,
    truncated
  }
}

export async function generateReviewReport(
  runner: CommandRunner,
  request: ReviewReportRequest
): Promise<ReviewReport> {
  const rootPath = await resolveRepositoryRoot(runner, request.repoPath)
  const context = await buildReviewContext(runner, rootPath, request.scope)

  if (!context.diff.trim()) {
    throw new BranchPilotUserError('no_review_changes', `No ${request.scope} changes found to review.`)
  }

  const prompt = buildReviewPrompt({
    mode: request.mode,
    scope: request.scope,
    branch: context.branch,
    baseBranch: context.baseBranch,
    status: context.status,
    commits: context.commits,
    diff: context.diff,
    truncated: context.truncated
  })
  const { assistant, output } = await runAssistantForRequest(runner, request.assistant, prompt, REVIEW_REPORT_SCHEMA)
  const parsed = parseReviewReport(output)

  return {
    summary: parsed.summary,
    findings: parsed.findings,
    mode: request.mode,
    scope: request.scope,
    assistant: assistant.id,
    truncated: context.truncated
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

async function getBranchLabel(runner: CommandRunner, rootPath: string): Promise<string> {
  const result = await runner.run('/usr/bin/git', ['branch', '--show-current'], {
    cwd: rootPath,
    allowedExitCodes: [0, 1],
    timeoutMs: 10_000
  })

  return result.stdout.trim() || 'Detached HEAD'
}

async function buildReviewContext(
  runner: CommandRunner,
  rootPath: string,
  scope: ReviewScope
): Promise<{
  branch: string
  baseBranch?: string
  status: string
  commits: string
  diff: string
  truncated: boolean
}> {
  const branch = await getBranchLabel(runner, rootPath)
  const status = await runner.run('/usr/bin/git', ['status', '--short'], {
    cwd: rootPath,
    timeoutMs: 10_000
  })
  const recentCommits = await runner.run('/usr/bin/git', [
    'log',
    '--max-count=5',
    '--pretty=format:%h%x00%s%x00%an'
  ], {
    cwd: rootPath,
    allowedExitCodes: [0, 128],
    timeoutMs: 30_000
  })

  if (scope === 'staged') {
    const diff = await runner.run('/usr/bin/git', ['diff', '--cached', '--no-ext-diff'], {
      cwd: rootPath,
      allowedExitCodes: [0, 1],
      timeoutMs: 30_000
    })
    const truncated = truncateText(diff.stdout, MAX_ASSISTANT_REVIEW_DIFF_BYTES)

    return {
      branch,
      status: status.stdout,
      commits: recentCommits.stdout,
      diff: truncated.text,
      truncated: truncated.truncated
    }
  }

  if (scope === 'unstaged') {
    const diff = await runner.run('/usr/bin/git', ['diff', '--no-ext-diff'], {
      cwd: rootPath,
      allowedExitCodes: [0, 1],
      timeoutMs: 30_000
    })
    const truncated = truncateText(diff.stdout, MAX_ASSISTANT_REVIEW_DIFF_BYTES)

    return {
      branch,
      status: status.stdout,
      commits: recentCommits.stdout,
      diff: truncated.text,
      truncated: truncated.truncated
    }
  }

  const base = await resolveDefaultBaseRef(runner, rootPath)
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
  const truncated = truncateText(diff.stdout, MAX_ASSISTANT_REVIEW_DIFF_BYTES)

  return {
    branch,
    baseBranch: base.baseBranch,
    status: status.stdout,
    commits: commits.stdout,
    diff: truncated.text,
    truncated: truncated.truncated
  }
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

async function resolveAssistantCandidates(runner: CommandRunner, requestedAssistant: AssistantId): Promise<ResolvedAssistantRunner[]> {
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

  throw new BranchPilotUserError('assistant_not_found', `${label} CLI is not available on PATH.`)
}

async function runAssistantForRequest(
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
        ''
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

function assistantHealthErrorMessage(error: unknown): string {
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

function summarizeAssistantFailure(output: string): string {
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

async function runCodex(
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

function buildReviewPrompt(context: {
  mode: ReviewMode
  scope: ReviewScope
  branch: string
  baseBranch?: string
  status: string
  commits: string
  diff: string
  truncated: boolean
}): string {
  return [
    `Run a ${reviewModeLabel(context.mode)} review for the ${context.scope} changes below.`,
    'Use only the provided Git context. This is report-only: do not suggest applying changes automatically.',
    'Return JSON only with this shape: {"summary":"...","findings":[{"severity":"medium","title":"...","details":"...","filePath":"optional","line":1,"recommendation":"optional"}]}',
    'Rules:',
    '- severity must be one of critical, high, medium, low, info;',
    '- include only actionable findings; use an empty findings array when there are no issues;',
    '- do not wrap the JSON in markdown fences;',
    '- do not mention that you are an AI assistant.',
    '',
    'Review focus:',
    reviewFocus(context.mode),
    '',
    `Branch: ${context.branch}`,
    context.baseBranch ? `Base branch: ${context.baseBranch}` : 'Base branch: n/a',
    `Diff truncated: ${context.truncated ? 'yes' : 'no'}`,
    '',
    'Git status:',
    context.status || '(clean)',
    '',
    'Relevant commits:',
    context.commits || '(none)',
    '',
    'Diff:',
    context.diff
  ].join('\n')
}

function reviewModeLabel(mode: ReviewMode): string {
  if (mode === 'security') return 'security'
  if (mode === 'quality') return 'change quality'
  return 'consistency'
}

function reviewFocus(mode: ReviewMode): string {
  if (mode === 'security') {
    return 'Look for secrets, token leakage, unsafe shell/process execution, auth risks, destructive operations, and permission expansion.'
  }

  if (mode === 'quality') {
    return 'Look for likely bugs, edge cases, regressions, confusing behavior, compatibility issues, and missing validation.'
  }

  return 'Look for architecture boundary issues, naming problems, duplicated logic, missing tests, unrelated changes, and risky refactors.'
}

function buildBranchDraftPrompt(context: {
  goal: string
  currentBranch: string
  status: string
  recentCommits: string
  diffContext: string
  truncated: boolean
}): string {
  return [
    'Generate a Git branch name and branch description for the work below.',
    'Use only the provided intent, Git status, commits, and diffs.',
    'Return JSON only with this shape: {"branchName":"feature/...","description":"..."}',
    'Rules:',
    '- branchName is required, lower-case, slash/kebab-case, and safe for git check-ref-format --branch;',
    '- use a prefix such as feature/, fix/, chore/, docs/, test/, or refactor/;',
    '- description is required, concise, and should explain the intent of the branch;',
    '- do not include spaces, quotes, markdown, or a remote prefix in branchName;',
    '- do not wrap the JSON in markdown fences;',
    '- do not mention that you are an AI assistant.',
    '',
    `Current branch: ${context.currentBranch}`,
    `Diff truncated: ${context.truncated ? 'yes' : 'no'}`,
    '',
    'User intent:',
    context.goal || '(none)',
    '',
    'Git status:',
    context.status || '(clean)',
    '',
    'Recent commits:',
    context.recentCommits || '(none)',
    '',
    context.diffContext
  ].join('\n')
}

function buildBranchDescriptionPrompt(context: {
  branchName: string
  currentBranch: string
  currentDescription: string
  recentCommits: string
  status: string
  diffContext: string
  truncated: boolean
}): string {
  return [
    'Generate a concise local Git branch description for the branch below.',
    'Use only the provided branch name, current description, commits, status, and diffs.',
    'Return JSON only with this shape: {"description":"..."}',
    'Rules:',
    '- description is required and should explain the purpose of the branch;',
    '- keep it useful as local Git branch metadata, not a pull request body;',
    '- do not mention that you are an AI assistant;',
    '- do not wrap the JSON in markdown fences.',
    '',
    `Branch: ${context.branchName}`,
    `Current checked-out branch: ${context.currentBranch}`,
    `Diff truncated: ${context.truncated ? 'yes' : 'no'}`,
    '',
    'Current description:',
    context.currentDescription.trim() || '(none)',
    '',
    'Recent commits:',
    context.recentCommits || '(none)',
    '',
    'Git status:',
    context.status || '(not checked out)',
    '',
    context.diffContext || 'Diff context: (not checked out)'
  ].join('\n')
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

function parseBranchDraft(output: string): { branchName: string; description: string } {
  const parsed = parseJsonLike(output)
  const candidate = normalizeAssistantPayload(parsed)
  const branchName = typeof candidate?.branchName === 'string' ? candidate.branchName.trim() : ''
  const description = typeof candidate?.description === 'string' ? candidate.description.trim() : ''

  if (!branchName) {
    throw new BranchPilotUserError(
      'assistant_parse_failed',
      'Assistant did not return a valid branch name.',
      output.slice(0, 2_000)
    )
  }

  return {
    branchName: normalizeBranchName(branchName, 'Branch name'),
    description
  }
}

function parseBranchDescription(output: string): string {
  const parsed = parseJsonLike(output)
  const candidate = normalizeAssistantPayload(parsed)
  const description = typeof candidate?.description === 'string' ? candidate.description.trim() : ''

  if (!description) {
    throw new BranchPilotUserError(
      'assistant_parse_failed',
      'Assistant did not return a valid branch description.',
      output.slice(0, 2_000)
    )
  }

  return description
}

async function validateGeneratedBranchName(
  runner: CommandRunner,
  rootPath: string,
  branchName: string
): Promise<string> {
  const result = await runner.run('/usr/bin/git', ['check-ref-format', '--branch', branchName], {
    cwd: rootPath,
    allowedExitCodes: [0, 1, 128],
    timeoutMs: 10_000
  })

  if (result.exitCode !== 0) {
    throw new BranchPilotUserError(
      'assistant_parse_failed',
      'Assistant returned an invalid branch name.',
      result.stderr || branchName
    )
  }

  return result.stdout.trim() || branchName
}

function parseReviewReport(output: string): { summary: string; findings: ReviewFinding[] } {
  const parsed = normalizeAssistantPayload(parseJsonLike(output))
  const summary = typeof parsed.summary === 'string' ? parsed.summary.trim() : ''
  const rawFindings = Array.isArray(parsed.findings) ? parsed.findings : []

  if (!summary) {
    throw new BranchPilotUserError(
      'assistant_parse_failed',
      'Assistant did not return a valid review summary.',
      output.slice(0, 2_000)
    )
  }

  return {
    summary,
    findings: rawFindings
      .map(normalizeReviewFinding)
      .filter((finding): finding is ReviewFinding => Boolean(finding))
  }
}

function normalizeReviewFinding(value: unknown): ReviewFinding | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }

  const candidate = value as Record<string, unknown>
  const severity = normalizeSeverity(candidate.severity)
  const title = typeof candidate.title === 'string' ? candidate.title.trim() : ''
  const details = typeof candidate.details === 'string' ? candidate.details.trim() : ''

  if (!severity || !title || !details) {
    return undefined
  }

  return {
    severity,
    title,
    details,
    filePath: typeof candidate.filePath === 'string' && candidate.filePath.trim() ? candidate.filePath.trim() : undefined,
    line: typeof candidate.line === 'number' && Number.isFinite(candidate.line) ? candidate.line : undefined,
    recommendation: typeof candidate.recommendation === 'string' && candidate.recommendation.trim()
      ? candidate.recommendation.trim()
      : undefined
  }
}

function normalizeSeverity(value: unknown): ReviewSeverity | undefined {
  if (value === 'critical' || value === 'high' || value === 'medium' || value === 'low' || value === 'info') {
    return value
  }

  return undefined
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
