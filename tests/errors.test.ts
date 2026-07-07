import { describe, expect, it } from 'vitest'
import {
  CommandExecutionError,
  type CommandRunResult
} from '../electron/lib/commandRunner'
import { toBranchPilotError } from '../electron/lib/errors'
import { GIT_EXECUTABLE } from '../electron/lib/platformExecutables'

describe('BranchPilot error normalization', () => {
  it('does not mislabel Codex CLI failures as Git failures', () => {
    const error = toBranchPilotError(new CommandExecutionError(
      'codex failed',
      commandResult('C:\\tools\\codex.cmd', ['exec'], '', 'Codex auth failed.')
    ))

    expect(error).toMatchObject({
      code: 'assistant_failed',
      message: 'Codex agent failed. See details for the CLI output.'
    })
    expect(error.details).toContain('Command: C:\\tools\\codex.cmd exec')
    expect(error.details).toContain('Codex auth failed.')
  })

  it('keeps real Git failures classified as Git failures', () => {
    const error = toBranchPilotError(new CommandExecutionError(
      'git failed',
      commandResult(GIT_EXECUTABLE, ['push'], '', 'fatal: repository not found')
    ))

    expect(error).toMatchObject({
      code: 'git_repository_not_found'
    })
    expect(error.details).toContain('fatal: repository not found')
  })
})

function commandResult(
  command: string,
  args: string[],
  stdout: string,
  stderr: string,
  exitCode = 1
): CommandRunResult {
  return {
    command,
    args,
    exitCode,
    stdout,
    stderr,
    durationMs: 12
  }
}
