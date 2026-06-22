import { readdirSync } from 'node:fs'
import path from 'node:path'
import type { EditorPreference, EditorSettings, GitOperationResult } from '../../src/shared/branchPilot.js'
import { CommandRunner } from './commandRunner.js'
import { BranchPilotUserError } from './errors.js'

const DEFAULT_EDITOR_SETTINGS: EditorSettings = {
  preference: 'vscode'
}

interface EditorPreset {
  preference: Exclude<EditorPreference, 'auto' | 'custom'>
  label: string
  cli: string
  macAppName: string
}

interface ExternalEditorServiceOptions {
  platform?: NodeJS.Platform
  env?: NodeJS.ProcessEnv
}

const EDITOR_PRESETS: EditorPreset[] = [
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

export class ExternalEditorService {
  constructor(
    private readonly runner: CommandRunner,
    private readonly options: ExternalEditorServiceOptions = {}
  ) {}

  async openInEditor(
    targetPath: string,
    line?: number,
    settings: EditorSettings = DEFAULT_EDITOR_SETTINGS
  ): Promise<GitOperationResult> {
    const codePath = line ? `${targetPath}:${line}` : targetPath

    if (settings.preference === 'custom') {
      return this.openWithCustomCommand(targetPath, codePath, settings.customCommand)
    }

    if (settings.preference === 'auto') {
      const openedWithCli = await this.openFirstAvailableCli(EDITOR_PRESETS, targetPath, line)

      if (openedWithCli) {
        return { message: `Opened in ${openedWithCli.label}` }
      }

      const openedWithStandardLocation = await this.openFirstAvailableStandardLocation(EDITOR_PRESETS, targetPath, line)

      if (openedWithStandardLocation) {
        return { message: `Opened in ${openedWithStandardLocation.label}` }
      }

      const openedWithApp = await this.openFirstAvailableMacApp(EDITOR_PRESETS, targetPath)

      if (openedWithApp) {
        return { message: `Opened in ${openedWithApp.label}` }
      }
    } else {
      const preset = EDITOR_PRESETS.find((candidate) => candidate.preference === settings.preference)

      if (preset && await this.openWithPreset(preset, targetPath, line)) {
        return { message: `Opened in ${preset.label}` }
      }
    }

    throw new BranchPilotUserError(
      'editor_open_failed',
      editorFailureMessage(settings.preference),
      settings.preference === 'auto'
        ? 'Tried VS Code, Cursor, WebStorm, Rider, and Sublime Text.'
        : undefined
    )
  }

  async openTerminal(targetPath: string): Promise<GitOperationResult> {
    if (process.platform === 'win32') {
      if (await this.tryCommand('wt.exe', ['-d', targetPath])) {
        return { message: 'Opened Windows Terminal' }
      }

      if (await this.tryCommand('cmd.exe', [
        '/d',
        '/c',
        'start',
        '',
        'powershell.exe',
        '-NoExit',
        '-Command',
        `Set-Location -LiteralPath ${quotePowerShellString(targetPath)}`
      ])) {
        return { message: 'Opened PowerShell' }
      }
    } else if (process.platform === 'darwin') {
      if (await this.tryCommand('/usr/bin/open', ['-a', 'Terminal', targetPath])) {
        return { message: 'Opened Terminal' }
      }
    } else {
      const linuxCommands: Array<{ command: string; args: string[]; label: string }> = [
        { command: 'x-terminal-emulator', args: ['--working-directory', targetPath], label: 'terminal' },
        { command: 'gnome-terminal', args: [`--working-directory=${targetPath}`], label: 'GNOME Terminal' },
        { command: 'konsole', args: ['--workdir', targetPath], label: 'Konsole' }
      ]

      for (const candidate of linuxCommands) {
        if (await this.tryCommand(candidate.command, candidate.args)) {
          return { message: `Opened ${candidate.label}` }
        }
      }
    }

    throw new BranchPilotUserError(
      'terminal_open_failed',
      process.platform === 'win32'
        ? 'Could not open Windows Terminal or PowerShell.'
        : 'Could not open a terminal at this path.'
    )
  }

  private async tryCommand(command: string, args: string[]): Promise<boolean> {
    try {
      await this.runner.run(command, args, { timeoutMs: 10_000 })
      return true
    } catch {
      return false
    }
  }

  private async openWithPreset(preset: EditorPreset, targetPath: string, line?: number): Promise<boolean> {
    const args = buildEditorArgs(preset.preference, targetPath, line)

    if (await this.tryCommand(preset.cli, args)) {
      return true
    }

    for (const command of getStandardEditorCommands(preset.preference, this.platform(), this.env())) {
      if (await this.tryCommand(command, args)) {
        return true
      }
    }

    return this.platform() === 'darwin'
      ? this.tryCommand('/usr/bin/open', ['-a', preset.macAppName, targetPath])
      : false
  }

  private async openFirstAvailableCli(presets: EditorPreset[], targetPath: string, line?: number): Promise<EditorPreset | null> {
    for (const preset of presets) {
      if (await this.tryCommand(preset.cli, buildEditorArgs(preset.preference, targetPath, line))) {
        return preset
      }
    }

    return null
  }

  private async openFirstAvailableStandardLocation(
    presets: EditorPreset[],
    targetPath: string,
    line?: number
  ): Promise<EditorPreset | null> {
    for (const preset of presets) {
      const args = buildEditorArgs(preset.preference, targetPath, line)

      for (const command of getStandardEditorCommands(preset.preference, this.platform(), this.env())) {
        if (await this.tryCommand(command, args)) {
          return preset
        }
      }
    }

    return null
  }

  private async openFirstAvailableMacApp(presets: EditorPreset[], targetPath: string): Promise<EditorPreset | null> {
    if (this.platform() !== 'darwin') {
      return null
    }

    for (const preset of presets) {
      if (await this.tryCommand('/usr/bin/open', ['-a', preset.macAppName, targetPath])) {
        return preset
      }
    }

    return null
  }

  private platform(): NodeJS.Platform {
    return this.options.platform ?? process.platform
  }

  private env(): NodeJS.ProcessEnv {
    return this.options.env ?? process.env
  }

  private async openWithCustomCommand(
    targetPath: string,
    codePath: string,
    commandTemplate: string | undefined
  ): Promise<GitOperationResult> {
    const parsed = parseCommandTemplate(commandTemplate)

    if (!parsed) {
      throw new BranchPilotUserError(
        'editor_custom_command_missing',
        'Custom editor command is empty. Configure a command with %TARGET_PATH% or switch back to Auto.'
      )
    }

    const targetToken = commandTemplate?.includes('%TARGET_PATH%') ? codePath : targetPath
    const args = parsed.args.map((arg) => arg.replaceAll('%TARGET_PATH%', codePath))

    if (!commandTemplate?.includes('%TARGET_PATH%')) {
      args.push(targetToken)
    }

    try {
      await this.runner.run(parsed.command, args, { timeoutMs: 10_000 })
    } catch (error) {
      throw new BranchPilotUserError(
        'editor_open_failed',
        'Could not open the configured custom editor command.',
        error instanceof Error ? error.message : undefined
      )
    }

    return { message: 'Opened with custom editor command' }
  }
}

function buildEditorArgs(
  preference: Exclude<EditorPreference, 'auto' | 'custom'>,
  targetPath: string,
  line?: number
): string[] {
  if (!line) {
    return [targetPath]
  }

  const targetWithLine = `${targetPath}:${line}`

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

function envValue(env: NodeJS.ProcessEnv, key: string): string | undefined {
  if (env[key]) {
    return env[key]
  }

  const foundKey = Object.keys(env).find((candidate) => candidate.toLowerCase() === key.toLowerCase())

  return foundKey ? env[foundKey] : undefined
}

function winJoin(...parts: string[]): string {
  return path.win32.join(...parts)
}

function posixJoin(...parts: string[]): string {
  return path.posix.join(...parts)
}

function uniqueCommands(values: Array<string | undefined | false>, platform: NodeJS.Platform): string[] {
  const seen = new Set<string>()
  const commands: string[] = []

  for (const value of values) {
    if (!value) {
      continue
    }

    const key = platform === 'win32' ? value.toLowerCase() : value

    if (seen.has(key)) {
      continue
    }

    seen.add(key)
    commands.push(value)
  }

  return commands
}

function editorFailureMessage(preference: EditorPreference): string {
  if (preference === 'auto') {
    return 'Could not open any supported editor.'
  }

  const preset = EDITOR_PRESETS.find((candidate) => candidate.preference === preference)
  return preset ? `Could not open ${preset.label}.` : 'Could not open the configured editor.'
}

function parseCommandTemplate(commandTemplate: string | undefined): { command: string; args: string[] } | null {
  const tokens = splitCommandTemplate(commandTemplate?.trim() ?? '')
  const [command, ...args] = tokens

  return command ? { command, args } : null
}

function splitCommandTemplate(value: string): string[] {
  const tokens: string[] = []
  let current = ''
  let quote: '"' | '\'' | null = null
  let escaped = false

  for (const character of value) {
    if (escaped) {
      current += character
      escaped = false
      continue
    }

    if (character === '\\') {
      escaped = true
      continue
    }

    if (quote) {
      if (character === quote) {
        quote = null
      } else {
        current += character
      }
      continue
    }

    if (character === '"' || character === '\'') {
      quote = character
      continue
    }

    if (/\s/.test(character)) {
      if (current) {
        tokens.push(current)
        current = ''
      }
      continue
    }

    current += character
  }

  if (escaped) {
    current += '\\'
  }

  if (current) {
    tokens.push(current)
  }

  return tokens
}

function quotePowerShellString(value: string): string {
  return `'${value.replaceAll('\'', '\'\'')}'`
}
