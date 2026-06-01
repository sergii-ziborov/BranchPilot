import type { GitOperationResult } from '../../src/shared/branchPilot.js'
import { CommandRunner } from './commandRunner.js'
import { BranchPilotUserError } from './errors.js'

export class ExternalEditorService {
  constructor(private readonly runner: CommandRunner) {}

  async openInEditor(targetPath: string, line?: number): Promise<GitOperationResult> {
    const codePath = line ? `${targetPath}:${line}` : targetPath
    const openedWithCode = await this.tryCommand('code', [codePath])

    if (openedWithCode) {
      return { message: 'Opened in Visual Studio Code' }
    }

    const openedWithCursor = await this.tryCommand('cursor', [codePath])

    if (openedWithCursor) {
      return { message: 'Opened in Cursor' }
    }

    try {
      await this.runner.run('/usr/bin/open', ['-a', 'Visual Studio Code', targetPath], {
        timeoutMs: 10_000
      })
    } catch (error) {
      throw new BranchPilotUserError(
        'editor_open_failed',
        'Could not open Visual Studio Code or Cursor.',
        error instanceof Error ? error.message : undefined
      )
    }

    return { message: 'Opened in Visual Studio Code' }
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
}
