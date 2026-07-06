import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type {
  AssistantStatus,
  BeautifiedFile,
  BranchDescriptionGenerationRequest,
  BranchDraftGenerationRequest,
  CodexAgentEvent,
  CodexAgentRequest,
  CodexAgentResult,
  CommitMessageGenerationRequest,
  FileBeautifyRequest,
  GeneratedBranchDescription,
  GeneratedBranchDraft,
  GeneratedCommitMessage,
  GeneratedLinkedInProject,
  GeneratedRepositoryStarter,
  GeneratedPullRequestText,
  LinkedInProjectGenerationRequest,
  PullRequestTextGenerationRequest,
  RepositoryStarterGenerationRequest,
  ReviewReport,
  ReviewReportRequest,
} from '../../src/shared/branchPilot.js'
import { CommandRunner } from '../lib/commandRunner.js'
import { BranchPilotUserError } from '../lib/errors.js'
import { GIT_EXECUTABLE } from '../lib/platformExecutables.js'
import {
  BRANCH_DESCRIPTION_SCHEMA, BRANCH_DRAFT_SCHEMA, FILE_BEAUTIFY_SCHEMA, GENERATED_TEXT_SCHEMA, LINKEDIN_PROJECT_SCHEMA, MAX_ASSISTANT_BEAUTIFY_BYTES, MAX_ASSISTANT_BRANCH_CONTEXT_BYTES, MAX_ASSISTANT_DIFF_BYTES, MAX_ASSISTANT_LINKEDIN_CONTEXT_BYTES, MAX_ASSISTANT_PR_DIFF_BYTES, MAX_ASSISTANT_STARTER_CONTEXT_BYTES, REPOSITORY_STARTER_SCHEMA, REVIEW_REPORT_SCHEMA
} from './assistantRunner.schemas.js'
import {
  buildBranchDescriptionPrompt, buildBranchDraftPrompt, buildCommitPrompt, buildFileBeautifyPrompt, buildLinkedInProjectPrompt, buildPullRequestPrompt, buildRepositoryStarterPrompt, buildReviewPrompt, truncateText
} from './assistantRunner.prompts.js'
import {
  normalizeBranchName, parseBeautifiedFile, parseBranchDescription, parseBranchDraft, parseGeneratedText, parseLinkedInProject, parseRepositoryStarter, parseReviewReport
} from './assistantRunner.parsers.js'
import {
  ASSISTANT_RUNNERS
} from './assistantRunner.runners.js'
import {
  buildReviewContext,
  getBranchLabel,
  getCurrentBranch,
  readFirstExistingFile,
  readOptionalFile,
  refExists,
  resolveBaseRef,
  resolveDefaultBaseRef,
  resolveRepositoryRoot
} from './assistantRunner.context.js'
import {
  assistantHealthErrorMessage,
  resolveExecutablePath,
  runAssistant,
  runAssistantForRequest,
  runClaudeAgentExec,
  runCodexAgentExec,
  resolveAssistantCandidates
} from './assistantRunner.exec.js'

const MAX_CODEX_AGENT_FILE_BYTES = 120_000
const MAX_CODEX_AGENT_PROMPT_BYTES = 180_000
const MAX_CODEX_AGENT_IMAGES = 6
const MAX_CODEX_AGENT_IMAGE_BYTES = 8 * 1024 * 1024


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

export async function generateCommitMessage(
  runner: CommandRunner,
  request: CommitMessageGenerationRequest
): Promise<GeneratedCommitMessage> {
  const rootPath = await resolveRepositoryRoot(runner, request.repoPath)
  const hasStagedChanges = await runner.run(GIT_EXECUTABLE, ['diff', '--cached', '--quiet'], {
    cwd: rootPath,
    allowedExitCodes: [0, 1]
  })

  if (hasStagedChanges.exitCode === 0) {
    throw new BranchPilotUserError('nothing_staged', 'Stage changes before generating a commit message.')
  }

  const diff = await runner.run(GIT_EXECUTABLE, ['diff', '--cached', '--no-ext-diff'], {
    cwd: rootPath,
    allowedExitCodes: [0, 1],
    timeoutMs: 30_000
  })
  const status = await runner.run(GIT_EXECUTABLE, ['status', '--short'], {
    cwd: rootPath,
    timeoutMs: 10_000
  })
  const branch = await runner.run(GIT_EXECUTABLE, ['branch', '--show-current'], {
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
  const commits = await runner.run(GIT_EXECUTABLE, [
    'log',
    '--max-count=50',
    '--pretty=format:%h%x00%s%x00%an',
    `${base.baseRef}..HEAD`
  ], {
    cwd: rootPath,
    allowedExitCodes: [0, 128],
    timeoutMs: 30_000
  })
  const diff = await runner.run(GIT_EXECUTABLE, ['diff', '--no-ext-diff', `${base.baseRef}...HEAD`], {
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

export async function beautifyFileWithAssistant(
  runner: CommandRunner,
  request: FileBeautifyRequest
): Promise<BeautifiedFile> {
  await resolveRepositoryRoot(runner, request.repoPath)
  const textBytes = Buffer.byteLength(request.text, 'utf8')

  if (textBytes > MAX_ASSISTANT_BEAUTIFY_BYTES) {
    throw new BranchPilotUserError(
      'assistant_input_too_large',
      'File is too large for AI beautify.',
      'Use local Beautify or format a smaller file section.'
    )
  }

  const prompt = buildFileBeautifyPrompt({
    filePath: request.filePath,
    content: request.text
  })
  const { assistant, output } = await runAssistantForRequest(runner, request.assistant, prompt, FILE_BEAUTIFY_SCHEMA)

  return {
    content: parseBeautifiedFile(output),
    assistant: assistant.id,
    truncated: false
  }
}

export async function runCodexAgent(
  runner: CommandRunner,
  request: CodexAgentRequest
): Promise<CodexAgentResult> {
  const rootPath = await resolveRepositoryRoot(runner, request.repoPath)
  const promptText = request.prompt.trim()

  if (!promptText && !request.filePath && (request.images?.length ?? 0) === 0) {
    throw new BranchPilotUserError('local_agent_prompt_required', 'Enter a prompt, select a file, or attach an image.')
  }

  const assistantBase = request.assistant.startsWith('claude') ? 'claude' : 'codex'
  const requestedAssistant = request.assistant.startsWith('claude') || request.assistant.startsWith('codex')
    ? request.assistant
    : 'codex'
  const assistant = (await resolveAssistantCandidates(runner, requestedAssistant)).find((candidate) => candidate.id === assistantBase)

  if (!assistant) {
    throw new BranchPilotUserError(
      'assistant_not_found',
      assistantBase === 'claude'
        ? 'Claude Code is required for the Claude agent panel.'
        : 'Codex CLI is required for the Codex agent panel.'
    )
  }

  const branch = await getBranchLabel(runner, rootPath)
  const status = await runner.run(GIT_EXECUTABLE, ['status', '--short'], {
    cwd: rootPath,
    timeoutMs: 10_000
  })
  const diffStat = await runner.run(GIT_EXECUTABLE, ['diff', '--stat'], {
    cwd: rootPath,
    allowedExitCodes: [0, 1],
    timeoutMs: 20_000
  })
  const images = await writeCodexAgentImages(request.images ?? [])
  const prompt = buildCodexAgentPrompt({
    assistant: assistant.id,
    branch,
    status: status.stdout,
    diffStat: diffStat.stdout,
    imagePaths: images.paths,
    request,
    prompt: promptText
  })
  const startedAt = Date.now()

  try {
    const result = assistant.id === 'claude'
      ? await runClaudeAgentExec(runner, assistant, {
          rootPath,
          prompt,
          imagePaths: images.paths,
          imageTempDir: images.tempDir,
          sandbox: request.sandbox,
          reasoning: request.reasoning
        })
      : await runCodexAgentExec(runner, assistant, {
          rootPath,
          prompt,
          imagePaths: images.paths,
          sandbox: request.sandbox,
          reasoning: request.reasoning
        })
    const events = parseCodexAgentEvents(result.eventLog)

    return {
      assistant: assistant.id,
      modelLabel: assistant.modelLabel,
      output: result.output || events.map((event) => event.text).filter(Boolean).slice(-3).join('\n\n'),
      events,
      sandbox: request.sandbox,
      reasoning: request.reasoning,
      imageCount: images.paths.length,
      durationMs: Date.now() - startedAt,
      generatedAt: new Date().toISOString()
    }
  } finally {
    await fs.rm(images.tempDir, { force: true, recursive: true })
  }
}

export async function generateBranchDraft(
  runner: CommandRunner,
  request: BranchDraftGenerationRequest
): Promise<GeneratedBranchDraft> {
  const rootPath = await resolveRepositoryRoot(runner, request.repoPath)
  const currentBranch = await getBranchLabel(runner, rootPath)
  const status = await runner.run(GIT_EXECUTABLE, ['status', '--short'], {
    cwd: rootPath,
    timeoutMs: 10_000
  })
  const stagedDiff = await runner.run(GIT_EXECUTABLE, ['diff', '--cached', '--no-ext-diff'], {
    cwd: rootPath,
    allowedExitCodes: [0, 1],
    timeoutMs: 30_000
  })
  const unstagedDiff = await runner.run(GIT_EXECUTABLE, ['diff', '--no-ext-diff'], {
    cwd: rootPath,
    allowedExitCodes: [0, 1],
    timeoutMs: 30_000
  })
  const recentCommits = await runner.run(GIT_EXECUTABLE, [
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
  const currentDescription = await runner.run(GIT_EXECUTABLE, ['config', '--get', `branch.${branchName}.description`], {
    cwd: rootPath,
    allowedExitCodes: [0, 1],
    timeoutMs: 10_000
  })
  const recentCommits = await runner.run(GIT_EXECUTABLE, [
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
    const statusResult = await runner.run(GIT_EXECUTABLE, ['status', '--short'], {
      cwd: rootPath,
      timeoutMs: 10_000
    })
    const stagedDiff = await runner.run(GIT_EXECUTABLE, ['diff', '--cached', '--no-ext-diff'], {
      cwd: rootPath,
      allowedExitCodes: [0, 1],
      timeoutMs: 30_000
    })
    const unstagedDiff = await runner.run(GIT_EXECUTABLE, ['diff', '--no-ext-diff'], {
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

export async function generateLinkedInProject(
  runner: CommandRunner,
  request: LinkedInProjectGenerationRequest
): Promise<GeneratedLinkedInProject> {
  const rootPath = await resolveRepositoryRoot(runner, request.repoPath)
  const repositoryName = path.basename(rootPath)
  const currentBranch = await getBranchLabel(runner, rootPath)
  const remote = await runner.run(GIT_EXECUTABLE, ['remote', 'get-url', 'origin'], {
    cwd: rootPath,
    allowedExitCodes: [0, 2],
    timeoutMs: 10_000
  })
  const status = await runner.run(GIT_EXECUTABLE, ['status', '--short'], {
    cwd: rootPath,
    timeoutMs: 10_000
  })
  const recentCommits = await runner.run(GIT_EXECUTABLE, [
    'log',
    '--max-count=25',
    '--date=format:%Y-%m',
    '--pretty=format:%h%x00%s%x00%an%x00%ad'
  ], {
    cwd: rootPath,
    allowedExitCodes: [0, 128],
    timeoutMs: 30_000
  })
  const commitDates = await runner.run(GIT_EXECUTABLE, [
    'log',
    '--reverse',
    '--date=format:%Y-%m',
    '--pretty=format:%ad'
  ], {
    cwd: rootPath,
    allowedExitCodes: [0, 128],
    timeoutMs: 30_000
  })
  const trackedFiles = await runner.run(GIT_EXECUTABLE, ['ls-files'], {
    cwd: rootPath,
    allowedExitCodes: [0],
    timeoutMs: 30_000
  })
  const packageJson = await readOptionalFile(path.join(rootPath, 'package.json'), 12_000)
  const readme = await readFirstExistingFile(rootPath, ['README.md', 'readme.md', 'README.txt'], 20_000)
  const dates = commitDates.stdout.split('\n').map((date) => date.trim()).filter(Boolean)
  const context = truncateText([
    `Repository: ${repositoryName}`,
    `Current branch: ${currentBranch}`,
    `Remote URL: ${remote.stdout.trim() || '(none)'}`,
    `Suggested project URL: ${request.projectUrl?.trim() || remote.stdout.trim() || '(none)'}`,
    `Preferred role: ${request.role?.trim() || '(infer from repository context)'}`,
    `Audience: ${request.audience?.trim() || 'LinkedIn project section'}`,
    `User generation preferences: ${request.customPrompt?.trim() || '(default BranchPilot LinkedIn project style)'}`,
    `Suggested date range: ${dates[0] ?? '(unknown start)'} to ${dates[dates.length - 1] ?? 'Present'}`,
    '',
    'Git status:',
    status.stdout || '(clean)',
    '',
    'Recent commits:',
    recentCommits.stdout || '(none)',
    '',
    'Tracked files:',
    trackedFiles.stdout.split('\n').slice(0, 240).join('\n') || '(none)',
    '',
    'package.json:',
    packageJson || '(not found)',
    '',
    'README:',
    readme || '(not found)'
  ].join('\n'), MAX_ASSISTANT_LINKEDIN_CONTEXT_BYTES)
  const prompt = buildLinkedInProjectPrompt({
    repositoryName,
    currentBranch,
    context: context.text,
    truncated: context.truncated,
    customPrompt: request.customPrompt
  })
  const { assistant, output } = await runAssistantForRequest(runner, request.assistant, prompt, LINKEDIN_PROJECT_SCHEMA)
  const parsed = parseLinkedInProject(output)

  return {
    ...parsed,
    assistant: assistant.id,
    truncated: context.truncated
  }
}

export async function generateRepositoryStarter(
  runner: CommandRunner,
  request: RepositoryStarterGenerationRequest
): Promise<GeneratedRepositoryStarter> {
  const rootPath = await resolveRepositoryRoot(runner, request.repoPath)
  const repositoryName = request.repositoryName?.trim() || path.basename(rootPath)
  const currentBranch = await getBranchLabel(runner, rootPath)
  const status = await runner.run(GIT_EXECUTABLE, ['status', '--short'], {
    cwd: rootPath,
    timeoutMs: 10_000
  })
  const recentCommits = await runner.run(GIT_EXECUTABLE, [
    'log',
    '--max-count=20',
    '--pretty=format:%h%x00%s%x00%an'
  ], {
    cwd: rootPath,
    allowedExitCodes: [0, 128],
    timeoutMs: 30_000
  })
  const trackedFiles = await runner.run(GIT_EXECUTABLE, ['ls-files'], {
    cwd: rootPath,
    allowedExitCodes: [0],
    timeoutMs: 30_000
  })
  const packageJson = await readOptionalFile(path.join(rootPath, 'package.json'), 12_000)
  const pyproject = await readOptionalFile(path.join(rootPath, 'pyproject.toml'), 10_000)
  const cargoToml = await readOptionalFile(path.join(rootPath, 'Cargo.toml'), 10_000)
  const goMod = await readOptionalFile(path.join(rootPath, 'go.mod'), 8_000)
  const readme = await readFirstExistingFile(rootPath, ['README.md', 'readme.md', 'README.txt'], 20_000)
  const gitignore = await readOptionalFile(path.join(rootPath, '.gitignore'), 12_000)
  const context = truncateText([
    `Repository: ${repositoryName}`,
    `Current branch: ${currentBranch}`,
    '',
    'Git status:',
    status.stdout || '(clean)',
    '',
    'Recent commits:',
    recentCommits.stdout || '(none)',
    '',
    'Tracked files:',
    trackedFiles.stdout.split('\n').slice(0, 320).join('\n') || '(none)',
    '',
    'package.json:',
    packageJson || '(not found)',
    '',
    'pyproject.toml:',
    pyproject || '(not found)',
    '',
    'Cargo.toml:',
    cargoToml || '(not found)',
    '',
    'go.mod:',
    goMod || '(not found)',
    '',
    'Existing README:',
    readme || '(not found)',
    '',
    'Existing .gitignore:',
    gitignore || '(not found)'
  ].join('\n'), MAX_ASSISTANT_STARTER_CONTEXT_BYTES)
  const prompt = buildRepositoryStarterPrompt({
    repositoryName,
    currentBranch,
    context: context.text,
    truncated: context.truncated
  })
  const { assistant, output } = await runAssistantForRequest(runner, request.assistant, prompt, REPOSITORY_STARTER_SCHEMA)
  const parsed = parseRepositoryStarter(output)

  return {
    ...parsed,
    assistant: assistant.id,
    truncated: context.truncated
  }
}

export async function generateReviewReport(
  runner: CommandRunner,
  request: ReviewReportRequest
): Promise<ReviewReport> {
  const rootPath = await resolveRepositoryRoot(runner, request.repoPath)
  const context = await buildReviewContext(runner, rootPath, request.scope, request.filePaths)

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

async function validateGeneratedBranchName(
  runner: CommandRunner,
  rootPath: string,
  branchName: string
): Promise<string> {
  const result = await runner.run(GIT_EXECUTABLE, ['check-ref-format', '--branch', branchName], {
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

function buildCodexAgentPrompt(context: {
  assistant: 'claude' | 'codex'
  branch: string
  status: string
  diffStat: string
  imagePaths: string[]
  request: CodexAgentRequest
  prompt: string
}): string {
  const fileText = context.request.fileText
    ? truncateText(context.request.fileText, MAX_CODEX_AGENT_FILE_BYTES)
    : null
  const assistantName = context.assistant === 'claude' ? 'Claude Code' : 'Codex'
  const imageContext = context.imagePaths.length > 0
    ? context.imagePaths.map((imagePath) => `- ${imagePath}`).join('\n')
    : '(none)'
  const basePrompt = [
    `You are ${assistantName} running inside BranchPilot, a local desktop Git client.`,
    'Use the repository working directory as your source of truth. Prefer BranchPilot-provided context first, then inspect files as needed.',
    'Do not push, reset, delete branches, or rewrite history unless the user explicitly requested it in this prompt and the selected sandbox allows it.',
    'When you make changes, summarize what changed and which verification you ran. If you cannot make changes under the sandbox, explain the exact next step.',
    'Provide a concise visible reasoning summary, not hidden chain-of-thought.',
    '',
    `Sandbox: ${context.request.sandbox}`,
    `Reasoning preset requested by user: ${context.request.reasoning}`,
    `Branch: ${context.branch}`,
    `Images attached: ${(context.request.images ?? []).length}`,
    context.assistant === 'claude'
      ? [
          'Claude image file paths:',
          imageContext,
          'Use Read on those image files when the screenshot/photo content matters.'
        ].join('\n')
      : 'Codex receives attached images through the CLI image channel.',
    '',
    'Git status:',
    context.status.trim() || '(clean)',
    '',
    'Diff stat:',
    context.diffStat.trim() || '(none)',
    '',
    context.request.filePath ? `Active file: ${context.request.filePath}` : 'Active file: (none)',
    fileText
      ? [
          `Active file content${fileText.truncated ? ' (truncated)' : ''}:`,
          fileText.text
        ].join('\n')
      : 'Active file content: (not included)',
    '',
    'Active diagnostics:',
    formatCodexAgentDiagnostics(context.request.diagnostics ?? []),
    '',
    'User request:',
    context.prompt || '(image/context-only request)'
  ].join('\n')

  return truncateText(basePrompt, MAX_CODEX_AGENT_PROMPT_BYTES).text
}

function formatCodexAgentDiagnostics(diagnostics: CodexAgentRequest['diagnostics']): string {
  if (!diagnostics?.length) return '(none)'

  return diagnostics
    .slice(0, 20)
    .map((diagnostic) => `- ${diagnostic.source} ${diagnostic.lineNumber}:${diagnostic.column} ${diagnostic.message}`)
    .join('\n')
}

async function writeCodexAgentImages(images: CodexAgentRequest['images']): Promise<{ tempDir: string; paths: string[] }> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'branchpilot-codex-images-'))
  const paths: string[] = []

  try {
    for (const [index, image] of (images ?? []).slice(0, MAX_CODEX_AGENT_IMAGES).entries()) {
      const parsed = parseCodexAgentImage(image)
      const fileName = `${String(index + 1).padStart(2, '0')}-${safeAttachmentName(image.name, parsed.extension)}`
      const filePath = path.join(tempDir, fileName)

      await fs.writeFile(filePath, parsed.buffer)
      paths.push(filePath)
    }

    return { tempDir, paths }
  } catch (error) {
    await fs.rm(tempDir, { force: true, recursive: true })
    throw error
  }
}

function parseCodexAgentImage(image: NonNullable<CodexAgentRequest['images']>[number]): { buffer: Buffer; extension: string } {
  const declaredMime = image.mimeType.trim().toLowerCase()
  const match = /^data:(image\/[-+.\w]+);base64,(?<data>.+)$/i.exec(image.dataUrl)
  const mimeType = match?.[1].toLowerCase() || declaredMime

  if (!mimeType.startsWith('image/')) {
    throw new BranchPilotUserError('codex_agent_invalid_attachment', 'Agent attachments must be images.')
  }

  const base64 = match?.groups?.data ?? image.dataUrl
  const buffer = Buffer.from(base64, 'base64')

  if (buffer.length > MAX_CODEX_AGENT_IMAGE_BYTES) {
    throw new BranchPilotUserError(
      'codex_agent_attachment_too_large',
      'One agent image is too large.',
      'Keep each image under 8 MB.'
    )
  }

  return {
    buffer,
    extension: extensionForMimeType(mimeType)
  }
}

function extensionForMimeType(mimeType: string): string {
  if (mimeType.includes('jpeg') || mimeType.includes('jpg')) return '.jpg'
  if (mimeType.includes('webp')) return '.webp'
  if (mimeType.includes('gif')) return '.gif'
  if (mimeType.includes('bmp')) return '.bmp'
  if (mimeType.includes('svg')) return '.svg'
  return '.png'
}

function safeAttachmentName(name: string, extension: string): string {
  const baseName = path.basename(name || 'image', path.extname(name || 'image'))
    .replace(/[^\w.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'image'

  return `${baseName}${extension}`
}

function parseCodexAgentEvents(eventLog: string): CodexAgentEvent[] {
  const events: CodexAgentEvent[] = []

  for (const line of eventLog.split('\n')) {
    const trimmed = line.trim()

    if (!trimmed) continue

    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>
      const type = String(parsed.type ?? parsed.event ?? parsed.kind ?? 'event')
      const text = extractCodexEventText(parsed)

      if (text) {
        events.push({ type, text: text.slice(0, 4_000) })
      }
    } catch {
      events.push({ type: 'stdout', text: trimmed.slice(0, 4_000) })
    }
  }

  return events.slice(-120)
}

function extractCodexEventText(value: unknown): string {
  if (typeof value === 'string') return value
  if (!value || typeof value !== 'object') return ''

  const record = value as Record<string, unknown>
  const direct = record.text ?? record.delta ?? record.summary ?? record.output ?? record.result

  if (typeof direct === 'string') return direct.trim()

  if (record.message && typeof record.message === 'object') {
    return extractCodexEventText(record.message)
  }

  if (Array.isArray(record.content)) {
    return record.content.map(extractCodexEventText).filter(Boolean).join('\n').trim()
  }

  if (record.item && typeof record.item === 'object') {
    return extractCodexEventText(record.item)
  }

  if (record.msg && typeof record.msg === 'object') {
    return extractCodexEventText(record.msg)
  }

  if (String(record.type ?? '').toLowerCase().includes('error')) {
    return JSON.stringify(record)
  }

  return ''
}

