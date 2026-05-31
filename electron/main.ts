import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type {
  ApiResult,
  BranchActionRequest,
  CommitRequest,
  ConfirmedFileActionRequest,
  DeleteBranchRequest,
  DiffRequest,
  EditorOpenRequest,
  FileActionRequest,
  PublishBranchRequest
} from '../src/shared/branchPilot.js'
import { listAssistantStatuses } from './assistants/assistantRunner.js'
import { CommandRunner } from './lib/commandRunner.js'
import { ExternalEditorService } from './lib/editorService.js'
import { toBranchPilotError } from './lib/errors.js'
import { RepositoryService } from './lib/repositoryService.js'
import { SettingsStore } from './lib/settingsStore.js'
import { listProviderStatuses } from './providers/providerAdapter.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const devServerUrl = process.env.VITE_DEV_SERVER_URL
const commandRunner = new CommandRunner()
const settingsStore = new SettingsStore(path.join(app.getPath('userData'), 'branchpilot-settings.json'))
const repositoryService = new RepositoryService(commandRunner, settingsStore)
const editorService = new ExternalEditorService(commandRunner)

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

    return repositoryService.openRepository(result.filePaths[0])
  })

  handle('repository:open', (repoPath: string) => repositoryService.openRepository(repoPath))
  handle('repository:recent', () => repositoryService.getRecentRepositories())
  handle('repository:refresh', (repoPath: string) => repositoryService.getSnapshot(repoPath))
  handle('repository:diff', (request: DiffRequest) => repositoryService.getDiff(request))

  handle('git:stageFile', (request: FileActionRequest) => repositoryService.stageFile(request))
  handle('git:unstageFile', (request: FileActionRequest) => repositoryService.unstageFile(request))
  handle('git:stageAll', (repoPath: string) => repositoryService.stageAll(repoPath))
  handle('git:unstageAll', (repoPath: string) => repositoryService.unstageAll(repoPath))
  handle('git:discardFile', (request: ConfirmedFileActionRequest) => repositoryService.discardFile(request))
  handle('git:deleteUntrackedFile', (request: ConfirmedFileActionRequest) =>
    repositoryService.deleteUntrackedFile(request)
  )
  handle('git:commit', (request: CommitRequest) => repositoryService.commit(request))
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
  handle('merge:abort', (repoPath: string) => repositoryService.abortMergeOperation(repoPath))

  handle('editor:open', (request: EditorOpenRequest) => editorService.openInEditor(request.targetPath, request.line))
  handle('terminal:open', (targetPath: string) => editorService.openTerminal(targetPath))

  handle('providers:list', () => listProviderStatuses())
  handle('assistants:list', () => listAssistantStatuses(commandRunner))
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
