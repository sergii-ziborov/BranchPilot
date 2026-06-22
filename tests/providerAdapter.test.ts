import { describe, expect, it } from 'vitest'
import { CommandExecutionError, CommandRunner, type CommandRunOptions, type CommandRunResult } from '../electron/lib/commandRunner'
import { WHICH_EXECUTABLE } from '../electron/lib/platformExecutables'
import { listProviderStatuses } from '../electron/providers/providerAdapter'
import type { GitHubCredentialProvider } from '../electron/providers/githubCliService'

describe('providerAdapter', () => {
  it('marks GitHub as missing when gh and desktop credentials are unavailable', async () => {
    const statuses = await listProviderStatuses(new ProviderStatusTestRunner({
      ghInstalled: false
    }), {
      githubCredentialProvider: noGitHubCredential
    })

    expect(statuses).toEqual([
      { id: 'github', label: 'GitHub', state: 'missing' },
      { id: 'gitlab', label: 'GitLab', state: 'planned' },
      { id: 'bitbucket', label: 'Bitbucket', state: 'planned' }
    ])
  })

  it('marks GitHub as unauthenticated when gh exists but auth is missing', async () => {
    const statuses = await listProviderStatuses(new ProviderStatusTestRunner({
      ghAuthExitCode: 1
    }), {
      githubCredentialProvider: noGitHubCredential
    })

    expect(statuses[0]).toEqual({ id: 'github', label: 'GitHub', state: 'unauthenticated' })
  })

  it('marks GitHub as connected when gh auth succeeds', async () => {
    const statuses = await listProviderStatuses(new ProviderStatusTestRunner({
      ghAuthExitCode: 0
    }), {
      githubCredentialProvider: noGitHubCredential
    })

    expect(statuses[0]).toEqual({ id: 'github', label: 'GitHub', state: 'connected' })
  })
})

const noGitHubCredential: GitHubCredentialProvider = {
  async getCredential() {
    return undefined
  }
}

interface ProviderStatusTestRunnerOptions {
  ghInstalled?: boolean
  ghAuthExitCode?: number
}

class ProviderStatusTestRunner extends CommandRunner {
  constructor(private readonly options: ProviderStatusTestRunnerOptions = {}) {
    super()
  }

  override async run(command: string, args: string[], options: CommandRunOptions = {}): Promise<CommandRunResult> {
    if (command === WHICH_EXECUTABLE && args[0] === 'gh') {
      return this.complete(
        command,
        args,
        this.options.ghInstalled === false ? 1 : 0,
        this.options.ghInstalled === false ? '' : '/tmp/branchpilot-gh\n',
        'gh not found',
        options
      )
    }

    if (command === '/tmp/branchpilot-gh' && args.join(' ') === 'auth status') {
      const exitCode = this.options.ghAuthExitCode ?? 1
      return this.complete(
        command,
        args,
        exitCode,
        exitCode === 0 ? 'Logged in to github.com account branchpilot\n' : '',
        exitCode === 0 ? '' : 'not logged in',
        options
      )
    }

    return this.complete(command, args, 0, '', '', options)
  }

  private complete(
    command: string,
    args: string[],
    exitCode: number,
    stdout: string,
    stderr: string,
    options: CommandRunOptions
  ): CommandRunResult {
    const result: CommandRunResult = {
      command,
      args,
      cwd: options.cwd,
      exitCode,
      stdout,
      stderr,
      durationMs: 1
    }

    if (!(options.allowedExitCodes ?? [0]).includes(exitCode)) {
      throw new CommandExecutionError(`${command} failed`, result)
    }

    return result
  }
}
