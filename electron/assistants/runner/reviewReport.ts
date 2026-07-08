import type {
  ReviewReport,
  ReviewReportRequest
} from '../../../src/shared/branchPilot.js'
import { CommandRunner } from '../../lib/commandRunner.js'
import { BranchPilotUserError } from '../../lib/errors.js'
import { REVIEW_REPORT_SCHEMA } from '../assistantRunner.schemas.js'
import { buildReviewPrompt } from '../assistantRunner.prompts.js'
import { parseReviewReport } from '../assistantRunner.parsers.js'
import { buildReviewContext, resolveRepositoryRoot } from '../assistantRunner.context.js'
import { runAssistantForRequest } from '../assistantRunner.exec.js'

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
