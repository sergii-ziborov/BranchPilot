import { CommandExecutionError, CommandRunner } from '../../electron/lib/commandRunner'
import type { CommandRunOptions, CommandRunResult } from '../../electron/lib/commandRunner'
import type { GitHubApiClient, GitHubCredentialProvider, GitHubDesktopCredential } from '../../electron/providers/githubCliService'
import type {
  GitHubAccountSummary, GitHubPullRequest, GitHubPullRequestCheck,
  GitHubPullRequestDetails, GitHubPullRequestDiff, GitHubRepositorySummary
} from '../../src/shared/branchPilot'

export interface GitHubCliTestRunnerOptions {
  ghInstalled?: boolean
  ghAuthenticated?: boolean
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
  ghApiArgs: string[][] = []
  ghRepoListArgs: string[] = []
  gitFetchArgs: string[] = []
  gitSwitchArgs: string[] = []
  gitMergeArgs: string[] = []

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

export function makePullRequest(overrides: Partial<GitHubPullRequest> = {}): GitHubPullRequest {
  return {
    number: 42,
    title: 'Add provider bridge',
    url: `https://github.com/example/project/pull/${overrides.number ?? 42}`,
    state: 'OPEN',
    headBranch: 'feature/test',
    baseBranch: 'main',
    draft: false,
    ...overrides
  }
}

export function makePullRequestDetails(overrides: Partial<GitHubPullRequestDetails> = {}): GitHubPullRequestDetails {
  return {
    ...makePullRequest(overrides),
    body: 'Adds provider bridge details.',
    author: {
      login: 'branchpilot-user',
      name: 'Branch Pilot',
      url: 'https://github.com/branchpilot-user'
    },
    createdAt: '2026-06-01T10:00:00Z',
    updatedAt: '2026-06-02T10:00:00Z',
    additions: 10,
    deletions: 2,
    changedFiles: 3,
    ...overrides
  }
}

export function makePullRequestCheck(overrides: Partial<GitHubPullRequestCheck> = {}): GitHubPullRequestCheck {
  return {
    name: 'build',
    state: 'SUCCESS',
    bucket: 'pass',
    workflow: 'CI',
    description: 'Build completed',
    link: 'https://github.com/example/project/actions/runs/1',
    startedAt: '2026-06-02T10:00:00Z',
    completedAt: '2026-06-02T10:01:00Z',
    ...overrides
  }
}

export function makePullRequestDiff(overrides: Partial<GitHubPullRequestDiff> = {}): GitHubPullRequestDiff {
  return {
    prNumber: 7,
    text: [
      'diff --git a/src/App.tsx b/src/App.tsx',
      '--- a/src/App.tsx',
      '+++ b/src/App.tsx',
      '@@ -1,3 +1,3 @@',
      ' import React from "react"',
      '-const title = "Old"',
      '+const title = "New"',
      ' export default title',
      ''
    ].join('\n'),
    files: [
      {
        oldPath: 'src/App.tsx',
        newPath: 'src/App.tsx',
        path: 'src/App.tsx',
        text: [
          'diff --git a/src/App.tsx b/src/App.tsx',
          '--- a/src/App.tsx',
          '+++ b/src/App.tsx',
          '@@ -1,3 +1,3 @@',
          ' import React from "react"',
          '-const title = "Old"',
          '+const title = "New"',
          ' export default title',
          ''
        ].join('\n'),
        status: 'modified',
        additions: 1,
        deletions: 1,
        hunks: [
          {
            header: '@@ -1,3 +1,3 @@',
            oldStart: 1,
            oldLines: 3,
            newStart: 1,
            newLines: 3,
            patch: '',
            lines: [
              { type: 'context', content: 'import React from "react"', oldLineNumber: 1, newLineNumber: 1 },
              { type: 'remove', content: 'const title = "Old"', oldLineNumber: 2 },
              { type: 'add', content: 'const title = "New"', newLineNumber: 2 },
              { type: 'context', content: 'export default title', oldLineNumber: 3, newLineNumber: 3 }
            ]
          }
        ]
      }
    ],
    ...overrides
  }
}

export function makeRepository(overrides: Partial<GitHubRepositorySummary> = {}): GitHubRepositorySummary {
  const nameWithOwner = overrides.nameWithOwner ?? 'example/project'
  const [owner, name] = nameWithOwner.split('/')

  return {
    name: overrides.name ?? name,
    nameWithOwner,
    owner: overrides.owner ?? owner,
    description: '',
    visibility: 'PRIVATE',
    isPrivate: true,
    isFork: false,
    isArchived: false,
    url: `https://github.com/${nameWithOwner}`,
    sshUrl: `git@github.com:${nameWithOwner}.git`,
    defaultBranch: 'main',
    updatedAt: '2026-06-02T10:00:00Z',
    pushedAt: '2026-06-02T09:00:00Z',
    ...overrides
  }
}

export function makeAccount(overrides: Partial<GitHubAccountSummary> = {}): GitHubAccountSummary {
  const login = overrides.login ?? 'branchpilot-user'

  return {
    login,
    label: overrides.label ?? login,
    type: overrides.type ?? 'user',
    url: `https://github.com/${login}`,
    ...overrides
  }
}

export function toGhPullRequestJson(pullRequest: GitHubPullRequest) {
  return {
    number: pullRequest.number,
    title: pullRequest.title,
    url: pullRequest.url,
    state: pullRequest.state,
    headRefName: pullRequest.headBranch,
    baseRefName: pullRequest.baseBranch,
    isDraft: pullRequest.draft
  }
}

export function toGhAccountJson(account: GitHubAccountSummary) {
  return {
    login: account.login,
    name: account.label,
    description: account.label,
    type: account.type === 'organization' ? 'Organization' : 'User',
    html_url: account.url
  }
}

export function toGhRepositoryJson(repository: GitHubRepositorySummary) {
  return {
    name: repository.name,
    nameWithOwner: repository.nameWithOwner,
    owner: {
      login: repository.owner
    },
    description: repository.description,
    visibility: repository.visibility,
    isPrivate: repository.isPrivate,
    isFork: repository.isFork,
    isArchived: repository.isArchived,
    url: repository.url,
    sshUrl: repository.sshUrl,
    defaultBranchRef: {
      name: repository.defaultBranch
    },
    updatedAt: repository.updatedAt,
    pushedAt: repository.pushedAt
  }
}

export function toGhPullRequestDetailsJson(pullRequest: GitHubPullRequestDetails) {
  return {
    ...toGhPullRequestJson(pullRequest),
    body: pullRequest.body,
    author: pullRequest.author,
    createdAt: pullRequest.createdAt,
    updatedAt: pullRequest.updatedAt,
    additions: pullRequest.additions,
    deletions: pullRequest.deletions,
    changedFiles: pullRequest.changedFiles
  }
}

export function toGhPullRequestCheckJson(check: GitHubPullRequestCheck) {
  return {
    name: check.name,
    state: check.state,
    bucket: check.bucket,
    workflow: check.workflow,
    description: check.description,
    link: check.link,
    startedAt: check.startedAt,
    completedAt: check.completedAt
  }
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json'
    }
  })
}
