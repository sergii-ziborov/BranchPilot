import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type {
  ApiResult,
  ActivityLogActor,
  ActivityLogEventType,
  ActivityLogMetadata,
  ActivityLogQuery,
  ApplyPatchRequest,
  AssistantActionKind,
  AssistantPolicyUpdate,
  BranchCompareRequest,
  BranchDescriptionGenerationRequest,
  BranchDraftGenerationRequest,
  BranchActionRequest,
  CheckoutPullRequestRequest,
  CloneRepositoryRequest,
  CommitDetailsRequest,
  CommitFileDiffRequest,
  CommitMessageGenerationRequest,
  CommitRequest,
  ConfirmedCommitReferenceRequest,
  ConfirmedCommitRequest,
  ConfirmedStashActionRequest,
  ConfirmedFileActionRequest,
  CreateStashRequest,
  CreatePullRequestRequest,
  CreateTagRequest,
  CreateWorktreeRequest,
  DailyReviewRequest,
  DeleteBranchRequest,
  DeleteTagRequest,
  DiffRequest,
  EditorOpenRequest,
  EditorSettingsUpdate,
  ExportPatchRequest,
  FileActionRequest,
  GitIdentityUpdate,
  HunkActionRequest,
  ListGitHubRepositoriesRequest,
  MergeBranchRequest,
  ProjectMemoryScanResult,
  PullRequestDetailsRequest,
  PullRequestTextGenerationRequest,
  PublishBranchRequest,
  RenameBranchRequest,
  RemoteRemoveRequest,
  RemoteUpsertRequest,
  RemoveWorktreeRequest,
  RepositoryPinRequest,
  RepositorySnapshot,
  ReviewReportRequest,
  SetBranchUpstreamRequest,
  StashActionRequest,
  UpdateSubmoduleRequest,
  UpdateBranchDescriptionRequest
} from '../src/shared/branchPilot.js'
import { isBranchPilotIpcChannel, type BranchPilotIpcChannel } from '../src/shared/ipcChannels.js'
import {
  checkAssistantStatuses,
  generateBranchDescription,
  generateBranchDraft,
  generateCommitMessage,
  generatePullRequestText,
  generateReviewReport,
  listAssistantStatuses
} from './assistants/assistantRunner.js'
import { AssistantPolicyService } from './lib/assistantPolicyService.js'
import { ActivityLogService, type ActivityLogAppendInput } from './lib/activityLogService.js'
import { CommandRunner } from './lib/commandRunner.js'
import { DailyReviewService } from './lib/dailyReviewService.js'
import { ExternalEditorService } from './lib/editorService.js'
import { toBranchPilotError } from './lib/errors.js'
import { isSafeExternalUrl } from './lib/externalUrl.js'
import { ProjectMemoryService, ProjectMemoryStore } from './lib/projectMemoryService.js'
import { ProjectWikiService, ProjectWikiStore } from './lib/projectWikiService.js'
import { RepositoryService } from './lib/repositoryService.js'
import { SettingsStore } from './lib/settingsStore.js'
import { createProjectMemoryMcpConfig } from './mcp/config.js'
import {
  checkoutGitHubPullRequest,
  createGitHubPullRequest,
  getCurrentBranchPullRequest,
  getGitHubCliStatus,
  getGitHubPullRequestChecks,
  getGitHubPullRequestDetails,
  getGitHubPullRequestDiff,
  listGitHubAccounts,
  listGitHubRepositories,
  listGitHubPullRequests
} from './providers/githubCliService.js'
import { listProviderStatuses } from './providers/providerAdapter.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const devServerUrl = process.env.VITE_DEV_SERVER_URL
const commandRunner = new CommandRunner()
const projectMemoryDir = path.join(app.getPath('userData'), 'project-memory')
const projectWikiDir = path.join(app.getPath('userData'), 'project-wiki')
const activityLogDir = path.join(app.getPath('userData'), 'activity-log')
const settingsStore = new SettingsStore(path.join(app.getPath('userData'), 'branchpilot-settings.json'))
const repositoryService = new RepositoryService(commandRunner, settingsStore)
const editorService = new ExternalEditorService(commandRunner)
const assistantPolicyService = new AssistantPolicyService(settingsStore)
const activityLogService = new ActivityLogService(activityLogDir)
const projectMemoryService = new ProjectMemoryService(
  commandRunner,
  new ProjectMemoryStore(projectMemoryDir)
)
const projectWikiService = new ProjectWikiService(
  projectMemoryService,
  activityLogService,
  new ProjectWikiStore(projectWikiDir)
)
const dailyReviewService = new DailyReviewService(repositoryService, activityLogService)

function createMainWindow() {
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 980,
    minHeight: 680,
    title: 'BranchPilot',
    backgroundColor: '#f6f7f9',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  if (devServerUrl) {
    void window.loadURL(devServerUrl)
    if (process.env.BRANCHPILOT_OPEN_DEVTOOLS === '1') {
      window.webContents.openDevTools({ mode: 'detach' })
    }
  } else {
    void window.loadFile(path.join(__dirname, '../../dist/index.html'))
  }

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) {
      void shell.openExternal(url)
    }

    return { action: 'deny' }
  })
}

function assertKnownIpcChannel(channel: BranchPilotIpcChannel): void {
  if (!isBranchPilotIpcChannel(channel)) {
    throw new Error(`Unknown BranchPilot IPC channel: ${channel}`)
  }
}

function handleUnwrapped<Args extends unknown[], T>(channel: BranchPilotIpcChannel, callback: (...args: Args) => Promise<T> | T) {
  assertKnownIpcChannel(channel)
  ipcMain.handle(channel, async (_event, ...args): Promise<T> => callback(...(args as Args)))
}

function handle<Args extends unknown[], T>(channel: BranchPilotIpcChannel, callback: (...args: Args) => Promise<T> | T) {
  assertKnownIpcChannel(channel)
  ipcMain.handle(channel, async (_event, ...args): Promise<ApiResult<T>> => {
    try {
      return {
        ok: true,
        data: await callback(...(args as Args))
      }
    } catch (error) {
      return {
        ok: false,
        error: toBranchPilotError(error)
      }
    }
  })
}

interface ActivityDescriptor<Args extends unknown[], T> {
  type: ActivityLogEventType
  actor: ActivityLogActor
  title: string
  repoPath: (args: Args, data?: T) => string | undefined
  metadata?: (args: Args, data?: T) => ActivityLogMetadata | undefined
}

function handleLogged<Args extends unknown[], T>(
  channel: BranchPilotIpcChannel,
  descriptor: ActivityDescriptor<Args, T>,
  callback: (...args: Args) => Promise<T> | T
) {
  assertKnownIpcChannel(channel)
  ipcMain.handle(channel, async (_event, ...rawArgs): Promise<ApiResult<T>> => {
    const args = rawArgs as Args

    try {
      const data = await callback(...args)
      await recordActivity({
        repoPath: descriptor.repoPath(args, data),
        type: descriptor.type,
        actor: descriptor.actor,
        status: 'success',
        title: descriptor.title,
        metadata: descriptor.metadata?.(args, data)
      })

      return {
        ok: true,
        data
      }
    } catch (error) {
      const branchPilotError = toBranchPilotError(error)
      await recordActivity({
        repoPath: descriptor.repoPath(args),
        type: descriptor.type,
        actor: descriptor.actor,
        status: 'failure',
        title: descriptor.title,
        metadata: {
          ...(descriptor.metadata?.(args) ?? {}),
          error_code: branchPilotError.code,
          error_message: branchPilotError.message
        }
      })

      return {
        ok: false,
        error: branchPilotError
      }
    }
  })
}

function handleAssistantAction<Args extends [{ repoPath: string }], T>(
  channel: BranchPilotIpcChannel,
  action: AssistantActionKind,
  descriptor: ActivityDescriptor<Args, T>,
  callback: (...args: Args) => Promise<T> | T
) {
  assertKnownIpcChannel(channel)
  ipcMain.handle(channel, async (_event, ...rawArgs): Promise<ApiResult<T>> => {
    const args = rawArgs as Args
    const repoPath = descriptor.repoPath(args)

    try {
      if (repoPath) {
        await assistantPolicyService.assertActionAllowed(repoPath, action)
      }

      const data = await callback(...args)
      await recordActivity({
        repoPath,
        type: descriptor.type,
        actor: descriptor.actor,
        status: 'success',
        title: descriptor.title,
        metadata: descriptor.metadata?.(args, data)
      })

      return {
        ok: true,
        data
      }
    } catch (error) {
      const branchPilotError = toBranchPilotError(error)

      if (branchPilotError.code === 'assistant_policy_blocked') {
        const policy = repoPath ? await assistantPolicyService.getAssistantPolicy(repoPath).catch(() => undefined) : undefined
        await recordActivity({
          repoPath,
          type: 'assistant_action_blocked',
          actor: 'assistant',
          status: 'failure',
          title: 'Assistant action blocked',
          metadata: {
            action,
            policy_mode: policy?.settings.mode ?? 'unknown',
            error_code: branchPilotError.code,
            error_message: branchPilotError.message
          }
        })
      } else {
        await recordActivity({
          repoPath,
          type: descriptor.type,
          actor: descriptor.actor,
          status: 'failure',
          title: descriptor.title,
          metadata: {
            ...(descriptor.metadata?.(args) ?? {}),
            error_code: branchPilotError.code,
            error_message: branchPilotError.message
          }
        })
      }

      return {
        ok: false,
        error: branchPilotError
      }
    }
  })
}

async function recordActivity(input: Omit<ActivityLogAppendInput, 'repoPath'> & { repoPath?: string }) {
  if (!input.repoPath) {
    return
  }

  try {
    await activityLogService.append({
      ...input,
      repoPath: input.repoPath
    })
  } catch (error) {
    console.error('Activity Log write failed', error)
  }
}

function repoPathArg(args: [string]): string {
  return args[0]
}

function requestRepoPath<T extends { repoPath: string }>(args: [T]): string {
  return args[0].repoPath
}

function snapshotRepoPath(_args: unknown[], snapshot?: RepositorySnapshot | null): string | undefined {
  return snapshot?.summary.rootPath
}

async function choosePatchOutputPath(request: ExportPatchRequest): Promise<string | undefined> {
  const repoName = path.basename(request.repoPath)
  const scopeLabel = request.scope === 'staged' ? 'staged' : 'working-tree'
  const result = await dialog.showSaveDialog({
    title: 'Export patch',
    defaultPath: `${repoName}-${scopeLabel}.patch`,
    filters: [
      { name: 'Patch files', extensions: ['patch', 'diff'] },
      { name: 'All files', extensions: ['*'] }
    ]
  })

  return result.canceled ? undefined : result.filePath
}

async function choosePatchInputPath(): Promise<string | undefined> {
  const result = await dialog.showOpenDialog({
    title: 'Apply patch',
    properties: ['openFile'],
    filters: [
      { name: 'Patch files', extensions: ['patch', 'diff'] },
      { name: 'All files', extensions: ['*'] }
    ]
  })

  return result.canceled ? undefined : result.filePaths[0]
}

async function chooseWorktreeTargetPath(request: CreateWorktreeRequest): Promise<string | undefined> {
  const repoName = path.basename(request.repoPath)
  const branchSlug = request.branchName
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'worktree'
  const result = await dialog.showSaveDialog({
    title: 'Create worktree folder',
    defaultPath: path.join(path.dirname(request.repoPath), `${repoName}-${branchSlug}`),
    buttonLabel: 'Use folder'
  })

  return result.canceled ? undefined : result.filePath
}

async function chooseCloneParentPath(): Promise<string | undefined> {
  const result = await dialog.showOpenDialog({
    title: 'Clone repository into folder',
    buttonLabel: 'Clone here',
    properties: ['openDirectory', 'createDirectory']
  })

  return result.canceled || result.filePaths.length === 0 ? undefined : result.filePaths[0]
}

function registerIpcHandlers() {
  handleUnwrapped('app:version', () => app.getVersion())

  handleLogged('repository:chooseAndOpen', {
    type: 'repository_opened',
    actor: 'user',
    title: 'Repository opened',
    repoPath: snapshotRepoPath,
    metadata: (_args, snapshot) => snapshot ? {
      repository: snapshot.summary.name,
      branch: snapshot.summary.currentBranch,
      remote: snapshot.summary.remoteName ?? 'none'
    } : undefined
  }, async () => {
    const result = await dialog.showOpenDialog({
      title: 'Open repository',
      properties: ['openDirectory']
    })

    if (result.canceled || result.filePaths.length === 0) {
      return null
    }

    return withProjectMemoryRefresh(await repositoryService.openRepository(result.filePaths[0]))
  })

  handleLogged('repository:clone', {
    type: 'repository_cloned',
    actor: 'user',
    title: 'Repository cloned',
    repoPath: snapshotRepoPath,
    metadata: ([request], snapshot) => ({
      repository: snapshot?.summary.name ?? request.targetName ?? 'repository',
      target_parent: request.targetParentPath ? path.basename(request.targetParentPath) : 'selected'
    })
  }, async (request: CloneRepositoryRequest) => {
    const targetParentPath = request.targetParentPath ?? await chooseCloneParentPath()

    if (!targetParentPath) {
      return null
    }

    return withProjectMemoryRefresh(await repositoryService.cloneRepository({
      ...request,
      targetParentPath
    }))
  })

  handleLogged('repository:open', {
    type: 'repository_opened',
    actor: 'user',
    title: 'Repository opened',
    repoPath: (args, snapshot) => snapshotRepoPath(args, snapshot) ?? args[0],
    metadata: (_args, snapshot) => snapshot ? {
      repository: snapshot.summary.name,
      branch: snapshot.summary.currentBranch,
      remote: snapshot.summary.remoteName ?? 'none'
    } : undefined
  }, async (repoPath: string) =>
    withProjectMemoryRefresh(await repositoryService.openRepository(repoPath))
  )
  handle('repository:recent', () => repositoryService.getRecentRepositories())
  handle('repository:setPinned', (request: RepositoryPinRequest) => repositoryService.setRepositoryPinned(request))
  handle('repository:dashboard', (repoPath?: string) => repositoryService.getRepositoryDashboard(repoPath))
  handleLogged('repository:refresh', {
    type: 'repository_refreshed',
    actor: 'user',
    title: 'Repository refreshed',
    repoPath: repoPathArg,
    metadata: (_args, snapshot) => snapshot ? {
      branch: snapshot.summary.currentBranch,
      changed: snapshot.status.counts.changed,
      staged: snapshot.status.counts.staged
    } : undefined
  }, (repoPath: string) => repositoryService.getSnapshot(repoPath))
  handle('repository:diff', (request: DiffRequest) => repositoryService.getDiff(request))
  handle('repository:history', (repoPath: string) => repositoryService.getHistory(repoPath))
  handle('repository:commitDetails', (request: CommitDetailsRequest) => repositoryService.getCommitDetails(request))
  handle('repository:commitFileDiff', (request: CommitFileDiffRequest) => repositoryService.getCommitFileDiff(request))
  handle('repository:projectMemory', (repoPath: string) => projectMemoryService.getProjectMemory(repoPath))
  handle('repository:projectWiki', (repoPath: string) => projectWikiService.getProjectWiki(repoPath))
  handleLogged('repository:scanProjectMemory', {
    type: 'project_memory_scanned',
    actor: 'branchpilot',
    title: 'Project Memory scanned',
    repoPath: repoPathArg,
    metadata: (_args, result) => result ? {
      scanned_files: result.scannedFileCount,
      skipped_files: result.skippedFileCount,
      duration_ms: result.durationMs,
      symbols: result.snapshot.symbols.length
    } : undefined
  }, (repoPath: string): Promise<ProjectMemoryScanResult> =>
    projectMemoryService.scanProjectMemory(repoPath)
  )
  handleLogged('repository:generateProjectWiki', {
    type: 'project_wiki_generated',
    actor: 'branchpilot',
    title: 'Project Wiki generated',
    repoPath: repoPathArg,
    metadata: (_args, result) => result ? {
      pages: result.wiki.pages.length,
      scanned_files: result.memory.scannedFileCount,
      source_memory_scanned_at: result.wiki.sourceMemoryScannedAt
    } : undefined
  }, (repoPath: string) =>
    projectWikiService.generateProjectWiki(repoPath)
  )
  handle('repository:projectMemoryMcpConfig', (repoPath: string) =>
    createProjectMemoryMcpConfig({
      memoryDir: projectMemoryDir,
      activityDir: activityLogDir,
      wikiDir: projectWikiDir,
      repoPath,
      serverPath: path.join(__dirname, 'mcp/server.js')
    })
  )
  handle('assistants:getPolicy', (repoPath: string) => assistantPolicyService.getAssistantPolicy(repoPath))
  handleLogged('assistants:setPolicy', {
    type: 'assistant_policy_updated',
    actor: 'user',
    title: 'Assistant policy updated',
    repoPath: requestRepoPath,
    metadata: ([update], status) => ({
      mode: status?.settings.mode ?? update.mode
    })
  }, (update: AssistantPolicyUpdate) =>
    assistantPolicyService.setAssistantPolicy(update)
  )
  handle('activity:list', (query: ActivityLogQuery) => activityLogService.getActivityLog(query))
  handle('activity:clear', (repoPath: string, confirmed: boolean) =>
    activityLogService.clearActivityLog(repoPath, confirmed)
  )
  handleLogged('daily:generate', {
    type: 'daily_review_generated',
    actor: 'branchpilot',
    title: 'Daily review generated',
    repoPath: requestRepoPath,
    metadata: ([request], report) => ({
      date: request.date ?? report?.date ?? '',
      commits: report?.stats.commits ?? 0,
      changed: report?.stats.changed ?? 0,
      activities: report?.stats.activities ?? 0,
      actions: report?.actionItems.length ?? 0
    })
  }, (request: DailyReviewRequest) =>
    dailyReviewService.generateDailyReview(request)
  )
  handle('repository:gitConfig', (repoPath: string) => repositoryService.getGitConfig(repoPath))
  handle('repository:setLocalGitIdentity', (request: GitIdentityUpdate) => repositoryService.setLocalGitIdentity(request))
  handleLogged('git:addRemote', {
    type: 'remote_added',
    actor: 'user',
    title: 'Remote added',
    repoPath: requestRepoPath,
    metadata: ([request]) => ({
      remote: request.name
    })
  }, (request: RemoteUpsertRequest) =>
    repositoryService.addRemote(request)
  )
  handleLogged('git:setRemoteUrl', {
    type: 'remote_updated',
    actor: 'user',
    title: 'Remote updated',
    repoPath: requestRepoPath,
    metadata: ([request]) => ({
      remote: request.name
    })
  }, (request: RemoteUpsertRequest) =>
    repositoryService.setRemoteUrl(request)
  )
  handleLogged('git:removeRemote', {
    type: 'remote_removed',
    actor: 'user',
    title: 'Remote removed',
    repoPath: requestRepoPath,
    metadata: ([request]) => ({
      remote: request.name
    })
  }, (request: RemoteRemoveRequest) =>
    repositoryService.removeRemote(request)
  )

  handle('git:stageFile', (request: FileActionRequest) => repositoryService.stageFile(request))
  handle('git:unstageFile', (request: FileActionRequest) => repositoryService.unstageFile(request))
  handle('git:stageHunk', (request: HunkActionRequest) => repositoryService.stageHunk(request))
  handle('git:unstageHunk', (request: HunkActionRequest) => repositoryService.unstageHunk(request))
  handle('git:stageAll', (repoPath: string) => repositoryService.stageAll(repoPath))
  handle('git:unstageAll', (repoPath: string) => repositoryService.unstageAll(repoPath))
  handle('git:discardFile', (request: ConfirmedFileActionRequest) => repositoryService.discardFile(request))
  handle('git:deleteUntrackedFile', (request: ConfirmedFileActionRequest) =>
    repositoryService.deleteUntrackedFile(request)
  )
  handleLogged('git:commit', {
    type: 'commit_created',
    actor: 'user',
    title: 'Commit created',
    repoPath: requestRepoPath,
    metadata: ([request], snapshot) => ({
      title_length: request.title.trim().length,
      description_length: request.description.trim().length,
      branch: snapshot?.summary.currentBranch ?? 'unknown'
    })
  }, async (request: CommitRequest) =>
    withProjectMemoryRefresh(await repositoryService.commit(request))
  )
  handleLogged('git:amendCommit', {
    type: 'commit_amended',
    actor: 'user',
    title: 'Commit amended',
    repoPath: requestRepoPath,
    metadata: ([request], snapshot) => ({
      title_length: request.title.trim().length,
      description_length: request.description.trim().length,
      branch: snapshot?.summary.currentBranch ?? 'unknown'
    })
  }, async (request: ConfirmedCommitRequest) =>
    withProjectMemoryRefresh(await repositoryService.amendCommit(request))
  )
  handleLogged('git:revertCommit', {
    type: 'commit_reverted',
    actor: 'user',
    title: 'Commit reverted',
    repoPath: requestRepoPath,
    metadata: ([request], snapshot) => ({
      commit: request.commitSha.slice(0, 12),
      branch: snapshot?.summary.currentBranch ?? 'unknown',
      conflicts: snapshot?.status.counts.conflicted ?? 0
    })
  }, async (request: ConfirmedCommitReferenceRequest) =>
    withProjectMemoryRefresh(await repositoryService.revertCommit(request))
  )
  handleLogged('git:cherryPickCommit', {
    type: 'commit_cherry_picked',
    actor: 'user',
    title: 'Commit cherry-picked',
    repoPath: requestRepoPath,
    metadata: ([request], snapshot) => ({
      commit: request.commitSha.slice(0, 12),
      branch: snapshot?.summary.currentBranch ?? 'unknown',
      conflicts: snapshot?.status.counts.conflicted ?? 0
    })
  }, async (request: ConfirmedCommitReferenceRequest) =>
    withProjectMemoryRefresh(await repositoryService.cherryPickCommit(request))
  )
  handle('stash:list', (repoPath: string) => repositoryService.listStashes(repoPath))
  handleLogged('stash:create', {
    type: 'stash_created',
    actor: 'user',
    title: 'Stash created',
    repoPath: requestRepoPath,
    metadata: ([request]) => ({
      message_length: request.message.trim().length,
      include_untracked: request.includeUntracked
    })
  }, (request: CreateStashRequest) => repositoryService.createStash(request))
  handleLogged('stash:apply', {
    type: 'stash_applied',
    actor: 'user',
    title: 'Stash applied',
    repoPath: requestRepoPath,
    metadata: ([request]) => ({ stash_ref: request.stashRef })
  }, (request: StashActionRequest) => repositoryService.applyStash(request))
  handleLogged('stash:drop', {
    type: 'stash_dropped',
    actor: 'user',
    title: 'Stash dropped',
    repoPath: requestRepoPath,
    metadata: ([request]) => ({ stash_ref: request.stashRef })
  }, (request: ConfirmedStashActionRequest) => repositoryService.dropStash(request))
  handleLogged('git:fetch', {
    type: 'git_fetched',
    actor: 'user',
    title: 'Fetched remote',
    repoPath: repoPathArg
  }, async (repoPath: string) =>
    withProjectMemoryRefresh(await repositoryService.fetch(repoPath))
  )
  handleLogged('git:pull', {
    type: 'git_pulled',
    actor: 'user',
    title: 'Pulled branch',
    repoPath: repoPathArg,
    metadata: (_args, snapshot) => snapshot ? ({ branch: snapshot.summary.currentBranch }) : undefined
  }, async (repoPath: string) =>
    withProjectMemoryRefresh(await repositoryService.pull(repoPath))
  )
  handleLogged('git:push', {
    type: 'git_pushed',
    actor: 'user',
    title: 'Pushed branch',
    repoPath: repoPathArg,
    metadata: (_args, snapshot) => snapshot ? ({ branch: snapshot.summary.currentBranch }) : undefined
  }, async (repoPath: string) =>
    withProjectMemoryRefresh(await repositoryService.push(repoPath))
  )
  handleLogged('git:publishBranch', {
    type: 'branch_published',
    actor: 'user',
    title: 'Branch published',
    repoPath: requestRepoPath,
    metadata: ([request], snapshot) => ({
      branch: request.branch ?? snapshot?.summary.currentBranch ?? 'current',
      remote: request.remote ?? snapshot?.summary.remoteName ?? 'origin'
    })
  }, async (request: PublishBranchRequest) =>
    withProjectMemoryRefresh(await repositoryService.publishBranch(request))
  )
  handleLogged('git:createBranch', {
    type: 'branch_created',
    actor: 'user',
    title: 'Branch created',
    repoPath: requestRepoPath,
    metadata: ([request]) => ({ branch: request.branchName })
  }, async (request: BranchActionRequest) =>
    withProjectMemoryRefresh(await repositoryService.createBranch(request.repoPath, request.branchName, request.description))
  )
  handleLogged('git:renameBranch', {
    type: 'branch_renamed',
    actor: 'user',
    title: 'Branch renamed',
    repoPath: requestRepoPath,
    metadata: ([request]) => ({
      old_branch: request.oldBranchName,
      new_branch: request.newBranchName
    })
  }, async (request: RenameBranchRequest) =>
    withProjectMemoryRefresh(await repositoryService.renameBranch(request.repoPath, request.oldBranchName, request.newBranchName))
  )
  handleLogged('git:setBranchUpstream', {
    type: 'branch_upstream_updated',
    actor: 'user',
    title: 'Branch upstream updated',
    repoPath: requestRepoPath,
    metadata: ([request]) => ({
      branch: request.branchName,
      upstream: request.upstream
    })
  }, async (request: SetBranchUpstreamRequest) =>
    withProjectMemoryRefresh(await repositoryService.setBranchUpstream(request.repoPath, request.branchName, request.upstream))
  )
  handleLogged('git:updateBranchDescription', {
    type: 'branch_description_updated',
    actor: 'user',
    title: 'Branch description updated',
    repoPath: requestRepoPath,
    metadata: ([request]) => ({
      branch: request.branchName,
      description_length: request.description.trim().length
    })
  }, async (request: UpdateBranchDescriptionRequest) =>
    withProjectMemoryRefresh(await repositoryService.updateBranchDescription(request.repoPath, request.branchName, request.description))
  )
  handle('git:compareBranch', (request: BranchCompareRequest) =>
    repositoryService.compareBranch(request)
  )
  handleLogged('git:switchBranch', {
    type: 'branch_switched',
    actor: 'user',
    title: 'Branch switched',
    repoPath: requestRepoPath,
    metadata: ([request]) => ({ branch: request.branchName })
  }, async (request: BranchActionRequest) =>
    withProjectMemoryRefresh(await repositoryService.switchBranch(request.repoPath, request.branchName))
  )
  handleLogged('git:deleteBranch', {
    type: 'branch_deleted',
    actor: 'user',
    title: 'Branch deleted',
    repoPath: requestRepoPath,
    metadata: ([request]) => ({ branch: request.branchName, force: request.force })
  }, async (request: DeleteBranchRequest) =>
    withProjectMemoryRefresh(await repositoryService.deleteBranch(request.repoPath, request.branchName, request.force, request.confirmed))
  )
  handleLogged('git:createTag', {
    type: 'tag_created',
    actor: 'user',
    title: 'Tag created',
    repoPath: requestRepoPath,
    metadata: ([request]) => ({
      tag: request.tagName,
      annotated: Boolean(request.message?.trim())
    })
  }, async (request: CreateTagRequest) =>
    withProjectMemoryRefresh(await repositoryService.createTag(request))
  )
  handleLogged('git:deleteTag', {
    type: 'tag_deleted',
    actor: 'user',
    title: 'Tag deleted',
    repoPath: requestRepoPath,
    metadata: ([request]) => ({ tag: request.tagName })
  }, async (request: DeleteTagRequest) =>
    withProjectMemoryRefresh(await repositoryService.deleteTag(request))
  )
  handle('git:listWorktrees', async (repoPath: string) =>
    repositoryService.listWorktrees(repoPath)
  )
  handleLogged('git:createWorktree', {
    type: 'worktree_created',
    actor: 'user',
    title: 'Worktree created',
    repoPath: requestRepoPath,
    metadata: ([request]) => ({
      branch: request.branchName,
      base: request.baseRef ?? 'current',
      target: request.targetPath ? path.basename(request.targetPath) : 'selected'
    })
  }, async (request: CreateWorktreeRequest) => {
    const targetPath = request.targetPath ?? await chooseWorktreeTargetPath(request)

    if (!targetPath) {
      return null
    }

    return withProjectMemoryRefresh(await repositoryService.createWorktree({
      ...request,
      targetPath
    }))
  })
  handleLogged('git:removeWorktree', {
    type: 'worktree_removed',
    actor: 'user',
    title: 'Worktree removed',
    repoPath: requestRepoPath,
    metadata: ([request]) => ({
      target: path.basename(request.targetPath),
      force: Boolean(request.force)
    })
  }, async (request: RemoveWorktreeRequest) =>
    withProjectMemoryRefresh(await repositoryService.removeWorktree(request))
  )
  handle('git:listSubmodules', async (repoPath: string) =>
    repositoryService.listSubmodules(repoPath)
  )
  handleLogged('git:updateSubmodule', {
    type: 'submodule_updated',
    actor: 'user',
    title: 'Submodule updated',
    repoPath: requestRepoPath,
    metadata: ([request]) => ({
      path: request.path ?? 'all',
      init: request.init,
      recursive: request.recursive
    })
  }, async (request: UpdateSubmoduleRequest) =>
    withProjectMemoryRefresh(await repositoryService.updateSubmodule(request))
  )
  handle('git:lfsSummary', async (repoPath: string) =>
    repositoryService.getGitLfsSummary(repoPath)
  )
  handleLogged('git:lfsPull', {
    type: 'git_lfs_pulled',
    actor: 'user',
    title: 'Git LFS objects pulled',
    repoPath: repoPathArg,
    metadata: (_args, snapshot) => ({
      patterns: snapshot?.lfs.trackedPatterns.length ?? 0,
      files: snapshot?.lfs.fileCount ?? 0
    })
  }, async (repoPath: string) =>
    withProjectMemoryRefresh(await repositoryService.pullGitLfs(repoPath))
  )
  handleLogged('git:exportPatch', {
    type: 'patch_exported',
    actor: 'user',
    title: 'Patch exported',
    repoPath: requestRepoPath,
    metadata: ([request], patch) => ({
      scope: request.scope,
      bytes: patch?.bytes ?? 0,
      file: patch?.fileName ?? 'cancelled'
    })
  }, async (request: ExportPatchRequest) => {
    const outputPath = request.outputPath ?? await choosePatchOutputPath(request)

    if (!outputPath) {
      return null
    }

    return repositoryService.exportPatch({
      ...request,
      outputPath
    })
  })
  handleLogged('git:applyPatch', {
    type: 'patch_applied',
    actor: 'user',
    title: 'Patch applied',
    repoPath: requestRepoPath,
    metadata: ([request], snapshot) => ({
      file: request.patchPath ? path.basename(request.patchPath) : 'selected',
      changed: snapshot?.status.counts.changed ?? 0
    })
  }, async (request: ApplyPatchRequest) => {
    const patchPath = request.patchPath ?? await choosePatchInputPath()

    if (!patchPath) {
      return null
    }

    return withProjectMemoryRefresh(await repositoryService.applyPatch({
      ...request,
      patchPath
    }))
  })

  handleLogged('merge:acceptOurs', {
    type: 'merge_resolved',
    actor: 'user',
    title: 'Accepted ours',
    repoPath: requestRepoPath,
    metadata: ([request]) => ({ file: request.filePath, resolution: 'ours' })
  }, async (request: FileActionRequest) =>
    withProjectMemoryRefresh(await repositoryService.acceptOurs(request))
  )
  handleLogged('merge:acceptTheirs', {
    type: 'merge_resolved',
    actor: 'user',
    title: 'Accepted theirs',
    repoPath: requestRepoPath,
    metadata: ([request]) => ({ file: request.filePath, resolution: 'theirs' })
  }, async (request: FileActionRequest) =>
    withProjectMemoryRefresh(await repositoryService.acceptTheirs(request))
  )
  handleLogged('merge:markResolved', {
    type: 'merge_resolved',
    actor: 'user',
    title: 'Marked resolved',
    repoPath: requestRepoPath,
    metadata: ([request]) => ({ file: request.filePath, resolution: 'manual' })
  }, async (request: FileActionRequest) =>
    withProjectMemoryRefresh(await repositoryService.markResolved(request))
  )
  handleLogged('merge:start', {
    type: 'merge_started',
    actor: 'user',
    title: 'Merge started',
    repoPath: requestRepoPath,
    metadata: ([request], snapshot) => ({
      branch: request.branchName,
      operation: snapshot?.status.merge.operation ?? 'none',
      conflicts: snapshot?.status.merge.files.length ?? 0
    })
  }, async (request: MergeBranchRequest) =>
    withProjectMemoryRefresh(await repositoryService.mergeBranch(request))
  )
  handleLogged('merge:continue', {
    type: 'merge_continued',
    actor: 'user',
    title: 'Merge continued',
    repoPath: repoPathArg
  }, async (repoPath: string) =>
    withProjectMemoryRefresh(await repositoryService.continueMergeOperation(repoPath))
  )
  handleLogged('merge:abort', {
    type: 'merge_aborted',
    actor: 'user',
    title: 'Merge aborted',
    repoPath: repoPathArg
  }, async (repoPath: string) =>
    withProjectMemoryRefresh(await repositoryService.abortMergeOperation(repoPath))
  )

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

function withProjectMemoryRefresh(snapshot: RepositorySnapshot): RepositorySnapshot {
  // Project Memory scans can be expensive and run inside the Electron main
  // process. Keep Git actions responsive; Memory and Wiki tabs trigger scans
  // explicitly when the user asks for them.
  return snapshot
}

app.whenReady().then(() => {
  registerIpcHandlers()
  createMainWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
