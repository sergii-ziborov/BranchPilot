import { app, BrowserWindow, Menu, shell } from 'electron'
import { buildApplicationMenu } from './appMenu.js'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { AssistantPolicyService } from './lib/assistantPolicyService.js'
import { ActivityLogService } from './lib/activityLogService.js'
import { CommandRunner } from './lib/commandRunner.js'
import { DailyReviewService } from './lib/dailyReviewService.js'
import { ExternalEditorService } from './lib/editorService.js'
import { isSafeExternalUrl } from './lib/externalUrl.js'
import { ProjectMemoryService, ProjectMemoryStore } from './lib/projectMemoryService.js'
import { ProjectWikiService, ProjectWikiStore } from './lib/projectWikiService.js'
import { RepositoryService } from './lib/repositoryService.js'
import { SettingsStore } from './lib/settingsStore.js'
import { createIpcHelpers } from './ipc/ipcHelpers.js'
import { registerIpcHandlers } from './ipc/registerIpcHandlers.js'

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

  // Tell the renderer about fullscreen so it can drop the macOS traffic-light
  // inset (the controls are hidden in native fullscreen). Sent via IPC because
  // the `display-mode: fullscreen` media query is unreliable in Electron.
  const sendFullScreen = () => {
    if (!window.isDestroyed()) {
      window.webContents.send('window:fullscreen', window.isFullScreen())
    }
  }
  window.on('enter-full-screen', sendFullScreen)
  window.on('leave-full-screen', sendFullScreen)
  window.webContents.on('did-finish-load', sendFullScreen)
  window.webContents.on('dom-ready', sendFullScreen)

  Menu.setApplicationMenu(buildApplicationMenu(window))
}

app.whenReady().then(() => {
  const ipcHelpers = createIpcHelpers({ assistantPolicyService, activityLogService })
  registerIpcHandlers(ipcHelpers, {
    repositoryService, editorService, assistantPolicyService, activityLogService,
    projectMemoryService, projectWikiService, dailyReviewService, settingsStore, commandRunner,
    projectMemoryDir, projectWikiDir, activityLogDir
  })
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
