import type { EditorPreference, EditorSettings, GitOperationResult } from '../../src/shared/branchPilot.js'
import { CommandRunner } from './commandRunner.js'
import { BranchPilotUserError } from './errors.js'

const DEFAULT_EDITOR_SETTINGS: EditorSettings = {
  preference: 'auto'
}

interface EditorPreset {
  preference: Exclude<EditorPreference, 'auto' | 'custom'>
  label: string
  cli: string
  macAppName: string
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
  constructor(private readonly runner: CommandRunner) {}

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
      const openedWithCli = await this.openFirstAvailableCli(EDITOR_PRESETS, codePath)

      if (openedWithCli) {
        return { message: `Opened in ${openedWithCli.label}` }
      }

      const openedWithApp = await this.openFirstAvailableMacApp(EDITOR_PRESETS, targetPath)

      if (openedWithApp) {
        return { message: `Opened in ${openedWithApp.label}` }
      }
    } else {
      const preset = EDITOR_PRESETS.find((candidate) => candidate.preference === settings.preference)

      if (preset && await this.openWithPreset(preset, targetPath, codePath)) {
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
    try {
      await this.runner.run('/usr/bin/open', ['-a', 'Terminal', targetPath], {
        timeoutMs: 10_000
      })
    } catch (error) {
      throw new BranchPilotUserError(
        'terminal_open_failed',
        'Could not open Terminal at this path.',
        error instanceof Error ? error.message : undefined
      )
    }

    return { message: 'Opened Terminal' }
  }

  private async tryCommand(command: string, args: string[]): Promise<boolean> {
    try {
      await this.runner.run(command, args, { timeoutMs: 10_000 })
      return true
    } catch {
      return false
    }
  }

  private async openWithPreset(preset: EditorPreset, targetPath: string, codePath: string): Promise<boolean> {
    if (await this.tryCommand(preset.cli, [codePath])) {
      return true
    }

    return this.tryCommand('/usr/bin/open', ['-a', preset.macAppName, targetPath])
  }

  private async openFirstAvailableCli(presets: EditorPreset[], codePath: string): Promise<EditorPreset | null> {
    for (const preset of presets) {
      if (await this.tryCommand(preset.cli, [codePath])) {
        return preset
      }
    }

    return null
  }

  private async openFirstAvailableMacApp(presets: EditorPreset[], targetPath: string): Promise<EditorPreset | null> {
    for (const preset of presets) {
      if (await this.tryCommand('/usr/bin/open', ['-a', preset.macAppName, targetPath])) {
        return preset
      }
    }

    return null
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
