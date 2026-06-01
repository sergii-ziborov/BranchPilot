import { describe, expect, it } from 'vitest'
import {
  CommandExecutionError,
  type CommandRunOptions,
  type CommandRunResult,
  CommandRunner
} from '../electron/lib/commandRunner'
import {
  createGitHubPullRequest,
  getGitHubCliStatus
} from '../electron/providers/githubCliService'

describe('GitHub CLI bridge', () => {
  it('detects missing, unauthenticated, and authenticated gh states', async () => {
    await expect(getGitHubCliStatus(new GitHubCliTestRunner({ ghInstalled: false }))).resolves.toMatchObject({
      state: 'missing',
      installed: false,
      authenticated: false
    })

    await expect(getGitHubCliStatus(new GitHubCliTestRunner({ ghAuthenticated: false }))).resolves.toMatchObject({
      state: 'unauthenticated',
      installed: true,
      authenticated: false
    })

    await expect(getGitHubCliStatus(new GitHubCliTestRunner({ ghAuthenticated: true }))).resolves.toMatchObject({
      state: 'authenticated',
      installed: true,
      authenticated: true,
      username: 'branchpilot-user'
    })
  })

  it('creates a pull request for HTTPS GitHub remotes with argv-only body file flow', async () => {
    const runner = new GitHubCliTestRunner({
      remoteUrl: 'https://github.com/example/project.git',
      upstream: 'origin/feature/test'
    })

    const result = await createGitHubPullRequest(runner, {
      repoPath: '/repo',
      title: 'Add provider bridge',
      description: 'Creates a pull request through gh.',
      baseBranch: 'main'
    })

    expect(result).toEqual({
      url: 'https://github.com/example/project/pull/42',
      title: 'Add provider bridge',
      baseBranch: 'main',
      headBranch: 'feature/test'
    })
    expect(runner.ghPrCreateArgs).toEqual(expect.arrayContaining([
      'pr',
      'create',
      '--title',
      'Add provider bridge',
      '--body-file',
      '--base',
      'main',
      '--head',
      'feature/test'
    ]))
    expect(runner.ghPrCreateArgs).not.toContain('Creates a pull request through gh.')
  })

  it('accepts SSH GitHub remotes', async () => {
    const runner = new GitHubCliTestRunner({
      remoteUrl: 'git@github.com:example/project.git',
      upstream: 'origin/feature/test'
    })

    await expect(createGitHubPullRequest(runner, {
      repoPath: '/repo',
      title: 'Add SSH remote support',
      description: '',
      baseBranch: 'main'
    })).resolves.toMatchObject({
      url: 'https://github.com/example/project/pull/42'
    })
  })

  it('blocks pull request creation when gh is unauthenticated', async () => {
    const runner = new GitHubCliTestRunner({ ghAuthenticated: false })

    await expect(createGitHubPullRequest(runner, {
      repoPath: '/repo',
      title: 'Blocked',
      description: ''
    })).rejects.toMatchObject({
      code: 'github_cli_unauthenticated'
    })
  })

  it('blocks detached HEAD, non-GitHub remotes, empty titles, and unpublished branches', async () => {
    await expect(createGitHubPullRequest(new GitHubCliTestRunner({ currentBranch: '' }), {
      repoPath: '/repo',
      title: 'Detached',
      description: ''
    })).rejects.toMatchObject({ code: 'git_detached_head' })

    await expect(createGitHubPullRequest(new GitHubCliTestRunner({ remoteUrl: 'https://gitlab.com/example/project.git' }), {
      repoPath: '/repo',
      title: 'Wrong remote',
      description: ''
    })).rejects.toMatchObject({ code: 'github_remote_missing' })

    await expect(createGitHubPullRequest(new GitHubCliTestRunner(), {
      repoPath: '/repo',
      title: '   ',
      description: ''
    })).rejects.toMatchObject({ code: 'invalid_pr_title' })

    await expect(createGitHubPullRequest(new GitHubCliTestRunner({ upstream: '' }), {
      repoPath: '/repo',
      title: 'Unpublished',
      description: ''
    })).rejects.toMatchObject({ code: 'git_no_upstream' })
  })
})

interface GitHubCliTestRunnerOptions {
  ghInstalled?: boolean
  ghAuthenticated?: boolean
  remoteUrl?: string
  currentBranch?: string
  upstream?: string
  originHead?: string
}

class GitHubCliTestRunner extends CommandRunner {
  ghPrCreateArgs: string[] = []

  constructor(private readonly options: GitHubCliTestRunnerOptions = {}) {
    super()
  }

  override async run(command: string, args: string[], options: CommandRunOptions = {}): Promise<CommandRunResult> {
    if (command === '/usr/bin/which' && args[0] === 'gh') {
      return this.complete(command, args, this.options.ghInstalled === false ? 1 : 0, '/tmp/branchpilot-gh\n', 'gh not found', options)
    }

    if (command === '/usr/bin/git') {
      return this.git(command, args, options)
    }

    if (command === '/tmp/branchpilot-gh' && args.join(' ') === 'auth status') {
      return this.complete(
        command,
        args,
        this.options.ghAuthenticated === false ? 1 : 0,
        'Logged in to github.com account branchpilot-user (/Users/test/.config/gh/hosts.yml)\n',
        'You are not logged into any GitHub hosts.',
        options
      )
    }

    if (command === '/tmp/branchpilot-gh' && args[0] === 'pr' && args[1] === 'create') {
      this.ghPrCreateArgs = args
      return this.complete(command, args, 0, 'https://github.com/example/project/pull/42\n', '', options)
    }

    return super.run(command, args, options)
  }

  private git(command: string, args: string[], options: CommandRunOptions): Promise<CommandRunResult> {
    if (args.join(' ') === 'rev-parse --show-toplevel') {
      return Promise.resolve(this.complete(command, args, 0, '/repo\n', '', options))
    }

    if (args.join(' ') === 'remote -v') {
      const remoteUrl = this.options.remoteUrl ?? 'https://github.com/example/project.git'
      return Promise.resolve(this.complete(command, args, 0, `origin\t${remoteUrl} (fetch)\norigin\t${remoteUrl} (push)\n`, '', options))
    }

    if (args.join(' ') === 'branch --show-current') {
      return Promise.resolve(this.complete(command, args, 0, `${this.options.currentBranch ?? 'feature/test'}\n`, '', options))
    }

    if (args.join(' ') === 'rev-parse --abbrev-ref --symbolic-full-name @{u}') {
      const upstream = this.options.upstream ?? 'origin/feature/test'
      return Promise.resolve(this.complete(command, args, upstream ? 0 : 128, upstream ? `${upstream}\n` : '', 'no upstream', options))
    }

    if (args.join(' ') === 'symbolic-ref --quiet --short refs/remotes/origin/HEAD') {
      const originHead = this.options.originHead ?? 'origin/main'
      return Promise.resolve(this.complete(command, args, originHead ? 0 : 1, originHead ? `${originHead}\n` : '', '', options))
    }

    return Promise.resolve(this.complete(command, args, 0, '', '', options))
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
      stdout: exitCode === 0 ? stdout : '',
      stderr: exitCode === 0 ? '' : stderr,
      durationMs: 1
    }

    if (!(options.allowedExitCodes ?? [0]).includes(exitCode)) {
      throw new CommandExecutionError(`${command} failed`, result)
    }

    return result
  }
}
