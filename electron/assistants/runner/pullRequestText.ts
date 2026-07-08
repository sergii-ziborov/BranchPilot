import type {
  GeneratedPullRequestText,
  PullRequestTextGenerationRequest
} from '../../../src/shared/branchPilot.js'
import { CommandRunner } from '../../lib/commandRunner.js'
import { BranchPilotUserError } from '../../lib/errors.js'
import { GIT_EXECUTABLE } from '../../lib/platformExecutables.js'
import { MAX_ASSISTANT_PR_DIFF_BYTES } from '../assistantRunner.schemas.js'
import { buildPullRequestPrompt, truncateText } from '../assistantRunner.prompts.js'
import { normalizeBranchName, parseGeneratedText } from '../assistantRunner.parsers.js'
import {
  getCurrentBranch,
  resolveBaseRef,
  resolveDefaultBaseRef,
  resolveRepositoryRoot
} from '../assistantRunner.context.js'
import { runAssistantForRequest } from '../assistantRunner.exec.js'

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
