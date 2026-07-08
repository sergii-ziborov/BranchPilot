import type {
  BranchDescriptionGenerationRequest,
  GeneratedBranchDescription
} from '../../../src/shared/branchPilot.js'
import { CommandRunner } from '../../lib/commandRunner.js'
import { BranchPilotUserError } from '../../lib/errors.js'
import { GIT_EXECUTABLE } from '../../lib/platformExecutables.js'
import {
  BRANCH_DESCRIPTION_SCHEMA,
  MAX_ASSISTANT_BRANCH_CONTEXT_BYTES
} from '../assistantRunner.schemas.js'
import { buildBranchDescriptionPrompt, truncateText } from '../assistantRunner.prompts.js'
import { normalizeBranchName, parseBranchDescription } from '../assistantRunner.parsers.js'
import { getBranchLabel, refExists, resolveRepositoryRoot } from '../assistantRunner.context.js'
import { runAssistantForRequest } from '../assistantRunner.exec.js'

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
