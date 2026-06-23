import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import type {
  CheckoutPullRequestRequest,
  CreateGitHubRepositoryRequest,
  CreatePullRequestRequest,
  EditorOpenRequest,
  EditorSettingsUpdate,
  TerminalSettingsUpdate,
  GitHubCoAuthorSearchRequest,
  ListGitHubRepositoriesRequest,
  PullRequestDetailsRequest
} from '../../../src/shared/branchPilot.js'
import {
  checkoutGitHubPullRequest,
  connectGitHubAuthentication,
  createGitHubPullRequest,
  getCurrentBranchPullRequest,
  getGitHubCliStatus,
  getGitHubPullRequestChecks,
  getGitHubPullRequestDetails,
  getGitHubPullRequestDiff,
  listGitHubAccounts,
  listGitHubContributors,
  listGitHubPullRequests,
  listGitHubRepositories,
  publishLocalGitHubRepository,
  searchGitHubCoAuthors
} from '../../providers/githubCliService.js'
import { listProviderStatuses } from '../../providers/providerAdapter.js'
import { withProjectMemoryRefresh } from '../ipcTypes.js'
import type { createIpcHelpers } from '../ipcHelpers.js'
import type { RegisterIpcHandlersServices } from '../ipcTypes.js'

const require = createRequire(import.meta.url)
const { shell } = require('electron') as typeof import('electron')

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
  handle('terminal:getSettings', () => settingsStore.getTerminalSettings())
  handle('terminal:setSettings', (update: TerminalSettingsUpdate) => settingsStore.setTerminalSettings(update))
  handle('terminal:open', async (targetPath: string) => editorService.openTerminal(targetPath, await settingsStore.getTerminalSettings()))
  handle('filesystem:showItem', (targetPath: string) => {
    const absolutePath = path.resolve(targetPath)
    const existingTarget = existsSync(absolutePath) ? absolutePath : path.dirname(absolutePath)
    shell.showItemInFolder(existingTarget)
    return {
      message: existsSync(absolutePath) ? 'Shown in file manager.' : 'Opened containing folder.'
    }
  })

  handle('providers:list', () => listProviderStatuses(commandRunner))
  handle('providers:githubCliStatus', (repoPath?: string) => getGitHubCliStatus(commandRunner, repoPath))
  handle('providers:connectGitHub', (repoPath?: string) => connectGitHubAuthentication(commandRunner, repoPath))
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
  handle('providers:searchGitHubCoAuthors', (request: GitHubCoAuthorSearchRequest) =>
    searchGitHubCoAuthors(commandRunner, request)
  )
  handle('providers:listGitHubRepositories', (request: ListGitHubRepositoriesRequest) =>
    listGitHubRepositories(commandRunner, request)
  )
  handleLogged('providers:createGitHubRepository', {
    type: 'github_repository_created',
    actor: 'provider',
    title: 'GitHub repository created',
    repoPath: requestRepoPath,
    metadata: ([request], result) => ({
      owner: request.owner,
      repository: request.name,
      visibility: request.visibility,
      remote_name: result?.remoteName ?? request.remoteName ?? 'origin',
      pushed: result?.pushed ?? false,
      url: result?.url ?? '',
      starter_files: result?.starterFilesWritten.join(',') ?? ''
    })
  }, async (request: CreateGitHubRepositoryRequest) => {
    const result = await publishLocalGitHubRepository(commandRunner, request)
    const snapshot = await repositoryService.getSnapshot(result.rootPath)

    return {
      ...result,
      snapshot
    }
  })
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
