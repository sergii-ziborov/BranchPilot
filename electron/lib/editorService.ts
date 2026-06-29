import fs from 'node:fs/promises'
import type { EditorPreference, EditorSettings, GitOperationResult, TerminalSettings } from '../../src/shared/branchPilot.js'
import { CommandRunner } from './commandRunner.js'
import {
  EDITOR_PRESETS,
  buildEditorArgs,
  getStandardEditorCommands,
  type EditorPreset
} from './editorCommands.js'
import { buildTerminalCommands, terminalFailureMessage } from './editorTerminalCommands.js'
import { BranchPilotUserError } from './errors.js'

const DEFAULT_EDITOR_SETTINGS: EditorSettings = {
  preference: 'vscode'
}

const DEFAULT_TERMINAL_SETTINGS: TerminalSettings = {
  preference: 'auto'
}

interface ExternalEditorServiceOptions {
  platform?: NodeJS.Platform
  env?: NodeJS.ProcessEnv
}

export { getStandardEditorCommands }

export class ExternalEditorService {
  constructor(
    private readonly runner: CommandRunner,
    private readonly options: ExternalEditorServiceOptions = {}
  ) {}

  async openInEditor(
    targetPath: string,
    line?: number,
    settings: EditorSettings = DEFAULT_EDITOR_SETTINGS,
    column?: number,
    selectionText?: string
  ): Promise<GitOperationResult> {
    const location = await resolveEditorLocation(targetPath, line, column, selectionText)
    const codePath = location.line
      ? `${targetPath}:${location.line}${location.column ? `:${location.column}` : ''}`
      : targetPath

    if (settings.preference === 'custom') {
      return this.openWithCustomCommand(targetPath, codePath, settings.customCommand)
    }

    if (settings.preference === 'auto') {
      const openedWithCli = await this.openFirstAvailableCli(EDITOR_PRESETS, targetPath, location.line, location.column)

      if (openedWithCli) {
        return { message: `Opened in ${openedWithCli.label}` }
      }

      const openedWithStandardLocation = await this.openFirstAvailableStandardLocation(EDITOR_PRESETS, targetPath, location.line, location.column)

      if (openedWithStandardLocation) {
        return { message: `Opened in ${openedWithStandardLocation.label}` }
      }

      const openedWithApp = await this.openFirstAvailableMacApp(EDITOR_PRESETS, targetPath)

      if (openedWithApp) {
        return { message: `Opened in ${openedWithApp.label}` }
      }
    } else {
      const preset = EDITOR_PRESETS.find((candidate) => candidate.preference === settings.preference)

      if (preset && await this.openWithPreset(preset, targetPath, location.line, location.column)) {
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

  async openTerminal(targetPath: string, settings: TerminalSettings = DEFAULT_TERMINAL_SETTINGS): Promise<GitOperationResult> {
    if (settings.preference === 'custom') {
      return this.openTerminalWithCustomCommand(targetPath, settings.customCommand)
    }

    const candidates = buildTerminalCommands(settings.preference, targetPath, this.platform(), this.env())

    for (const candidate of candidates) {
      if (await this.tryCommand(candidate.command, candidate.args)) {
        return { message: `Opened ${candidate.label}` }
      }
    }

    throw new BranchPilotUserError(
      'terminal_open_failed',
      terminalFailureMessage(settings.preference),
      settings.preference === 'auto'
        ? 'Tried the standard terminal apps for this platform.'
        : undefined
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

  private async openWithPreset(preset: EditorPreset, targetPath: string, line?: number, column?: number): Promise<boolean> {
    const args = buildEditorArgs(preset.preference, targetPath, line, column)

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

  private async openFirstAvailableCli(presets: EditorPreset[], targetPath: string, line?: number, column?: number): Promise<EditorPreset | null> {
    for (const preset of presets) {
      if (await this.tryCommand(preset.cli, buildEditorArgs(preset.preference, targetPath, line, column))) {
        return preset
      }
    }

    return null
  }

  private async openFirstAvailableStandardLocation(
    presets: EditorPreset[],
    targetPath: string,
    line?: number,
    column?: number
  ): Promise<EditorPreset | null> {
    for (const preset of presets) {
      const args = buildEditorArgs(preset.preference, targetPath, line, column)

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

  private async openTerminalWithCustomCommand(
    targetPath: string,
    commandTemplate: string | undefined
  ): Promise<GitOperationResult> {
    const parsed = parseCommandTemplate(commandTemplate)

    if (!parsed) {
      throw new BranchPilotUserError(
        'terminal_custom_command_missing',
        'Custom terminal command is empty. Configure a command with %TARGET_PATH% or switch back to Auto.'
      )
    }

    const args = parsed.args.map((arg) => arg.replaceAll('%TARGET_PATH%', targetPath))

    if (!commandTemplate?.includes('%TARGET_PATH%')) {
      args.push(targetPath)
    }

    try {
      await this.runner.run(parsed.command, args, { timeoutMs: 10_000 })
    } catch (error) {
      throw new BranchPilotUserError(
        'terminal_open_failed',
        'Could not open the configured custom terminal command.',
        error instanceof Error ? error.message : undefined
      )
    }

    return { message: 'Opened with custom terminal command' }
  }
}

function editorFailureMessage(preference: EditorPreference): string {
  if (preference === 'auto') {
    return 'Could not open any supported editor.'
  }

  const preset = EDITOR_PRESETS.find((candidate) => candidate.preference === preference)
  return preset ? `Could not open ${preset.label}.` : 'Could not open the configured editor.'
}

async function resolveEditorLocation(
  targetPath: string,
  line?: number,
  column?: number,
  selectionText?: string
): Promise<{ line?: number; column?: number }> {
  const normalizedLine = normalizePositiveInteger(line)
  const normalizedColumn = normalizePositiveInteger(column)
  const needle = normalizeSelectionText(selectionText)

  if (!needle) {
    return { line: normalizedLine, column: normalizedColumn }
  }

  const content = await fs.readFile(targetPath, 'utf8').catch(() => '')
  if (!content) {
    return { line: normalizedLine, column: normalizedColumn }
  }

  const lines = content.split(/\r\n|\n|\r/)

  if (normalizedLine) {
    const lineText = lines[normalizedLine - 1]
    const firstNeedleLine = needle.split('\n').find((candidate) => candidate.trim())?.trim() ?? needle
    const lineIndex = lineText?.indexOf(firstNeedleLine)

    if (lineIndex !== undefined && lineIndex >= 0) {
      return { line: normalizedLine, column: lineIndex + 1 }
    }
  }

  const contentIndex = content.indexOf(needle)
  if (contentIndex < 0) {
    return { line: normalizedLine, column: normalizedColumn }
  }

  const before = content.slice(0, contentIndex).split(/\r\n|\n|\r/)
  return {
    line: before.length,
    column: before[before.length - 1].length + 1
  }
}

function normalizePositiveInteger(value: number | undefined): number | undefined {
  if (value === undefined) return undefined
  if (!Number.isFinite(value)) return undefined
  const integer = Math.trunc(value)
  return integer > 0 ? integer : undefined
}

function normalizeSelectionText(value: string | undefined): string | undefined {
  const normalized = value?.replace(/\r\n?/g, '\n').trim()
  return normalized && normalized.length <= 2_000 ? normalized : undefined
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
