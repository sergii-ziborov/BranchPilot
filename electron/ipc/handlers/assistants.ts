import type {
  BranchDescriptionGenerationRequest,
  BranchDraftGenerationRequest,
  CommitMessageGenerationRequest,
  LinkedInProjectGenerationRequest,
  PullRequestTextGenerationRequest,
  ReviewReportRequest
} from '../../src/shared/branchPilot.js'
import {
  checkAssistantStatuses,
  generateBranchDescription,
  generateBranchDraft,
  generateCommitMessage,
  generateLinkedInProject,
  generatePullRequestText,
  generateReviewReport,
  listAssistantStatuses
} from '../../assistants/assistantRunner.js'
import type { createIpcHelpers } from '../ipcHelpers.js'
import type { RegisterIpcHandlersServices } from '../ipcTypes.js'

export function registerAssistantHandlers(
  helpers: ReturnType<typeof createIpcHelpers>,
  services: RegisterIpcHandlersServices
) {
  const { handle, handleAssistantAction, requestRepoPath } = helpers
  const { commandRunner } = services

  handle('assistants:list', () => listAssistantStatuses(commandRunner))
  handle('assistants:check', () => checkAssistantStatuses(commandRunner))
  handleAssistantAction('assistants:generateCommitMessage', 'commit_message', {
    type: 'assistant_commit_generated',
    actor: 'assistant',
    title: 'Assistant commit text generated',
    repoPath: requestRepoPath,
    metadata: ([request], generated) => ({
      requested_assistant: request.assistant,
      assistant: generated?.assistant ?? 'unknown',
      title_length: generated?.title.length ?? 0,
      description_length: generated?.description.length ?? 0,
      truncated: generated?.truncated ?? false
    })
  }, (request: CommitMessageGenerationRequest) =>
    generateCommitMessage(commandRunner, request)
  )
  handleAssistantAction('assistants:generateBranchDraft', 'branch_draft', {
    type: 'assistant_branch_generated',
    actor: 'assistant',
    title: 'Assistant branch draft generated',
    repoPath: requestRepoPath,
    metadata: ([request], generated) => ({
      requested_assistant: request.assistant,
      assistant: generated?.assistant ?? 'unknown',
      branch_name: generated?.branchName ?? '',
      description_length: generated?.description.length ?? 0,
      truncated: generated?.truncated ?? false
    })
  }, (request: BranchDraftGenerationRequest) =>
    generateBranchDraft(commandRunner, request)
  )
  handleAssistantAction('assistants:generateBranchDescription', 'branch_draft', {
    type: 'assistant_branch_generated',
    actor: 'assistant',
    title: 'Assistant branch description generated',
    repoPath: requestRepoPath,
    metadata: ([request], generated) => ({
      requested_assistant: request.assistant,
      assistant: generated?.assistant ?? 'unknown',
      branch_name: generated?.branchName ?? request.branchName,
      description_length: generated?.description.length ?? 0,
      truncated: generated?.truncated ?? false
    })
  }, (request: BranchDescriptionGenerationRequest) =>
    generateBranchDescription(commandRunner, request)
  )
  handleAssistantAction('assistants:generateLinkedInProject', 'linkedin_project', {
    type: 'assistant_linkedin_generated',
    actor: 'assistant',
    title: 'Assistant LinkedIn project generated',
    repoPath: requestRepoPath,
    metadata: ([request], generated) => ({
      requested_assistant: request.assistant,
      assistant: generated?.assistant ?? 'unknown',
      project_name: generated?.projectName ?? '',
      tag_count: generated?.tags.length ?? 0,
      skill_count: generated?.skills.length ?? 0,
      truncated: generated?.truncated ?? false
    })
  }, (request: LinkedInProjectGenerationRequest) =>
    generateLinkedInProject(commandRunner, request)
  )
  handleAssistantAction('assistants:generatePullRequestText', 'pull_request_text', {
    type: 'assistant_pr_generated',
    actor: 'assistant',
    title: 'Assistant PR text generated',
    repoPath: requestRepoPath,
    metadata: ([request], generated) => ({
      requested_assistant: request.assistant,
      assistant: generated?.assistant ?? 'unknown',
      base_branch: generated?.baseBranch ?? request.baseBranch ?? 'default',
      head_branch: generated?.headBranch ?? 'unknown',
      commit_count: generated?.commitCount ?? 0,
      title_length: generated?.title.length ?? 0,
      description_length: generated?.description.length ?? 0,
      truncated: generated?.truncated ?? false
    })
  }, (request: PullRequestTextGenerationRequest) =>
    generatePullRequestText(commandRunner, request)
  )
  handleAssistantAction('assistants:generateReviewReport', 'review_report', {
    type: 'assistant_review_generated',
    actor: 'assistant',
    title: 'Assistant review generated',
    repoPath: requestRepoPath,
    metadata: ([request], report) => ({
      requested_assistant: request.assistant,
      assistant: report?.assistant ?? 'unknown',
      mode: request.mode,
      scope: request.scope,
      findings: report?.findings.length ?? 0,
      truncated: report?.truncated ?? false
    })
  }, (request: ReviewReportRequest) =>
    generateReviewReport(commandRunner, request)
  )
}
