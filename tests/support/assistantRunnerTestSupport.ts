import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  CommandExecutionError,
  type CommandRunOptions,
  type CommandRunResult,
  CommandRunner
} from '../../electron/lib/commandRunner'
import { GIT_EXECUTABLE, WHICH_EXECUTABLE } from '../../electron/lib/platformExecutables'

interface AssistantTestRunnerOptions {
  available: Array<'claude' | 'codex'>
  failingAssistants?: Array<'claude' | 'codex'>
  assistantFailureOutput?: string | Partial<Record<'claude' | 'codex', string>>
  assistantOutput?: string
}

const tempRoots: string[] = []

export class AssistantTestRunner extends CommandRunner {
  assistantPrompt = ''
  assistantInvocations: Array<{ command: string; args: string[]; cwd?: string }> = []

  constructor(private readonly options: AssistantTestRunnerOptions) {
    super()
  }

  override async run(command: string, args: string[], options: CommandRunOptions = {}): Promise<CommandRunResult> {
    if (command === WHICH_EXECUTABLE) {
      const executable = args[0] as 'claude' | 'codex'

      if (this.options.available.includes(executable)) {
        return makeResult(command, args, `/tmp/branchpilot-${executable}\n`, '', options.cwd)
      }

      throw new CommandExecutionError(`${executable} not found`, makeResult(command, args, '', 'not found', options.cwd, 1))
    }

    if (command === '/tmp/branchpilot-claude' || command === '/tmp/branchpilot-codex') {
      const assistant = command.endsWith('claude') ? 'claude' : 'codex'
      this.assistantPrompt = options.input ?? ''
      this.assistantInvocations.push({ command, args, cwd: options.cwd })

      if (this.options.failingAssistants?.includes(assistant)) {
        throw new CommandExecutionError(`${assistant} failed`, makeResult(command, args, '', this.failureOutput(assistant), options.cwd, 1))
      }

      return makeResult(
        command,
        args,
        this.options.assistantOutput ?? '{"title":"Generate commit text","description":"Summarizes staged changes."}',
        '',
        options.cwd
      )
    }

    return super.run(command, args, options)
  }

  private failureOutput(assistant: 'claude' | 'codex'): string {
    const output = this.options.assistantFailureOutput

    if (typeof output === 'string') {
      return output
    }

    return output?.[assistant] ?? `${assistant} failed`
  }
}

export function cleanupAssistantTempRoots() {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { force: true, recursive: true })
  }
}

export function createTempRepository() {
  const repoPath = mkdtempSync(path.join(tmpdir(), 'branchpilot-assistant-test-'))
  tempRoots.push(repoPath)

  git(repoPath, ['init', '-b', 'main'])
  git(repoPath, ['config', 'user.name', 'BranchPilot Test'])
  git(repoPath, ['config', 'user.email', 'branchpilot@example.com'])
  writeFileSync(path.join(repoPath, 'tracked.txt'), 'initial\n')
  git(repoPath, ['add', 'tracked.txt'])
  git(repoPath, ['commit', '-m', 'Initial commit'])

  return repoPath
}

export function createStagedRepository() {
  const repoPath = createTempRepository()
  writeFileSync(path.join(repoPath, 'tracked.txt'), 'staged\n')
  git(repoPath, ['add', 'tracked.txt'])
  return repoPath
}

export function reviewOutput(summary: string) {
  return JSON.stringify({
    summary,
    findings: [
      {
        severity: 'medium',
        title: 'Review finding',
        details: 'A concrete review finding.',
        filePath: 'tracked.txt',
        line: 1,
        recommendation: 'Inspect the change before merging.'
      }
    ]
  })
}

export function git(cwd: string, args: string[]) {
  return execFileSync(GIT_EXECUTABLE, args, {
    cwd,
    encoding: 'utf8'
  }).trim()
}

function makeResult(
  command: string,
  args: string[],
  stdout: string,
  stderr: string,
  cwd?: string,
  exitCode = 0
): CommandRunResult {
  return {
    command,
    args,
    cwd,
    exitCode,
    stdout,
    stderr,
    durationMs: 1
  }
}
