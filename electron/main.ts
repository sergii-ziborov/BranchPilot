import { buildApplicationMenu } from './appMenu.js'
import path from 'node:path'
import { createRequire } from 'node:module'
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

const require = createRequire(import.meta.url)
const { app, BrowserWindow, Menu, shell } = require('electron') as typeof import('electron')
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const devServerUrl = process.env.VITE_DEV_SERVER_URL
let mainWindow: import('electron').BrowserWindow | null = null

// Branding: name shown in the menu bar + About panel (defaults to "Electron").
app.setName('BranchPilot')
if (!app.requestSingleInstanceLock()) {
  app.quit()
  process.exit(0)
}

function focusMainWindow() {
  const window = mainWindow && !mainWindow.isDestroyed()
    ? mainWindow
    : BrowserWindow.getAllWindows()[0]

  if (!window) return
  if (window.isMinimized()) window.restore()
  if (!window.isVisible()) window.show()
  window.focus()
}

app.on('second-instance', focusMainWindow)

// Resolve the app icon for the About panel + dock (dev uses the repo build/ asset).
const brandIconPath = path.join(__dirname, '..', 'build', 'icon.png')
app.setAboutPanelOptions({
  applicationName: 'BranchPilot',
  applicationVersion: app.getVersion(),
  version: app.getVersion(),
  copyright: '© 2026 Serhii Ziborov · MIT License',
  authors: ['Serhii Ziborov'],
  website: 'https://github.com/serhii-ziborov/BranchPilot',
  iconPath: brandIconPath,
  credits: 'BranchPilot — a fast, local-first Git desktop client.\nBuilt by Serhii Ziborov. Commit, branch, review and ship without leaving your machine.'
})
// In dev the dock would otherwise show the generic Electron atom.
if (process.platform === 'darwin' && app.dock) {
  try {
    app.dock.setIcon(brandIconPath)
  } catch {
    /* icon optional — ignore if missing */
  }
}
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
  if (mainWindow && !mainWindow.isDestroyed()) {
    focusMainWindow()
    return mainWindow
  }

  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 980,
    minHeight: 680,
    title: 'BranchPilot',
    backgroundColor: '#f6f7f9',
    autoHideMenuBar: process.platform !== 'darwin',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    titleBarOverlay: process.platform === 'darwin'
      ? undefined
      : {
          color: '#f8fafc',
          symbolColor: '#0f172a',
          height: 32
        },
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  mainWindow = window

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
  window.webContents.on('did-fail-load', (_event, code, description, validatedUrl) => {
    console.error(`[BranchPilot] failed to load ${validatedUrl}: ${code} ${description}`)
  })
  window.webContents.on('render-process-gone', (_event, details) => {
    console.error(`[BranchPilot] renderer process gone: ${details.reason}`)
  })
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null
  })

  Menu.setApplicationMenu(buildApplicationMenu(window))
  if (process.platform !== 'darwin') {
    window.setMenuBarVisibility(false)
  }

  return window
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
    } else {
      focusMainWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
