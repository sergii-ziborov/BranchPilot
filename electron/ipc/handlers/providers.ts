import type {
  CheckoutPullRequestRequest,
  CreatePullRequestRequest,
  EditorOpenRequest,
  EditorSettingsUpdate,
  ListGitHubRepositoriesRequest,
  PullRequestDetailsRequest
} from '../../../src/shared/branchPilot.js'
import {
  checkoutGitHubPullRequest,
  createGitHubPullRequest,
  getCurrentBranchPullRequest,
  getGitHubCliStatus,
  getGitHubPullRequestChecks,
  getGitHubPullRequestDetails,
  getGitHubPullRequestDiff,
  listGitHubAccounts,
  listGitHubContributors,
  listGitHubPullRequests,
  listGitHubRepositories
} from '../../providers/githubCliService.js'
import { listProviderStatuses } from '../../providers/providerAdapter.js'
import { withProjectMemoryRefresh } from '../ipcTypes.js'
import type { createIpcHelpers } from '../ipcHelpers.js'
import type { RegisterIpcHandlersServices } from '../ipcTypes.js'

export function registerProviderHandlers(
  helpers: ReturnType<typeof createIpcHelpers>,
  services: RegisterIpcHandlersServices
) {
  const { handle, handleLogged, requestRepoPath } = helpers
  const { repositoryService, editorService, settingsStore, commandRunner } = services

  handle('editor:getSettings', () => settingsStore.getEditorSettings())
  handle('editor:setSettings', (update: EditorSettingsUpdate) => settingsStore.setEditorSettings(update))
  handle('editor:open', async (request: EditorOpenRequest) =>
    editorService.openInEditor(request.targetPath, request.line, await settingsStore.getEditorSettings())
  )
  handle('terminal:open', (targetPath: string) => editorService.openTerminal(targetPath))

  handle('providers:list', () => listProviderStatuses(commandRunner))
  handle('providers:githubCliStatus', (repoPath?: string) => getGitHubCliStatus(commandRunner, repoPath))
  handleLogged('providers:createGitHubPullRequest', {
    type: 'github_pr_created',
    actor: 'provider',
    title: 'GitHub pull request created',
    repoPath: requestRepoPath,
    metadata: ([request], pullRequest) => ({
      title_length: request.title.trim().length,
      description_length: request.description.trim().length,
      base_branch: pullRequest?.baseBranch ?? request.baseBranch ?? 'default',
      head_branch: pullRequest?.headBranch ?? request.headBranch ?? 'current',
      url: pullRequest?.url ?? ''
    })
  }, (request: CreatePullRequestRequest) =>
    createGitHubPullRequest(commandRunner, request)
  )
  handle('providers:currentGitHubPullRequest', (repoPath: string) =>
    getCurrentBranchPullRequest(commandRunner, repoPath)
  )
  handle('providers:listGitHubPullRequests', (repoPath: string) =>
    listGitHubPullRequests(commandRunner, repoPath)
  )
  handle('providers:listGitHubAccounts', () =>
    listGitHubAccounts(commandRunner)
  )
  handle('providers:githubContributors', (repoPath: string) =>
    listGitHubContributors(commandRunner, repoPath)
  )
  handle('providers:listGitHubRepositories', (request: ListGitHubRepositoriesRequest) =>
    listGitHubRepositories(commandRunner, request)
  )
  handleLogged('providers:getGitHubPullRequestDetails', {
    type: 'github_pr_details_loaded',
    actor: 'provider',
    title: 'GitHub PR details loaded',
    repoPath: requestRepoPath,
    metadata: ([request], details) => ({
      pr_number: request.prNumber,
      state: details?.state ?? 'unknown',
      title_length: details?.title.length ?? 0,
      changed_files: details?.changedFiles ?? 0
    })
  }, (request: PullRequestDetailsRequest) =>
    getGitHubPullRequestDetails(commandRunner, request)
  )
  handle('providers:getGitHubPullRequestChecks', (request: PullRequestDetailsRequest) =>
    getGitHubPullRequestChecks(commandRunner, request)
  )
  handle('providers:getGitHubPullRequestDiff', (request: PullRequestDetailsRequest) =>
    getGitHubPullRequestDiff(commandRunner, request)
  )
  handleLogged('providers:checkoutGitHubPullRequest', {
    type: 'github_pr_checked_out',
    actor: 'provider',
    title: 'GitHub PR checked out',
    repoPath: requestRepoPath,
    metadata: ([request], snapshot) => ({
      pr_number: request.prNumber,
      branch: snapshot?.summary.currentBranch ?? 'unknown'
    })
  }, async (request: CheckoutPullRequestRequest) => {
    const rootPath = await checkoutGitHubPullRequest(commandRunner, request)
    return withProjectMemoryRefresh(await repositoryService.getSnapshot(rootPath))
  })
}
