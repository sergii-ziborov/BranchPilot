import { describe, expect, it } from 'vitest'
import {
  CommandExecutionError,
  type CommandRunOptions,
  type CommandRunResult,
  CommandRunner
} from '../electron/lib/commandRunner'
import {
  checkoutGitHubPullRequest,
  createGitHubPullRequest,
  getCurrentBranchPullRequest,
  getGitHubCliStatus,
  getGitHubPullRequestChecks,
  getGitHubPullRequestDetails,
  getGitHubPullRequestDiff,
  listGitHubAccounts,
  listGitHubRepositories,
  listGitHubPullRequests
} from '../electron/providers/githubCliService'
import type {
  GitHubApiClient,
  GitHubCredentialProvider,
  GitHubDesktopCredential
} from '../electron/providers/githubCliService'
import type {
  GitHubAccountSummary,
  GitHubPullRequest,
  GitHubPullRequestCheck,
  GitHubPullRequestDetails,
  GitHubPullRequestDiff,
  GitHubRepositorySummary,
  ListGitHubRepositoriesRequest
} from '../src/shared/branchPilot'

describe('GitHub CLI bridge', () => {
  it('detects missing, unauthenticated, and authenticated gh states', async () => {
    const noCredential = new FakeGitHubCredentialProvider(null)
    const apiClient = new FakeGitHubApiClient()

    await expect(getGitHubCliStatus(
      new GitHubCliTestRunner({ ghInstalled: false }),
      undefined,
      noCredential,
      apiClient
    )).resolves.toMatchObject({
      state: 'missing',
      installed: false,
      authenticated: false
    })

    await expect(getGitHubCliStatus(
      new GitHubCliTestRunner({ ghAuthenticated: false }),
      undefined,
      noCredential,
      apiClient
    )).resolves.toMatchObject({
      state: 'unauthenticated',
      installed: true,
      authenticated: false
    })

    await expect(getGitHubCliStatus(
      new GitHubCliTestRunner({ ghAuthenticated: true }),
      undefined,
      noCredential,
      apiClient
    )).resolves.toMatchObject({
      state: 'authenticated',
      installed: true,
      authenticated: true,
      ghAuthenticated: true,
      gitCredentialAuthenticated: false,
      authProvider: 'gh',
      username: 'branchpilot-user'
    })
  })

  it('detects GitHub Desktop credentials when gh is not authenticated', async () => {
    const credentialProvider = new FakeGitHubCredentialProvider()
    const apiClient = new FakeGitHubApiClient()

    await expect(getGitHubCliStatus(
      new GitHubCliTestRunner({ ghAuthenticated: false }),
      '/repo',
      credentialProvider,
      apiClient
    )).resolves.toMatchObject({
      state: 'authenticated',
      installed: true,
      authenticated: true,
      ghAuthenticated: false,
      gitCredentialAuthenticated: true,
      authProvider: 'git-credential',
      username: 'desktop-user'
    })
  })

  it('lists GitHub user and organization accounts through gh', async () => {
    const runner = new GitHubCliTestRunner({
      accounts: [
        makeAccount({ login: 'branchpilot-user', type: 'user' }),
        makeAccount({ login: 'branchpilot-org', label: 'BranchPilot Org', type: 'organization' })
      ]
    })

    await expect(listGitHubAccounts(runner)).resolves.toEqual([
      makeAccount({ login: 'branchpilot-user', type: 'user' }),
      makeAccount({ login: 'branchpilot-org', label: 'BranchPilot Org', type: 'organization' })
    ])

    expect(runner.ghApiArgs).toEqual([
      ['api', 'user'],
      ['api', 'user/orgs', '--paginate']
    ])
  })

  it('lists GitHub accounts through GitHub Desktop credentials when gh is not authenticated', async () => {
    const apiClient = new FakeGitHubApiClient([], [
      makeAccount({ login: 'desktop-user', type: 'user' }),
      makeAccount({ login: 'desktop-org', type: 'organization' })
    ])

    await expect(listGitHubAccounts(
      new GitHubCliTestRunner({ ghAuthenticated: false }),
      new FakeGitHubCredentialProvider(),
      apiClient
    )).resolves.toEqual([
      makeAccount({ login: 'desktop-user', type: 'user' }),
      makeAccount({ login: 'desktop-org', type: 'organization' })
    ])
  })

  it('blocks GitHub account listing when no authentication is available', async () => {
    await expect(listGitHubAccounts(
      new GitHubCliTestRunner({ ghAuthenticated: false }),
      new FakeGitHubCredentialProvider(null),
      new FakeGitHubApiClient()
    )).rejects.toMatchObject({
      code: 'github_cli_unauthenticated'
    })
  })

  it('lists GitHub repositories through gh and filters by query locally', async () => {
    const runner = new GitHubCliTestRunner({
      repositories: [
        makeRepository({ name: 'BranchPilot', nameWithOwner: 'sergii-ziborov/BranchPilot', description: 'Desktop Git client' }),
        makeRepository({ name: 'appi', nameWithOwner: 'sergii-ziborov/appi', description: 'Other app' })
      ]
    })

    await expect(listGitHubRepositories(runner, {
      owner: 'sergii-ziborov',
      query: 'pilot',
      visibility: 'private',
      limit: 50
    })).resolves.toEqual([
      makeRepository({ name: 'BranchPilot', nameWithOwner: 'sergii-ziborov/BranchPilot', description: 'Desktop Git client' })
    ])

    expect(runner.ghRepoListArgs).toEqual([
      'repo',
      'list',
      'sergii-ziborov',
      '--json',
      'name,nameWithOwner,owner,description,visibility,isPrivate,isFork,isArchived,url,sshUrl,defaultBranchRef,updatedAt,pushedAt',
      '--limit',
      '50',
      '--no-archived',
      '--visibility',
      'private'
    ])
  })

  it('lists GitHub repositories through GitHub Desktop credentials when gh is not authenticated', async () => {
    const apiClient = new FakeGitHubApiClient([
      makeRepository({ name: 'BranchPilot', nameWithOwner: 'sergii-ziborov/BranchPilot', description: 'Desktop Git client' }),
      makeRepository({ name: 'private-tools', nameWithOwner: 'sergii-ziborov/private-tools', visibility: 'PRIVATE' }),
      makeRepository({ name: 'public-site', nameWithOwner: 'sergii-ziborov/public-site', visibility: 'PUBLIC', isPrivate: false })
    ])

    await expect(listGitHubRepositories(
      new GitHubCliTestRunner({ ghAuthenticated: false }),
      {
        owner: 'sergii-ziborov',
        query: 'pilot',
        visibility: 'private',
        limit: 75
      },
      new FakeGitHubCredentialProvider(),
      apiClient
    )).resolves.toEqual([
      makeRepository({ name: 'BranchPilot', nameWithOwner: 'sergii-ziborov/BranchPilot', description: 'Desktop Git client' })
    ])

    expect(apiClient.listRequest).toMatchObject({
      owner: 'sergii-ziborov',
      query: 'pilot',
      visibility: 'private',
      limit: 75
    })
  })

  it('rejects invalid GitHub repository list output', async () => {
    await expect(listGitHubRepositories(new GitHubCliTestRunner({ repoListOutput: 'not-json' }))).rejects.toMatchObject({
      code: 'github_repo_parse_failed'
    })
  })

  it('blocks GitHub repository listing when no authentication is available', async () => {
    await expect(listGitHubRepositories(
      new GitHubCliTestRunner({ ghAuthenticated: false }),
      {},
      new FakeGitHubCredentialProvider(null),
      new FakeGitHubApiClient()
    )).rejects.toMatchObject({
      code: 'github_cli_unauthenticated'
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

  it('accepts ssh URL GitHub remotes', async () => {
    const runner = new GitHubCliTestRunner({
      remoteUrl: 'ssh://git@github.com/example/project.git',
      upstream: 'origin/feature/test'
    })

    await expect(createGitHubPullRequest(runner, {
      repoPath: '/repo',
      title: 'Add SSH URL remote support',
      description: '',
      baseBranch: 'main'
    })).resolves.toMatchObject({
      url: 'https://github.com/example/project/pull/42'
    })
  })

  it('rejects remotes that only mention github.com outside the host', async () => {
    for (const remoteUrl of [
      'https://gitlab.com/github.com/example/project.git',
      'https://github.com.evil.test/example/project.git',
      'ssh://git@example.test/github.com/example/project.git'
    ]) {
      await expect(createGitHubPullRequest(new GitHubCliTestRunner({ remoteUrl }), {
        repoPath: '/repo',
        title: 'Wrong remote',
        description: ''
      })).rejects.toMatchObject({ code: 'github_remote_missing' })
    }
  })

  it('creates a pull request through GitHub API when GitHub Desktop credentials are available', async () => {
    const runner = new GitHubCliTestRunner({
      ghAuthenticated: false,
      remoteUrl: 'https://github.com/example/project.git',
      upstream: 'origin/feature/test'
    })
    const apiClient = new FakeGitHubApiClient()

    const result = await createGitHubPullRequest(
      runner,
      {
        repoPath: '/repo',
        title: 'Create with desktop credential',
        description: 'Uses the GitHub API fallback.',
        baseBranch: 'main'
      },
      new FakeGitHubCredentialProvider(),
      apiClient
    )

    expect(result).toEqual({
      url: 'https://github.com/example/project/pull/77',
      title: 'Create with desktop credential',
      baseBranch: 'main',
      headBranch: 'feature/test'
    })
    expect(runner.ghPrCreateArgs).toEqual([])
    expect(apiClient.createdPullRequest).toMatchObject({
      repository: {
        owner: 'example',
        repo: 'project'
      },
      request: {
        title: 'Create with desktop credential',
        description: 'Uses the GitHub API fallback.',
        baseBranch: 'main',
        headBranch: 'feature/test'
      }
    })
  })

  it('reads the current branch pull request and recent pull requests', async () => {
    const currentPullRequest = makePullRequest({
      number: 7,
      title: 'Add PR workflow',
      headBranch: 'feature/pr-workflow',
      baseBranch: 'main',
      draft: true
    })
    const pullRequests = [
      currentPullRequest,
      makePullRequest({
        number: 8,
        title: 'Tighten branch sync',
        headBranch: 'feature/sync'
      })
    ]
    const runner = new GitHubCliTestRunner({
      currentBranch: 'feature/pr-workflow',
      currentPullRequest,
      pullRequests
    })

    await expect(getCurrentBranchPullRequest(runner, '/repo')).resolves.toEqual(currentPullRequest)
    await expect(listGitHubPullRequests(runner, '/repo')).resolves.toEqual(pullRequests)
  })

  it('lists current and open pull requests through GitHub Desktop credentials', async () => {
    const currentPullRequest = makePullRequest({
      number: 7,
      title: 'Add PR workflow',
      headBranch: 'feature/pr-workflow',
      baseBranch: 'main'
    })
    const pullRequests = [
      currentPullRequest,
      makePullRequest({
        number: 8,
        title: 'Tighten branch sync',
        headBranch: 'feature/sync'
      })
    ]
    const apiClient = new FakeGitHubApiClient(undefined, undefined, pullRequests)
    const runner = new GitHubCliTestRunner({
      ghAuthenticated: false,
      currentBranch: 'feature/pr-workflow'
    })

    await expect(getCurrentBranchPullRequest(
      runner,
      '/repo',
      new FakeGitHubCredentialProvider(),
      apiClient
    )).resolves.toEqual(currentPullRequest)
    await expect(listGitHubPullRequests(
      runner,
      '/repo',
      new FakeGitHubCredentialProvider(),
      apiClient
    )).resolves.toEqual(pullRequests)
  })

  it('returns null when the current branch has no pull request', async () => {
    const runner = new GitHubCliTestRunner({ currentPullRequest: null })

    await expect(getCurrentBranchPullRequest(runner, '/repo')).resolves.toBeNull()
  })

  it('checks out a pull request through argv-only gh checkout', async () => {
    const runner = new GitHubCliTestRunner()

    await expect(checkoutGitHubPullRequest(runner, {
      repoPath: '/repo',
      prNumber: 42
    })).resolves.toBe('/repo')

    expect(runner.ghPrCheckoutArgs).toEqual(['pr', 'checkout', '42'])
  })

  it('reads pull request details, checks, and patch diff', async () => {
    const details = makePullRequestDetails({
      number: 7,
      title: 'Add PR details',
      body: 'Adds details, checks, and diff.',
      changedFiles: 1,
      additions: 1,
      deletions: 1
    })
    const checks = [
      makePullRequestCheck({ name: 'lint', bucket: 'pass', state: 'SUCCESS' }),
      makePullRequestCheck({ name: 'build', bucket: 'pending', state: 'PENDING' })
    ]
    const runner = new GitHubCliTestRunner({
      pullRequestDetails: details,
      pullRequestChecks: checks,
      prChecksExitCode: 8,
      prDiffOutput: [
        'diff --git a/src/App.tsx b/src/App.tsx',
        'index 1111111..2222222 100644',
        '--- a/src/App.tsx',
        '+++ b/src/App.tsx',
        '@@ -1,3 +1,3 @@',
        ' import React from "react"',
        '-const title = "Old"',
        '+const title = "New"',
        ' export default title',
        ''
      ].join('\n')
    })

    await expect(getGitHubPullRequestDetails(runner, {
      repoPath: '/repo',
      prNumber: 7
    })).resolves.toEqual(details)
    await expect(getGitHubPullRequestChecks(runner, {
      repoPath: '/repo',
      prNumber: 7
    })).resolves.toEqual(checks)

    const diff = await getGitHubPullRequestDiff(runner, {
      repoPath: '/repo',
      prNumber: 7
    })

    expect(diff.prNumber).toBe(7)
    expect(diff.files).toHaveLength(1)
    expect(diff.files[0]).toMatchObject({
      path: 'src/App.tsx',
      status: 'modified',
      additions: 1,
      deletions: 1
    })
    expect(diff.files[0].hunks[0].lines).toHaveLength(4)
    expect(runner.ghPrDetailsArgs).toEqual(expect.arrayContaining(['pr', 'view', '7', '--json']))
    expect(runner.ghPrChecksArgs).toEqual(expect.arrayContaining(['pr', 'checks', '7', '--json']))
    expect(runner.ghPrDiffArgs).toEqual(['pr', 'diff', '7', '--patch'])
  })

  it('reads pull request details through GitHub Desktop credentials', async () => {
    const details = makePullRequestDetails({
      number: 7,
      title: 'Add API details',
      body: 'Loaded without gh auth.',
      changedFiles: 2,
      additions: 4,
      deletions: 1
    })
    const apiClient = new FakeGitHubApiClient(undefined, undefined, undefined, details)

    await expect(getGitHubPullRequestDetails(
      new GitHubCliTestRunner({ ghAuthenticated: false }),
      {
        repoPath: '/repo',
        prNumber: 7
      },
      new FakeGitHubCredentialProvider(),
      apiClient
    )).resolves.toEqual(details)
  })

  it('reads pull request diff through GitHub Desktop credentials', async () => {
    const apiClient = new FakeGitHubApiClient(undefined, undefined, undefined, undefined, makePullRequestDiff())

    const diff = await getGitHubPullRequestDiff(
      new GitHubCliTestRunner({ ghAuthenticated: false }),
      {
        repoPath: '/repo',
        prNumber: 7
      },
      new FakeGitHubCredentialProvider(),
      apiClient
    )

    expect(diff.prNumber).toBe(7)
    expect(diff.files).toHaveLength(1)
    expect(diff.files[0]).toMatchObject({
      path: 'src/App.tsx',
      status: 'modified',
      additions: 1,
      deletions: 1
    })
    expect(diff.files[0].hunks[0].lines).toHaveLength(4)
    expect(diff.text).toContain('diff --git a/src/App.tsx b/src/App.tsx')
  })

  it('normalizes pull request diff files from the GitHub API fallback', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input)

      if (url === 'https://api.github.com/user') {
        return jsonResponse({ login: 'desktop-user' })
      }

      if (url.startsWith('https://api.github.com/repos/example/project/pulls/7/files')) {
        return jsonResponse([
          {
            filename: 'src/App.tsx',
            status: 'modified',
            additions: 1,
            deletions: 1,
            patch: [
              '@@ -1,3 +1,3 @@',
              ' import React from "react"',
              '-const title = "Old"',
              '+const title = "New"',
              ' export default title'
            ].join('\n')
          }
        ])
      }

      return jsonResponse({ message: `Unexpected URL ${url}` }, 404)
    }) as typeof fetch

    try {
      const diff = await getGitHubPullRequestDiff(
        new GitHubCliTestRunner({ ghAuthenticated: false }),
        {
          repoPath: '/repo',
          prNumber: 7
        },
        new FakeGitHubCredentialProvider()
      )

      expect(diff.files).toHaveLength(1)
      expect(diff.files[0]).toMatchObject({
        path: 'src/App.tsx',
        status: 'modified',
        additions: 1,
        deletions: 1
      })
      expect(diff.files[0].hunks[0].lines).toHaveLength(4)
      expect(diff.text).toContain('diff --git a/src/App.tsx b/src/App.tsx')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('blocks pull request creation when no GitHub auth path is available', async () => {
    const runner = new GitHubCliTestRunner({ ghAuthenticated: false })

    await expect(createGitHubPullRequest(runner, {
      repoPath: '/repo',
      title: 'Blocked',
      description: ''
    }, new FakeGitHubCredentialProvider(null), new FakeGitHubApiClient())).rejects.toMatchObject({
      code: 'github_auth_unauthenticated'
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

  it('blocks pull request list, view, and checkout when preconditions fail', async () => {
    await expect(listGitHubPullRequests(
      new GitHubCliTestRunner({ ghAuthenticated: false }),
      '/repo',
      new FakeGitHubCredentialProvider(null),
      new FakeGitHubApiClient()
    ))
      .rejects.toMatchObject({ code: 'github_auth_unauthenticated' })

    await expect(getCurrentBranchPullRequest(new GitHubCliTestRunner({ remoteUrl: 'https://gitlab.com/example/project.git' }), '/repo'))
      .rejects.toMatchObject({ code: 'github_remote_missing' })

    await expect(checkoutGitHubPullRequest(new GitHubCliTestRunner(), {
      repoPath: '/repo',
      prNumber: 0
    })).rejects.toMatchObject({ code: 'invalid_pr_number' })

    await expect(getGitHubPullRequestDetails(new GitHubCliTestRunner(), {
      repoPath: '/repo',
      prNumber: 0
    })).rejects.toMatchObject({ code: 'invalid_pr_number' })
  })

  it('rejects malformed pull request JSON from GitHub CLI', async () => {
    await expect(getCurrentBranchPullRequest(new GitHubCliTestRunner({ prViewOutput: '{' }), '/repo'))
      .rejects.toMatchObject({ code: 'github_pr_parse_failed' })

    await expect(listGitHubPullRequests(new GitHubCliTestRunner({ prListOutput: 'not-json' }), '/repo'))
      .rejects.toMatchObject({ code: 'github_pr_parse_failed' })

    await expect(getGitHubPullRequestDetails(new GitHubCliTestRunner({ prDetailsOutput: '{' }), {
      repoPath: '/repo',
      prNumber: 7
    })).rejects.toMatchObject({ code: 'github_pr_parse_failed' })

    await expect(getGitHubPullRequestChecks(new GitHubCliTestRunner({ prChecksOutput: 'not-json' }), {
      repoPath: '/repo',
      prNumber: 7
    })).rejects.toMatchObject({ code: 'github_pr_parse_failed' })
  })
})

interface GitHubCliTestRunnerOptions {
  ghInstalled?: boolean
  ghAuthenticated?: boolean
  remoteUrl?: string
  currentBranch?: string
  upstream?: string
  originHead?: string
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

class FakeGitHubCredentialProvider implements GitHubCredentialProvider {
  constructor(private readonly credential: GitHubDesktopCredential | null | undefined = {
    username: 'desktop-user',
    token: 'desktop-token'
  }) {}

  async getCredential(): Promise<GitHubDesktopCredential | undefined> {
    return this.credential ?? undefined
  }
}

class FakeGitHubApiClient implements GitHubApiClient {
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

class GitHubCliTestRunner extends CommandRunner {
  ghPrCreateArgs: string[] = []
  ghPrCheckoutArgs: string[] = []
  ghPrDetailsArgs: string[] = []
  ghPrChecksArgs: string[] = []
  ghPrDiffArgs: string[] = []
  ghApiArgs: string[][] = []
  ghRepoListArgs: string[] = []

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

function makePullRequest(overrides: Partial<GitHubPullRequest> = {}): GitHubPullRequest {
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

function makePullRequestDetails(overrides: Partial<GitHubPullRequestDetails> = {}): GitHubPullRequestDetails {
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

function makePullRequestCheck(overrides: Partial<GitHubPullRequestCheck> = {}): GitHubPullRequestCheck {
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

function makePullRequestDiff(overrides: Partial<GitHubPullRequestDiff> = {}): GitHubPullRequestDiff {
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

function makeRepository(overrides: Partial<GitHubRepositorySummary> = {}): GitHubRepositorySummary {
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

function makeAccount(overrides: Partial<GitHubAccountSummary> = {}): GitHubAccountSummary {
  const login = overrides.login ?? 'branchpilot-user'

  return {
    login,
    label: overrides.label ?? login,
    type: overrides.type ?? 'user',
    url: `https://github.com/${login}`,
    ...overrides
  }
}

function toGhPullRequestJson(pullRequest: GitHubPullRequest) {
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

function toGhAccountJson(account: GitHubAccountSummary) {
  return {
    login: account.login,
    name: account.label,
    description: account.label,
    type: account.type === 'organization' ? 'Organization' : 'User',
    html_url: account.url
  }
}

function toGhRepositoryJson(repository: GitHubRepositorySummary) {
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

function toGhPullRequestDetailsJson(pullRequest: GitHubPullRequestDetails) {
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

function toGhPullRequestCheckJson(check: GitHubPullRequestCheck) {
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

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json'
    }
  })
}
