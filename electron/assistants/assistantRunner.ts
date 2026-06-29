import path from 'node:path'
import type {
  AssistantStatus,
  BranchDescriptionGenerationRequest,
  BranchDraftGenerationRequest,
  CommitMessageGenerationRequest,
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
  BRANCH_DESCRIPTION_SCHEMA, BRANCH_DRAFT_SCHEMA, GENERATED_TEXT_SCHEMA, LINKEDIN_PROJECT_SCHEMA, MAX_ASSISTANT_BRANCH_CONTEXT_BYTES, MAX_ASSISTANT_DIFF_BYTES, MAX_ASSISTANT_LINKEDIN_CONTEXT_BYTES, MAX_ASSISTANT_PR_DIFF_BYTES, MAX_ASSISTANT_STARTER_CONTEXT_BYTES, REPOSITORY_STARTER_SCHEMA, REVIEW_REPORT_SCHEMA
} from './assistantRunner.schemas.js'
import {
  buildBranchDescriptionPrompt, buildBranchDraftPrompt, buildCommitPrompt, buildLinkedInProjectPrompt, buildPullRequestPrompt, buildRepositoryStarterPrompt, buildReviewPrompt, truncateText
} from './assistantRunner.prompts.js'
import {
  normalizeBranchName, parseBranchDescription, parseBranchDraft, parseGeneratedText, parseLinkedInProject, parseRepositoryStarter, parseReviewReport
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
  runAssistantForRequest
} from './assistantRunner.exec.js'


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

