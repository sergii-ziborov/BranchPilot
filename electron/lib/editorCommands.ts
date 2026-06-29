import { readdirSync } from 'node:fs'
import type { EditorPreference } from '../../src/shared/branchPilot.js'
import { envValue, posixJoin, uniqueCommands, winJoin } from './editorCommandUtils.js'

export interface EditorPreset {
  preference: Exclude<EditorPreference, 'auto' | 'custom'>
  label: string
  cli: string
  macAppName: string
}

export const EDITOR_PRESETS: EditorPreset[] = [
  {
    preference: 'vscode',
    label: 'Visual Studio Code',
    cli: 'code',
    macAppName: 'Visual Studio Code'
  },
  {
    preference: 'cursor',
    label: 'Cursor',
    cli: 'cursor',
    macAppName: 'Cursor'
  },
  {
    preference: 'webstorm',
    label: 'WebStorm',
    cli: 'webstorm',
    macAppName: 'WebStorm'
  },
  {
    preference: 'rider',
    label: 'Rider',
    cli: 'rider',
    macAppName: 'Rider'
  },
  {
    preference: 'sublime',
    label: 'Sublime Text',
    cli: 'subl',
    macAppName: 'Sublime Text'
  }
]

export function buildEditorArgs(
  preference: Exclude<EditorPreference, 'auto' | 'custom'>,
  targetPath: string,
  line?: number,
  column?: number
): string[] {
  if (!line) {
    return [targetPath]
  }

  const targetWithLine = column ? `${targetPath}:${line}:${column}` : `${targetPath}:${line}`

  if (preference === 'vscode' || preference === 'cursor') {
    return ['--goto', targetWithLine]
  }

  if (preference === 'webstorm' || preference === 'rider') {
    return ['--line', String(line), targetPath]
  }

  return [targetWithLine]
}

export function getStandardEditorCommands(
  preference: Exclude<EditorPreference, 'auto' | 'custom'>,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env
): string[] {
  if (platform === 'win32') {
    return getWindowsEditorCommands(preference, env)
  }

  if (platform === 'darwin') {
    return getMacEditorCommands(preference, env)
  }

  return getLinuxEditorCommands(preference)
}

function getWindowsEditorCommands(
  preference: Exclude<EditorPreference, 'auto' | 'custom'>,
  env: NodeJS.ProcessEnv
): string[] {
  const localAppData = envValue(env, 'LOCALAPPDATA')
  const userProfile = envValue(env, 'USERPROFILE')
  const programRoots = uniqueCommands([
    envValue(env, 'ProgramFiles'),
    envValue(env, 'ProgramW6432'),
    envValue(env, 'ProgramFiles(x86)')
  ], 'win32')

  if (preference === 'vscode') {
    return uniqueCommands([
      localAppData && winJoin(localAppData, 'Programs', 'Microsoft VS Code', 'bin', 'code.cmd'),
      localAppData && winJoin(localAppData, 'Programs', 'Microsoft VS Code Insiders', 'bin', 'code-insiders.cmd'),
      localAppData && winJoin(localAppData, 'Programs', 'VSCodium', 'bin', 'codium.cmd'),
      localAppData && winJoin(localAppData, 'Programs', 'Microsoft VS Code', 'Code.exe'),
      localAppData && winJoin(localAppData, 'Programs', 'Microsoft VS Code Insiders', 'Code - Insiders.exe'),
      localAppData && winJoin(localAppData, 'Programs', 'VSCodium', 'VSCodium.exe'),
      localAppData && winJoin(localAppData, 'Microsoft', 'WindowsApps', 'code.exe'),
      localAppData && winJoin(localAppData, 'Microsoft', 'WindowsApps', 'code-insiders.exe'),
      userProfile && winJoin(userProfile, 'scoop', 'apps', 'vscode', 'current', 'Code.exe'),
      userProfile && winJoin(userProfile, 'scoop', 'apps', 'vscode-insiders', 'current', 'Code - Insiders.exe'),
      userProfile && winJoin(userProfile, 'scoop', 'apps', 'vscodium', 'current', 'VSCodium.exe'),
      userProfile && winJoin(userProfile, 'scoop', 'shims', 'code.cmd'),
      userProfile && winJoin(userProfile, 'scoop', 'shims', 'code-insiders.cmd'),
      ...programRoots.flatMap((root) => [
        winJoin(root, 'Microsoft VS Code', 'Code.exe'),
        winJoin(root, 'Microsoft VS Code Insiders', 'Code - Insiders.exe'),
        winJoin(root, 'VSCodium', 'VSCodium.exe')
      ])
    ], 'win32')
  }

  if (preference === 'cursor') {
    return uniqueCommands([
      localAppData && winJoin(localAppData, 'Programs', 'Cursor', 'resources', 'app', 'bin', 'cursor.cmd'),
      localAppData && winJoin(localAppData, 'Programs', 'Cursor', 'Cursor.exe'),
      localAppData && winJoin(localAppData, 'Microsoft', 'WindowsApps', 'cursor.exe'),
      userProfile && winJoin(userProfile, 'scoop', 'apps', 'cursor', 'current', 'Cursor.exe'),
      userProfile && winJoin(userProfile, 'scoop', 'shims', 'cursor.cmd'),
      ...programRoots.map((root) => winJoin(root, 'Cursor', 'Cursor.exe'))
    ], 'win32')
  }

  if (preference === 'webstorm') {
    return uniqueCommands([
      localAppData && winJoin(localAppData, 'JetBrains', 'Toolbox', 'scripts', 'webstorm.cmd'),
      localAppData && winJoin(localAppData, 'Programs', 'WebStorm', 'bin', 'webstorm64.exe'),
      userProfile && winJoin(userProfile, 'scoop', 'shims', 'webstorm.cmd'),
      ...programRoots.map((root) => winJoin(root, 'JetBrains', 'WebStorm', 'bin', 'webstorm64.exe')),
      ...findWindowsJetBrainsBins(programRoots, ['WebStorm'], 'webstorm64.exe')
    ], 'win32')
  }

  if (preference === 'rider') {
    return uniqueCommands([
      localAppData && winJoin(localAppData, 'JetBrains', 'Toolbox', 'scripts', 'rider.cmd'),
      localAppData && winJoin(localAppData, 'Programs', 'Rider', 'bin', 'rider64.exe'),
      userProfile && winJoin(userProfile, 'scoop', 'shims', 'rider.cmd'),
      ...programRoots.map((root) => winJoin(root, 'JetBrains', 'JetBrains Rider', 'bin', 'rider64.exe')),
      ...findWindowsJetBrainsBins(programRoots, ['Rider', 'JetBrains Rider'], 'rider64.exe')
    ], 'win32')
  }

  return uniqueCommands([
    localAppData && winJoin(localAppData, 'Programs', 'Sublime Text', 'sublime_text.exe'),
    userProfile && winJoin(userProfile, 'scoop', 'apps', 'sublime-text', 'current', 'sublime_text.exe'),
    userProfile && winJoin(userProfile, 'scoop', 'shims', 'subl.cmd'),
    ...programRoots.flatMap((root) => [
      winJoin(root, 'Sublime Text', 'sublime_text.exe'),
      winJoin(root, 'Sublime Text 4', 'sublime_text.exe'),
      winJoin(root, 'Sublime Text 3', 'sublime_text.exe')
    ])
  ], 'win32')
}

function getMacEditorCommands(
  preference: Exclude<EditorPreference, 'auto' | 'custom'>,
  env: NodeJS.ProcessEnv
): string[] {
  const home = envValue(env, 'HOME')
  const applicationRoots = home ? ['/Applications', posixJoin(home, 'Applications')] : ['/Applications']
  const binRoots = ['/usr/local/bin', '/opt/homebrew/bin']

  if (preference === 'vscode') {
    return uniqueCommands([
      ...binRoots.map((root) => posixJoin(root, 'code')),
      ...binRoots.map((root) => posixJoin(root, 'code-insiders')),
      ...binRoots.map((root) => posixJoin(root, 'codium')),
      ...applicationRoots.map((root) => posixJoin(root, 'Visual Studio Code.app', 'Contents', 'Resources', 'app', 'bin', 'code')),
      ...applicationRoots.map((root) => posixJoin(root, 'Visual Studio Code - Insiders.app', 'Contents', 'Resources', 'app', 'bin', 'code')),
      ...applicationRoots.map((root) => posixJoin(root, 'VSCodium.app', 'Contents', 'Resources', 'app', 'bin', 'codium'))
    ], 'darwin')
  }

  if (preference === 'cursor') {
    return uniqueCommands([
      ...binRoots.map((root) => posixJoin(root, 'cursor')),
      ...applicationRoots.map((root) => posixJoin(root, 'Cursor.app', 'Contents', 'Resources', 'app', 'bin', 'cursor'))
    ], 'darwin')
  }

  if (preference === 'webstorm') {
    return uniqueCommands([
      ...binRoots.map((root) => posixJoin(root, 'webstorm')),
      ...applicationRoots.map((root) => posixJoin(root, 'WebStorm.app', 'Contents', 'MacOS', 'webstorm'))
    ], 'darwin')
  }

  if (preference === 'rider') {
    return uniqueCommands([
      ...binRoots.map((root) => posixJoin(root, 'rider')),
      ...applicationRoots.map((root) => posixJoin(root, 'Rider.app', 'Contents', 'MacOS', 'rider'))
    ], 'darwin')
  }

  return uniqueCommands([
    ...binRoots.map((root) => posixJoin(root, 'subl')),
    ...applicationRoots.map((root) => posixJoin(root, 'Sublime Text.app', 'Contents', 'SharedSupport', 'bin', 'subl')),
    ...applicationRoots.map((root) => posixJoin(root, 'Sublime Text.app', 'Contents', 'MacOS', 'sublime_text'))
  ], 'darwin')
}

function getLinuxEditorCommands(preference: Exclude<EditorPreference, 'auto' | 'custom'>): string[] {
  const commandName = preference === 'sublime' ? 'subl' : EDITOR_PRESETS.find((preset) => preset.preference === preference)?.cli

  if (!commandName) {
    return []
  }

  const linuxBinRoots = ['/usr/local/bin', '/usr/bin', '/snap/bin', '/var/lib/flatpak/exports/bin']

  return uniqueCommands(linuxBinRoots.map((root) => posixJoin(root, commandName)), 'linux')
}

function findWindowsJetBrainsBins(programRoots: string[], productNames: string[], executableName: string): string[] {
  const commands: string[] = []

  for (const programRoot of programRoots) {
    const jetBrainsRoot = winJoin(programRoot, 'JetBrains')
    let entries: string[]

    try {
      entries = readdirSync(jetBrainsRoot)
    } catch {
      continue
    }

    for (const entry of entries) {
      if (!productNames.some((productName) => entry.toLowerCase().includes(productName.toLowerCase()))) {
        continue
      }

      commands.push(winJoin(jetBrainsRoot, entry, 'bin', executableName))
    }
  }

  return commands
}
