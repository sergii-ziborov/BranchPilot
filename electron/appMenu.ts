import { createRequire } from 'node:module'
import type { BrowserWindow, Menu as ElectronMenu, MenuItemConstructorOptions } from 'electron'

const require = createRequire(import.meta.url)
const { Menu, shell } = require('electron') as typeof import('electron')
const isMac = process.platform === 'darwin'
const APP_NAME = 'BranchPilot'
const GITHUB_REPOSITORY_URL = 'https://github.com/sergii-ziborov/BranchPilot'

function emit(window: BrowserWindow, action: string) {
  window.webContents.send('menu:action', action)
}

/** GitHub-Desktop-style application menu. Custom items emit `menu:action` to the renderer. */
export function buildApplicationMenu(window: BrowserWindow): ElectronMenu {
  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [{
          label: APP_NAME,
          submenu: [
            { label: `About ${APP_NAME}`, click: () => emit(window, 'show-about') },
            { type: 'separator' as const },
            { label: 'Settings…', accelerator: 'Cmd+,', click: () => emit(window, 'view-config') },
            { type: 'separator' as const },
            { role: 'services' as const },
            { type: 'separator' as const },
            { label: `Hide ${APP_NAME}`, role: 'hide' as const },
            { role: 'hideOthers' as const },
            { role: 'unhide' as const },
            { type: 'separator' as const },
            { label: `Quit ${APP_NAME}`, role: 'quit' as const }
          ]
        }]
      : []),
    {
      label: 'File',
      submenu: [
        { label: 'Open Repository…', accelerator: 'CmdOrCtrl+O', click: () => emit(window, 'open-repository') },
        { label: 'Clone Repository…', accelerator: 'CmdOrCtrl+Shift+O', click: () => emit(window, 'clone-repository') },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' }
      ]
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { label: 'Changes', accelerator: 'CmdOrCtrl+1', click: () => emit(window, 'view-changes') },
        { label: 'History', accelerator: 'CmdOrCtrl+2', click: () => emit(window, 'view-history') },
        { type: 'separator' },
        { label: 'Pull Requests and Providers', accelerator: 'CmdOrCtrl+3', click: () => emit(window, 'view-providers') },
        { label: 'Daily Review', accelerator: 'CmdOrCtrl+4', click: () => emit(window, 'view-daily') },
        { label: 'LinkedIn Project', accelerator: 'CmdOrCtrl+5', click: () => emit(window, 'view-linkedin') },
        { label: 'Settings', accelerator: 'CmdOrCtrl+,', click: () => emit(window, 'view-config') },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Repository',
      submenu: [
        { label: 'Fetch from Remote', accelerator: 'CmdOrCtrl+Shift+F', click: () => emit(window, 'fetch') },
        { label: 'Pull Current Branch', accelerator: 'CmdOrCtrl+Shift+P', click: () => emit(window, 'pull') },
        { label: 'Push Current Branch', accelerator: 'CmdOrCtrl+P', click: () => emit(window, 'push') },
        { type: 'separator' },
        { label: 'Refresh Repository', accelerator: 'CmdOrCtrl+Alt+R', click: () => emit(window, 'refresh') },
        { label: 'Open Repository in Editor', accelerator: 'CmdOrCtrl+Shift+A', click: () => emit(window, 'open-in-editor') },
        { label: 'Open Repository in Terminal', accelerator: 'CmdOrCtrl+`', click: () => emit(window, 'open-in-terminal') },
        { type: 'separator' },
        { label: 'Repository Settings…', click: () => emit(window, 'view-config') }
      ]
    },
    {
      label: 'Branch',
      submenu: [
        { label: 'Review Changes', click: () => emit(window, 'view-review') }
      ]
    },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        { label: `${APP_NAME} on GitHub`, click: () => void shell.openExternal(GITHUB_REPOSITORY_URL) },
        { label: 'Report an Issue', click: () => void shell.openExternal(`${GITHUB_REPOSITORY_URL}/issues`) },
        ...(!isMac ? [{ label: `About ${APP_NAME}`, click: () => emit(window, 'show-about') }] : [])
      ]
    }
  ]

  return Menu.buildFromTemplate(template)
}
