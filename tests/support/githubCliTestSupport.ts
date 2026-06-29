import { CommandExecutionError, CommandRunner } from '../../electron/lib/commandRunner'
import type { CommandRunOptions, CommandRunResult } from '../../electron/lib/commandRunner'
import { GIT_EXECUTABLE, WHICH_EXECUTABLE } from '../../electron/lib/platformExecutables'
import type { GitHubApiClient, GitHubCredentialProvider, GitHubDesktopCredential } from '../../electron/providers/githubCliService'
import type {
  CoAuthor,
  GitHubAccountSummary,
  GitHubPullRequest,
  GitHubPullRequestCheck,
  GitHubPullRequestDetails,
  GitHubPullRequestDiff,
  GitHubRepositorySummary,
  ListGitHubRepositoriesRequest
} from '../../src/shared/branchPilot'
import {
  toGhAccountJson,
  toGhCoAuthorJson,
  toGhEmailJson,
  toGhPullRequestCheckJson,
  toGhPullRequestDetailsJson,
  toGhPullRequestJson,
  toGhRepositoryJson
} from './githubCliJsonFixtures'
import {
  makeAccount,
  makeCoAuthor,
  makePullRequest,
  makePullRequestCheck,
  makePullRequestDetails,
  makePullRequestDiff,
  makeRepository
} from './githubCliTestFixtures'

export {
  toGhAccountJson,
  toGhCoAuthorJson,
  toGhEmailJson,
  toGhPullRequestCheckJson,
  toGhPullRequestDetailsJson,
  toGhPullRequestJson,
  toGhRepositoryJson
} from './githubCliJsonFixtures'

export {
  jsonResponse,
  makeAccount,
  makeCoAuthor,
  makePullRequest,
  makePullRequestCheck,
  makePullRequestDetails,
  makePullRequestDiff,
  makeRepository
} from './githubCliTestFixtures'

export interface GitHubCliTestRunnerOptions {
  ghInstalled?: boolean
  ghAuthenticated?: boolean
  ghAuthLoginExitCode?: number
  gcmLoginExitCode?: number
  remoteUrl?: string
  currentBranch?: string
  upstream?: string
  originHead?: string
  localPullRequestBranchExists?: boolean
  currentPullRequest?: GitHubPullRequest | null
  pullRequests?: GitHubPullRequest[]
  accounts?: GitHubAccountSummary[]
  repositories?: GitHubRepositorySummary[]
  repoListOutput?: string
  prViewOutput?: string
  prListOutput?: string
  pullRequestDetails?: GitHubPullRequestDetails
  pullRequestChecks?: GitHubPullRequestCheck[]
  userEmails?: string[]
  orgMembers?: Record<string, CoAuthor[]>
  repositoryCollaborators?: CoAuthor[]
  prDetailsOutput?: string
  prChecksOutput?: string
  prChecksExitCode?: number
  prDiffOutput?: string
}

export class FakeGitHubCredentialProvider implements GitHubCredentialProvider {
  constructor(private readonly credential: GitHubDesktopCredential | null | undefined = {
    username: 'desktop-user',
    token: 'desktop-token'
  }) {}

  async getCredential(): Promise<GitHubDesktopCredential | undefined> {
    return this.credential ?? undefined
  }
}

export class FakeGitHubApiClient implements GitHubApiClient {
  listRequest?: ListGitHubRepositoriesRequest
  createdPullRequest?: {
    credential: GitHubDesktopCredential
    repository: { owner: string; repo: string; remoteUrl: string }
    request: {
      title: string
      description: string
      baseBranch: string
      headBranch: string
    }
  }

  constructor(
    private readonly repositories: GitHubRepositorySummary[] = [makeRepository()],
    private readonly accounts: GitHubAccountSummary[] = [
      makeAccount({ login: 'desktop-user', type: 'user' }),
      makeAccount({ login: 'desktop-org', type: 'organization' })
    ],
    private readonly pullRequests: GitHubPullRequest[] = [makePullRequest()],
    private readonly pullRequestDetails: GitHubPullRequestDetails = makePullRequestDetails(),
    private readonly pullRequestDiff: GitHubPullRequestDiff = makePullRequestDiff()
  ) {}

  async getViewer(): Promise<{ login: string }> {
    return { login: 'desktop-user' }
  }

  async listAccounts(): Promise<GitHubAccountSummary[]> {
    return this.accounts
  }

  async listRepositories(
    _credential: GitHubDesktopCredential,
    request: ListGitHubRepositoriesRequest
  ): Promise<GitHubRepositorySummary[]> {
    this.listRequest = request
    const owner = request.owner?.toLowerCase()
    const query = request.query?.toLowerCase()
    const visibility = request.visibility && request.visibility !== 'all'
      ? request.visibility.toLowerCase()
      : undefined

    return this.repositories.filter((repository) => {
      if (owner && repository.owner.toLowerCase() !== owner) {
        return false
      }

      if (visibility && repository.visibility.toLowerCase() !== visibility) {
        return false
      }

      return query ? [
        repository.name,
        repository.nameWithOwner,
        repository.description
      ].some((value) => value.toLowerCase().includes(query)) : true
    })
  }

  async listPullRequests(): Promise<GitHubPullRequest[]> {
    return this.pullRequests
  }

  async getPullRequestDetails(
    _credential: GitHubDesktopCredential,
    _repository: { owner: string; repo: string; remoteUrl: string },
    prNumber: number
  ): Promise<GitHubPullRequestDetails> {
    return {
      ...this.pullRequestDetails,
      number: prNumber
    }
  }

  async getPullRequestDiff(
    _credential: GitHubDesktopCredential,
    _repository: { owner: string; repo: string; remoteUrl: string },
    prNumber: number
  ): Promise<GitHubPullRequestDiff> {
    return {
      ...this.pullRequestDiff,
      prNumber
    }
  }

  async createPullRequest(
    credential: GitHubDesktopCredential,
    repository: { owner: string; repo: string; remoteUrl: string },
    request: {
      title: string
      description: string
      baseBranch: string
      headBranch: string
    }
  ) {
    this.createdPullRequest = {
      credential,
      repository,
      request
    }

    return {
      url: 'https://github.com/example/project/pull/77',
      title: request.title,
      baseBranch: request.baseBranch,
      headBranch: request.headBranch
    }
  }
}

export class GitHubCliTestRunner extends CommandRunner {
  ghPrCreateArgs: string[] = []
  ghPrCheckoutArgs: string[] = []
  ghPrDetailsArgs: string[] = []
  ghPrChecksArgs: string[] = []
  ghPrDiffArgs: string[] = []
  ghAuthLoginArgs: string[] = []
  ghApiArgs: string[][] = []
  ghRepoListArgs: string[] = []
  gcmLoginArgs: string[] = []
  gitFetchArgs: string[] = []
  gitSwitchArgs: string[] = []
  gitMergeArgs: string[] = []

  constructor(private readonly options: GitHubCliTestRunnerOptions = {}) {
    super()
  }

  override async run(command: string, args: string[], options: CommandRunOptions = {}): Promise<CommandRunResult> {
    if (command === WHICH_EXECUTABLE && args[0] === 'gh') {
      return this.complete(command, args, this.options.ghInstalled === false ? 1 : 0, '/tmp/branchpilot-gh\n', 'gh not found', options)
    }

    if (command === GIT_EXECUTABLE) {
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

    if (command === '/tmp/branchpilot-gh' && args[0] === 'auth' && args[1] === 'login') {
      this.ghAuthLoginArgs = args
      return this.complete(
        command,
        args,
        this.options.ghAuthLoginExitCode ?? 0,
        this.options.ghAuthLoginExitCode === 1 ? '' : 'Logged in\n',
        this.options.ghAuthLoginExitCode === 1 ? 'login canceled' : '',
        options
      )
    }

    if (command === '/tmp/branchpilot-gh' && args[0] === 'pr' && args[1] === 'create') {
      this.ghPrCreateArgs = args
      return this.complete(command, args, 0, 'https://github.com/example/project/pull/42\n', '', options)
    }

    if (command === '/tmp/branchpilot-gh' && args[0] === 'pr' && args[1] === 'view') {
      if (args[2] && args[2] !== '--json') {
        this.ghPrDetailsArgs = args

        if (this.options.prDetailsOutput) {
          return this.complete(command, args, 0, this.options.prDetailsOutput, '', options)
        }

        return this.complete(
          command,
          args,
          0,
          `${JSON.stringify(toGhPullRequestDetailsJson(this.options.pullRequestDetails ?? makePullRequestDetails()))}\n`,
          '',
          options
        )
      }

      if (this.options.currentPullRequest === null) {
        return this.complete(command, args, 1, '', 'no pull requests found for branch', options)
      }

      if (this.options.prViewOutput) {
        return this.complete(command, args, 0, this.options.prViewOutput, '', options)
      }

      return this.complete(
        command,
        args,
        0,
        `${JSON.stringify(toGhPullRequestJson(this.options.currentPullRequest ?? makePullRequest()))}\n`,
        '',
        options
      )
    }

    if (command === '/tmp/branchpilot-gh' && args[0] === 'pr' && args[1] === 'list') {
      if (this.options.prListOutput) {
        return this.complete(command, args, 0, this.options.prListOutput, '', options)
      }

      const pullRequests = this.options.pullRequests ?? [makePullRequest()]
      return this.complete(
        command,
        args,
        0,
        `${JSON.stringify(pullRequests.map(toGhPullRequestJson))}\n`,
        '',
        options
      )
    }

    if (command === '/tmp/branchpilot-gh' && args[0] === 'api' && args[1] === 'user') {
      this.ghApiArgs.push(args)
      const accounts = this.options.accounts ?? [
        makeAccount({ login: 'branchpilot-user', type: 'user' }),
        makeAccount({ login: 'branchpilot-org', type: 'organization' })
      ]
      const viewer = accounts.find((account) => account.type === 'user') ?? accounts[0]
      return this.complete(command, args, 0, `${JSON.stringify(toGhAccountJson(viewer))}\n`, '', options)
    }

    if (command === '/tmp/branchpilot-gh' && args[0] === 'api' && args[1] === 'user/orgs') {
      this.ghApiArgs.push(args)
      const accounts = this.options.accounts ?? [
        makeAccount({ login: 'branchpilot-user', type: 'user' }),
        makeAccount({ login: 'branchpilot-org', type: 'organization' })
      ]
      const orgs = accounts.filter((account) => account.type === 'organization')
      return this.complete(command, args, 0, `${JSON.stringify(orgs.map(toGhAccountJson))}\n`, '', options)
    }

    if (command === '/tmp/branchpilot-gh' && args[0] === 'api' && args[1] === 'user/emails') {
      this.ghApiArgs.push(args)
      const accounts = this.options.accounts ?? [
        makeAccount({ login: 'branchpilot-user', type: 'user' }),
        makeAccount({ login: 'branchpilot-org', type: 'organization' })
      ]
      const user = accounts.find((account) => account.type === 'user')
      const emails = this.options.userEmails ?? user?.emails ?? []

      return this.complete(command, args, 0, `${JSON.stringify(emails.map(toGhEmailJson))}\n`, '', options)
    }

    if (command === '/tmp/branchpilot-gh' && args[0] === 'api' && /^orgs\/[^/]+\/members/.test(args[1] ?? '')) {
      this.ghApiArgs.push(args)
      const org = args[1].split('/')[1]
      const members = this.options.orgMembers?.[org] ?? [
        makeCoAuthor({ name: 'Ada Lovelace', login: 'ada-lovelace', email: '1001+ada-lovelace@users.noreply.github.com' })
      ]

      return this.complete(command, args, 0, `${JSON.stringify(members.map(toGhCoAuthorJson))}\n`, '', options)
    }

    if (command === '/tmp/branchpilot-gh' && args[0] === 'api' && /^repos\/[^/]+\/[^/]+\/collaborators/.test(args[1] ?? '')) {
      this.ghApiArgs.push(args)
      const collaborators = this.options.repositoryCollaborators ?? [
        makeCoAuthor({ name: 'Ada Lovelace', login: 'ada-lovelace', email: '1001+ada-lovelace@users.noreply.github.com' })
      ]

      return this.complete(command, args, 0, `${JSON.stringify(collaborators.map(toGhCoAuthorJson))}\n`, '', options)
    }

    if (command === '/tmp/branchpilot-gh' && args[0] === 'repo' && args[1] === 'list') {
      this.ghRepoListArgs = args

      if (this.options.repoListOutput) {
        return this.complete(command, args, 0, this.options.repoListOutput, '', options)
      }

      const repositories = this.options.repositories ?? [makeRepository()]
      return this.complete(
        command,
        args,
        0,
        `${JSON.stringify(repositories.map(toGhRepositoryJson))}\n`,
        '',
        options
      )
    }

    if (command === '/tmp/branchpilot-gh' && args[0] === 'pr' && args[1] === 'checkout') {
      this.ghPrCheckoutArgs = args
      return this.complete(command, args, 0, `Switched to branch '${args[2]}'\n`, '', options)
    }

    if (command === '/tmp/branchpilot-gh' && args[0] === 'pr' && args[1] === 'checks') {
      this.ghPrChecksArgs = args

      if (this.options.prChecksOutput) {
        return this.complete(command, args, this.options.prChecksExitCode ?? 0, this.options.prChecksOutput, '', options)
      }

      const checks = this.options.pullRequestChecks ?? [makePullRequestCheck()]
      return this.complete(
        command,
        args,
        this.options.prChecksExitCode ?? 0,
        `${JSON.stringify(checks.map(toGhPullRequestCheckJson))}\n`,
        '',
        options
      )
    }

    if (command === '/tmp/branchpilot-gh' && args[0] === 'pr' && args[1] === 'diff') {
      this.ghPrDiffArgs = args
      return this.complete(command, args, 0, this.options.prDiffOutput ?? '', '', options)
    }

    return super.run(command, args, options)
  }

  private git(command: string, args: string[], options: CommandRunOptions): Promise<CommandRunResult> {
    if (args.join(' ') === 'credential-manager github login') {
      this.gcmLoginArgs = args
      return Promise.resolve(this.complete(
        command,
        args,
        this.options.gcmLoginExitCode ?? 0,
        this.options.gcmLoginExitCode === 1 ? '' : 'Logged in\n',
        this.options.gcmLoginExitCode === 1 ? 'login canceled' : '',
        options
      ))
    }

    if (args.join(' ') === 'rev-parse --show-toplevel') {
      return Promise.resolve(this.complete(command, args, 0, '/repo\n', '', options))
    }

    if (args[0] === 'fetch') {
      this.gitFetchArgs = args
      return Promise.resolve(this.complete(command, args, 0, 'From github.com:example/project\n', '', options))
    }

    if (args.join(' ') === 'rev-parse --verify refs/heads/branchpilot/pr-42') {
      return Promise.resolve(this.complete(
        command,
        args,
        this.options.localPullRequestBranchExists ? 0 : 1,
        this.options.localPullRequestBranchExists ? 'refs/heads/branchpilot/pr-42\n' : '',
        'not found',
        options
      ))
    }

    if (args[0] === 'switch') {
      this.gitSwitchArgs = args
      return Promise.resolve(this.complete(command, args, 0, `Switched to ${args.at(-1) ?? 'branch'}\n`, '', options))
    }

    if (args[0] === 'merge') {
      this.gitMergeArgs = args
      return Promise.resolve(this.complete(command, args, 0, 'Fast-forward\n', '', options))
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

