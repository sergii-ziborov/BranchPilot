import { webContents } from 'electron'
import type {
  BranchDescriptionGenerationRequest,
  BranchDraftGenerationRequest,
  CodexAgentEvent,
  CodexAgentRequest,
  CodexAgentStreamBatch,
  CommitMessageGenerationRequest,
  FileBeautifyRequest,
  LinkedInProjectGenerationRequest,
  PullRequestTextGenerationRequest,
  RepositoryStarterGenerationRequest,
  ReviewReportRequest
} from '../../../src/shared/branchPilot.js'
import { CODEX_AGENT_EVENT_CHANNEL } from '../../../src/shared/ipcChannels.js'
import {
  checkAssistantStatuses,
  generateBranchDescription,
  generateBranchDraft,
  beautifyFileWithAssistant,
  generateCommitMessage,
  generateLinkedInProject,
  generatePullRequestText,
  generateRepositoryStarter,
  generateReviewReport,
  listAssistantStatuses,
  runCodexAgent
} from '../../assistants/assistantRunner.js'
import type { createIpcHelpers } from '../ipcHelpers.js'
import type { RegisterIpcHandlersServices } from '../ipcTypes.js'

const CODEX_AGENT_EVENT_FLUSH_MS = 80

const codexAgentRuns = new Map<string, AbortController>()

function createCodexAgentEventEmitter(runId: string) {
  let pending: CodexAgentEvent[] = []
  let timer: NodeJS.Timeout | null = null

  const flush = () => {
    timer = null

    if (pending.length === 0) return

    const batch: CodexAgentStreamBatch = { runId, events: pending }

    pending = []

    for (const contents of webContents.getAllWebContents()) {
      if (!contents.isDestroyed()) {
        contents.send(CODEX_AGENT_EVENT_CHANNEL, batch)
      }
    }
  }

  return {
    push: (event: CodexAgentEvent) => {
      pending.push(event)

      if (!timer) {
        timer = setTimeout(flush, CODEX_AGENT_EVENT_FLUSH_MS)
      }
    },
    dispose: () => {
      if (timer) {
        clearTimeout(timer)
      }

      flush()
    }
  }
}

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
  handleAssistantAction('assistants:beautifyFile', 'file_beautify', {
    type: 'assistant_file_beautified',
    actor: 'assistant',
    title: 'Assistant file beautified',
    repoPath: requestRepoPath,
    metadata: ([request], generated) => ({
      requested_assistant: request.assistant,
      assistant: generated?.assistant ?? 'unknown',
      file_path: request.filePath,
      input_length: request.text.length,
      output_length: generated?.content.length ?? 0
    })
  }, (request: FileBeautifyRequest) =>
    beautifyFileWithAssistant(commandRunner, request)
  )
  handleAssistantAction('assistants:runCodexAgent', 'codex_agent', {
    type: 'assistant_codex_agent_ran',
    actor: 'assistant',
    title: 'Local agent ran',
    repoPath: requestRepoPath,
    metadata: ([request], generated) => ({
      requested_assistant: request.assistant,
      assistant: generated?.assistant ?? 'unknown',
      file_path: request.filePath ?? '',
      sandbox: request.sandbox,
      reasoning: request.reasoning,
      images: request.images?.length ?? 0,
      output_length: generated?.output.length ?? 0,
      duration_ms: generated?.durationMs ?? 0
    })
  }, (request: CodexAgentRequest) => {
    const controller = new AbortController()
    const emitter = request.runId ? createCodexAgentEventEmitter(request.runId) : undefined

    if (request.runId) {
      codexAgentRuns.set(request.runId, controller)
    }

    return runCodexAgent(commandRunner, request, { onEvent: emitter?.push, signal: controller.signal })
      .finally(() => {
        emitter?.dispose()

        if (request.runId) {
          codexAgentRuns.delete(request.runId)
        }
      })
  })
  handle('assistants:cancelCodexAgent', (runId: string) => {
    const controller = codexAgentRuns.get(runId)

    controller?.abort()

    return Boolean(controller)
  })
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
  handleAssistantAction('assistants:generateRepositoryStarter', 'repository_starter', {
    type: 'assistant_repository_starter_generated',
    actor: 'assistant',
    title: 'Assistant repository starter generated',
    repoPath: requestRepoPath,
    metadata: ([request], generated) => ({
      requested_assistant: request.assistant,
      assistant: generated?.assistant ?? 'unknown',
      repository_name: request.repositoryName ?? '',
      description_length: generated?.description.length ?? 0,
      readme_length: generated?.readme.length ?? 0,
      gitignore_length: generated?.gitignore.length ?? 0,
      truncated: generated?.truncated ?? false
    })
  }, (request: RepositoryStarterGenerationRequest) =>
    generateRepositoryStarter(commandRunner, request)
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
