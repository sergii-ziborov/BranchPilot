import type {
  BranchDraftGenerationRequest,
  GeneratedBranchDraft
} from '../../../src/shared/branchPilot.js'
import { CommandRunner } from '../../lib/commandRunner.js'
import { BranchPilotUserError } from '../../lib/errors.js'
import { GIT_EXECUTABLE } from '../../lib/platformExecutables.js'
import {
  BRANCH_DRAFT_SCHEMA,
  MAX_ASSISTANT_BRANCH_CONTEXT_BYTES
} from '../assistantRunner.schemas.js'
import { buildBranchDraftPrompt, truncateText } from '../assistantRunner.prompts.js'
import { parseBranchDraft } from '../assistantRunner.parsers.js'
import { getBranchLabel, resolveRepositoryRoot } from '../assistantRunner.context.js'
import { runAssistantForRequest } from '../assistantRunner.exec.js'

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
