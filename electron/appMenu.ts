import { createRequire } from 'node:module'
import type { BrowserWindow, Menu as ElectronMenu, MenuItemConstructorOptions } from 'electron'

const require = createRequire(import.meta.url)
const { app, Menu, shell } = require('electron') as typeof import('electron')
const isMac = process.platform === 'darwin'

function emit(window: BrowserWindow, action: string) {
  window.webContents.send('menu:action', action)
}

/** GitHub-Desktop-style application menu. Custom items emit `menu:action` to the renderer. */
export function buildApplicationMenu(window: BrowserWindow): ElectronMenu {
  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [{
          label: app.name,
          submenu: [
            { label: 'About BranchPilot', click: () => emit(window, 'show-about') },
            { type: 'separator' as const },
            { label: 'Settings…', accelerator: 'Cmd+,', click: () => emit(window, 'view-config') },
            { type: 'separator' as const },
            { role: 'services' as const },
            { type: 'separator' as const },
            { role: 'hide' as const },
            { role: 'hideOthers' as const },
            { role: 'unhide' as const },
            { type: 'separator' as const },
            { role: 'quit' as const }
          ]
        }]
      : []),
    {
      label: 'File',
      submenu: [
        { label: 'Open repository…', accelerator: 'CmdOrCtrl+O', click: () => emit(window, 'open-repository') },
        { label: 'Clone repository…', accelerator: 'CmdOrCtrl+Shift+O', click: () => emit(window, 'clone-repository') },
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
        { label: 'Dashboard', accelerator: 'CmdOrCtrl+3', click: () => emit(window, 'view-dashboard') },
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
        { label: 'Push', accelerator: 'CmdOrCtrl+P', click: () => emit(window, 'push') },
        { label: 'Pull', accelerator: 'CmdOrCtrl+Shift+P', click: () => emit(window, 'pull') },
        { label: 'Fetch', accelerator: 'CmdOrCtrl+Shift+T', click: () => emit(window, 'fetch') },
        { type: 'separator' },
        { label: 'Refresh', accelerator: 'CmdOrCtrl+Shift+R', click: () => emit(window, 'refresh') },
        { label: 'Open in editor', accelerator: 'CmdOrCtrl+Shift+A', click: () => emit(window, 'open-in-editor') },
        { label: 'Open in terminal', accelerator: 'CmdOrCtrl+`', click: () => emit(window, 'open-in-terminal') },
        { type: 'separator' },
        { label: 'Repository settings', click: () => emit(window, 'view-config') }
      ]
    },
    {
      label: 'Branch',
      submenu: [
        { label: 'New branch…', accelerator: 'CmdOrCtrl+Shift+N', click: () => emit(window, 'new-branch') },
        { label: 'Manage branches', click: () => emit(window, 'view-branches') },
        { label: 'Merge into current branch…', click: () => emit(window, 'view-merge') },
        { label: 'Review changes', click: () => emit(window, 'view-review') }
      ]
    },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        { label: 'BranchPilot on GitHub', click: () => void shell.openExternal('https://github.com') },
        ...(!isMac ? [{ label: 'About BranchPilot', click: () => emit(window, 'show-about') }] : [])
      ]
    }
  ]

  return Menu.buildFromTemplate(template)
}
