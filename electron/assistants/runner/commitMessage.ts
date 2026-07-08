import type {
  CommitMessageGenerationRequest,
  GeneratedCommitMessage
} from '../../../src/shared/branchPilot.js'
import { CommandRunner } from '../../lib/commandRunner.js'
import { BranchPilotUserError } from '../../lib/errors.js'
import { GIT_EXECUTABLE } from '../../lib/platformExecutables.js'
import { MAX_ASSISTANT_DIFF_BYTES } from '../assistantRunner.schemas.js'
import { buildCommitPrompt, truncateText } from '../assistantRunner.prompts.js'
import { parseGeneratedText } from '../assistantRunner.parsers.js'
import { resolveRepositoryRoot } from '../assistantRunner.context.js'
import { runAssistantForRequest } from '../assistantRunner.exec.js'

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
