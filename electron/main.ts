import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type {
  ApiResult,
  BranchActionRequest,
  CheckoutPullRequestRequest,
  CommitDetailsRequest,
  CommitFileDiffRequest,
  CommitMessageGenerationRequest,
  CommitRequest,
  ConfirmedStashActionRequest,
  ConfirmedFileActionRequest,
  CreateStashRequest,
  CreatePullRequestRequest,
  DeleteBranchRequest,
  DiffRequest,
  EditorOpenRequest,
  FileActionRequest,
  GitIdentityUpdate,
  HunkActionRequest,
  MergeBranchRequest,
  ProjectMemoryScanResult,
  PullRequestDetailsRequest,
  PullRequestTextGenerationRequest,
  PublishBranchRequest,
  RepositorySnapshot,
  ReviewReportRequest,
  StashActionRequest
} from '../src/shared/branchPilot.js'
import { generateCommitMessage, generatePullRequestText, generateReviewReport, listAssistantStatuses } from './assistants/assistantRunner.js'
import { CommandRunner } from './lib/commandRunner.js'
import { ExternalEditorService } from './lib/editorService.js'
import { toBranchPilotError } from './lib/errors.js'
import { ProjectMemoryService, ProjectMemoryStore } from './lib/projectMemoryService.js'
import { RepositoryService } from './lib/repositoryService.js'
import { SettingsStore } from './lib/settingsStore.js'
import {
  checkoutGitHubPullRequest,
  createGitHubPullRequest,
  getCurrentBranchPullRequest,
  getGitHubCliStatus,
  getGitHubPullRequestChecks,
  getGitHubPullRequestDetails,
  getGitHubPullRequestDiff,
  listGitHubPullRequests
} from './providers/githubCliService.js'
import { listProviderStatuses } from './providers/providerAdapter.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const devServerUrl = process.env.VITE_DEV_SERVER_URL
const commandRunner = new CommandRunner()
const settingsStore = new SettingsStore(path.join(app.getPath('userData'), 'branchpilot-settings.json'))
const repositoryService = new RepositoryService(commandRunner, settingsStore)
const editorService = new ExternalEditorService(commandRunner)
const projectMemoryService = new ProjectMemoryService(
  commandRunner,
  new ProjectMemoryStore(path.join(app.getPath('userData'), 'project-memory'))
)

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
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  if (devServerUrl) {
    void window.loadURL(devServerUrl)
    window.webContents.openDevTools({ mode: 'detach' })
  } else {
    void window.loadFile(path.join(__dirname, '../../dist/index.html'))
  }

  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })
}

function handle<Args extends unknown[], T>(channel: string, callback: (...args: Args) => Promise<T> | T) {
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

function registerIpcHandlers() {
  ipcMain.handle('app:version', () => app.getVersion())

  handle('repository:chooseAndOpen', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Open repository',
      properties: ['openDirectory']
    })

    if (result.canceled || result.filePaths.length === 0) {
      return null
    }

    return withProjectMemoryRefresh(await repositoryService.openRepository(result.filePaths[0]))
  })

  handle('repository:open', async (repoPath: string) =>
    withProjectMemoryRefresh(await repositoryService.openRepository(repoPath))
  )
  handle('repository:recent', () => repositoryService.getRecentRepositories())
  handle('repository:refresh', (repoPath: string) => repositoryService.getSnapshot(repoPath))
  handle('repository:diff', (request: DiffRequest) => repositoryService.getDiff(request))
  handle('repository:history', (repoPath: string) => repositoryService.getHistory(repoPath))
  handle('repository:commitDetails', (request: CommitDetailsRequest) => repositoryService.getCommitDetails(request))
  handle('repository:commitFileDiff', (request: CommitFileDiffRequest) => repositoryService.getCommitFileDiff(request))
  handle('repository:projectMemory', (repoPath: string) => projectMemoryService.getProjectMemory(repoPath))
  handle('repository:scanProjectMemory', (repoPath: string): Promise<ProjectMemoryScanResult> =>
    projectMemoryService.scanProjectMemory(repoPath)
  )
  handle('repository:gitConfig', (repoPath: string) => repositoryService.getGitConfig(repoPath))
  handle('repository:setLocalGitIdentity', (request: GitIdentityUpdate) => repositoryService.setLocalGitIdentity(request))

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
  handle('git:commit', async (request: CommitRequest) =>
    withProjectMemoryRefresh(await repositoryService.commit(request))
  )
  handle('stash:list', (repoPath: string) => repositoryService.listStashes(repoPath))
  handle('stash:create', (request: CreateStashRequest) => repositoryService.createStash(request))
  handle('stash:apply', (request: StashActionRequest) => repositoryService.applyStash(request))
  handle('stash:drop', (request: ConfirmedStashActionRequest) => repositoryService.dropStash(request))
  handle('git:fetch', (repoPath: string) => repositoryService.fetch(repoPath))
  handle('git:pull', (repoPath: string) => repositoryService.pull(repoPath))
  handle('git:push', (repoPath: string) => repositoryService.push(repoPath))
  handle('git:publishBranch', (request: PublishBranchRequest) => repositoryService.publishBranch(request))
  handle('git:createBranch', (request: BranchActionRequest) =>
    repositoryService.createBranch(request.repoPath, request.branchName)
  )
  handle('git:switchBranch', (request: BranchActionRequest) =>
    repositoryService.switchBranch(request.repoPath, request.branchName)
  )
  handle('git:deleteBranch', (request: DeleteBranchRequest) =>
    repositoryService.deleteBranch(request.repoPath, request.branchName, request.force)
  )

  handle('merge:acceptOurs', (request: FileActionRequest) => repositoryService.acceptOurs(request))
  handle('merge:acceptTheirs', (request: FileActionRequest) => repositoryService.acceptTheirs(request))
  handle('merge:markResolved', (request: FileActionRequest) => repositoryService.markResolved(request))
  handle('merge:start', (request: MergeBranchRequest) => repositoryService.mergeBranch(request))
  handle('merge:continue', (repoPath: string) => repositoryService.continueMergeOperation(repoPath))
  handle('merge:abort', (repoPath: string) => repositoryService.abortMergeOperation(repoPath))

  handle('editor:open', (request: EditorOpenRequest) => editorService.openInEditor(request.targetPath, request.line))
  handle('terminal:open', (targetPath: string) => editorService.openTerminal(targetPath))

  handle('providers:list', () => listProviderStatuses(commandRunner))
  handle('providers:githubCliStatus', (repoPath?: string) => getGitHubCliStatus(commandRunner, repoPath))
  handle('providers:createGitHubPullRequest', (request: CreatePullRequestRequest) =>
    createGitHubPullRequest(commandRunner, request)
  )
  handle('providers:currentGitHubPullRequest', (repoPath: string) =>
    getCurrentBranchPullRequest(commandRunner, repoPath)
  )
  handle('providers:listGitHubPullRequests', (repoPath: string) =>
    listGitHubPullRequests(commandRunner, repoPath)
  )
  handle('providers:getGitHubPullRequestDetails', (request: PullRequestDetailsRequest) =>
    getGitHubPullRequestDetails(commandRunner, request)
  )
  handle('providers:getGitHubPullRequestChecks', (request: PullRequestDetailsRequest) =>
    getGitHubPullRequestChecks(commandRunner, request)
  )
  handle('providers:getGitHubPullRequestDiff', (request: PullRequestDetailsRequest) =>
    getGitHubPullRequestDiff(commandRunner, request)
  )
  handle('providers:checkoutGitHubPullRequest', async (request: CheckoutPullRequestRequest) => {
    const rootPath = await checkoutGitHubPullRequest(commandRunner, request)
    return repositoryService.getSnapshot(rootPath)
  })
  handle('assistants:list', () => listAssistantStatuses(commandRunner))
  handle('assistants:generateCommitMessage', (request: CommitMessageGenerationRequest) =>
    generateCommitMessage(commandRunner, request)
  )
  handle('assistants:generatePullRequestText', (request: PullRequestTextGenerationRequest) =>
    generatePullRequestText(commandRunner, request)
  )
  handle('assistants:generateReviewReport', (request: ReviewReportRequest) =>
    generateReviewReport(commandRunner, request)
  )
}

function withProjectMemoryRefresh(snapshot: RepositorySnapshot): RepositorySnapshot {
  void projectMemoryService.scanProjectMemory(snapshot.summary.rootPath).catch((error: unknown) => {
    console.error('Project Memory refresh failed', error)
  })

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
