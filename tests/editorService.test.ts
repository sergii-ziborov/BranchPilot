import { describe, expect, it } from 'vitest'
import {
  CommandExecutionError,
  type CommandRunOptions,
  type CommandRunResult,
  type CommandRunner
} from '../electron/lib/commandRunner'
import { ExternalEditorService } from '../electron/lib/editorService'

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

    const result = await service.openInEditor('/repo/file.txt')

    expect(result.message).toBe('Opened in Cursor')
    expect(runner.commands()).toEqual(['code', 'cursor'])
  })

  it('falls back to macOS open when editor CLIs fail', async () => {
    const runner = new FakeRunner(new Set(['code', 'cursor']))
    const service = new ExternalEditorService(runner as unknown as CommandRunner)

    const result = await service.openInEditor('/repo')

    expect(result.message).toBe('Opened in Visual Studio Code')
    expect(runner.commands()).toEqual(['code', 'cursor', '/usr/bin/open'])
  })

  it('returns a readable error when all editor open attempts fail', async () => {
    const runner = new FakeRunner(new Set(['code', 'cursor', '/usr/bin/open']))
    const service = new ExternalEditorService(runner as unknown as CommandRunner)

    await expect(service.openInEditor('/repo')).rejects.toMatchObject({
      code: 'editor_open_failed',
      message: 'Could not open Visual Studio Code or Cursor.'
    })
  })
})

class FakeRunner {
  private readonly attempts: string[] = []

  constructor(private readonly failingCommands = new Set<string>()) {}

  commands() {
    return this.attempts
  }

  async run(command: string, args: string[], options: CommandRunOptions = {}): Promise<CommandRunResult> {
    this.attempts.push(command)

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
