import { describe, expect, it } from 'vitest'
import {
  CommandExecutionError,
  type CommandRunOptions,
  type CommandRunResult,
  type CommandRunner
} from '../electron/lib/commandRunner'
import { ExternalEditorService, getStandardEditorCommands } from '../electron/lib/editorService'
import type { EditorPreference } from '../src/shared/branchPilot'

describe('ExternalEditorService', () => {
  it('opens with the VS Code CLI when it is available', async () => {
    const runner = new FakeRunner()
    const service = new ExternalEditorService(runner as unknown as CommandRunner)

    const result = await service.openInEditor('/repo')

    expect(result.message).toBe('Opened in Visual Studio Code')
    expect(runner.commands()).toEqual(['code'])
  })

  it('falls back to Cursor when the VS Code CLI fails', async () => {
    const runner = new FakeRunner(new Set(['code']))
    const service = new ExternalEditorService(runner as unknown as CommandRunner)

    const result = await service.openInEditor('/repo/file.txt', undefined, {
      preference: 'auto'
    })

    expect(result.message).toBe('Opened in Cursor')
    expect(runner.commands()).toEqual(['code', 'cursor'])
  })

  it('uses an explicit editor preference before auto-detection candidates', async () => {
    const runner = new FakeRunner()
    const service = new ExternalEditorService(runner as unknown as CommandRunner)

    const result = await service.openInEditor('/repo/file.txt', undefined, {
      preference: 'cursor'
    })

    expect(result.message).toBe('Opened in Cursor')
    expect(runner.commands()).toEqual(['cursor'])
  })

  it('falls back to a standard Windows VS Code install when the CLI is not on PATH', async () => {
    const runner = new FakeRunner(new Set(['code']))
    const service = new ExternalEditorService(runner as unknown as CommandRunner, {
      platform: 'win32',
      env: {
        LOCALAPPDATA: 'C:\\Users\\Ada\\AppData\\Local',
        ProgramFiles: 'C:\\Program Files'
      }
    })

    const result = await service.openInEditor('C:\\repo', undefined, {
      preference: 'vscode'
    })

    expect(result.message).toBe('Opened in Visual Studio Code')
    expect(runner.calls()).toEqual([
      {
        command: 'code',
        args: ['C:\\repo']
      },
      {
        command: 'C:\\Users\\Ada\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe',
        args: ['C:\\repo']
      }
    ])
  })

  it('passes line numbers to editor CLIs', async () => {
    const runner = new FakeRunner()
    const service = new ExternalEditorService(runner as unknown as CommandRunner)

    const result = await service.openInEditor('/repo/src/app.ts', 27, {
      preference: 'vscode'
    })

    expect(result.message).toBe('Opened in Visual Studio Code')
    expect(runner.calls()).toEqual([
      {
        command: 'code',
        args: ['--goto', '/repo/src/app.ts:27']
      }
    ])
  })

  it('falls back to macOS open when editor CLIs fail', async () => {
    const runner = new FakeRunner(new Set([
      'code',
      'cursor',
      'webstorm',
      'rider',
      'subl',
      ...allStandardEditorCommands('darwin', { HOME: '/Users/ada' })
    ]))
    const service = new ExternalEditorService(runner as unknown as CommandRunner, {
      platform: 'darwin',
      env: { HOME: '/Users/ada' }
    })

    const result = await service.openInEditor('/repo')

    expect(result.message).toBe('Opened in Visual Studio Code')
    expect(runner.commands().at(-1)).toBe('/usr/bin/open')
  })

  it('returns a readable error when all editor open attempts fail', async () => {
    const runner = new FakeRunner(new Set([
      'code',
      'cursor',
      'webstorm',
      'rider',
      'subl',
      ...allStandardEditorCommands('darwin', { HOME: '/Users/ada' }),
      '/usr/bin/open'
    ]))
    const service = new ExternalEditorService(runner as unknown as CommandRunner, {
      platform: 'darwin',
      env: { HOME: '/Users/ada' }
    })

    await expect(service.openInEditor('/repo', undefined, {
      preference: 'auto'
    })).rejects.toMatchObject({
      code: 'editor_open_failed',
      message: 'Could not open any supported editor.'
    })
  })

  it('uses a custom command with target placeholder without shell interpolation', async () => {
    const runner = new FakeRunner()
    const service = new ExternalEditorService(runner as unknown as CommandRunner)

    const result = await service.openInEditor('/repo/file with spaces.txt', 42, {
      preference: 'custom',
      customCommand: 'my-editor --goto %TARGET_PATH%'
    })

    expect(result.message).toBe('Opened with custom editor command')
    expect(runner.calls()).toEqual([
      {
        command: 'my-editor',
        args: ['--goto', '/repo/file with spaces.txt:42']
      }
    ])
  })

  it('appends the target path when custom command has no placeholder', async () => {
    const runner = new FakeRunner()
    const service = new ExternalEditorService(runner as unknown as CommandRunner)

    await service.openInEditor('/repo', undefined, {
      preference: 'custom',
      customCommand: 'my-editor --reuse-window'
    })

    expect(runner.calls()).toEqual([
      {
        command: 'my-editor',
        args: ['--reuse-window', '/repo']
      }
    ])
  })

  it('rejects empty custom editor commands', async () => {
    const runner = new FakeRunner()
    const service = new ExternalEditorService(runner as unknown as CommandRunner)

    await expect(service.openInEditor('/repo', undefined, {
      preference: 'custom',
      customCommand: '   '
    })).rejects.toMatchObject({
      code: 'editor_custom_command_missing'
    })
  })
})

function allStandardEditorCommands(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): string[] {
  const preferences: Array<Exclude<EditorPreference, 'auto' | 'custom'>> = [
    'vscode',
    'cursor',
    'webstorm',
    'rider',
    'sublime'
  ]

  return preferences.flatMap((preference) => getStandardEditorCommands(preference, platform, env))
}

class FakeRunner {
  private readonly attempts: Array<{ command: string; args: string[] }> = []

  constructor(private readonly failingCommands = new Set<string>()) {}

  commands() {
    return this.attempts.map((attempt) => attempt.command)
  }

  calls() {
    return this.attempts
  }

  async run(command: string, args: string[], options: CommandRunOptions = {}): Promise<CommandRunResult> {
    this.attempts.push({ command, args })

    const result: CommandRunResult = {
      command,
      args,
      cwd: options.cwd,
      exitCode: this.failingCommands.has(command) ? 1 : 0,
      stdout: '',
      stderr: this.failingCommands.has(command) ? `${command} failed` : '',
      durationMs: 1
    }

    if (this.failingCommands.has(command)) {
      throw new CommandExecutionError(`${command} failed`, result)
    }

    return result
  }
}
