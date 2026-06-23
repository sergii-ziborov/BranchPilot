import { describe, expect, it } from 'vitest'
import {
  checkoutGitHubPullRequest,
  connectGitHubAuthentication,
  createGitHubPullRequest,
  getCurrentBranchPullRequest,
  getGitHubCliStatus,
  getGitHubPullRequestChecks,
  getGitHubPullRequestDetails,
  getGitHubPullRequestDiff,
  listGitHubAccounts,
  listGitHubRepositories,
  listGitHubPullRequests,
  searchGitHubCoAuthors
} from '../electron/providers/githubCliService'
import type {
} from '../electron/providers/githubCliService'
import type {
} from '../src/shared/branchPilot'

import {
  FakeGitHubCredentialProvider,
  FakeGitHubApiClient,
  GitHubCliTestRunner,
  makePullRequest,
  makePullRequestDetails,
  makePullRequestCheck,
  makePullRequestDiff,
  makeRepository,
  makeAccount,
  makeCoAuthor,
  jsonResponse
} from './support/githubCliTestSupport'

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

  it('detects Git Credential Manager credentials when gh is not authenticated', async () => {
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

  it('connects GitHub through gh when GitHub CLI is installed', async () => {
    const runner = new GitHubCliTestRunner({ ghAuthenticated: true })

    await expect(connectGitHubAuthentication(
      runner,
      '/repo',
      new FakeGitHubCredentialProvider(null),
      new FakeGitHubApiClient()
    )).resolves.toMatchObject({
      authenticated: true,
      authProvider: 'gh'
    })

    expect(runner.ghAuthLoginArgs).toEqual([
      'auth',
      'login',
      '--hostname',
      'github.com',
      '--git-protocol',
      'https',
      '--web'
    ])
  })

  it('connects GitHub through Git Credential Manager when GitHub CLI is missing', async () => {
    const runner = new GitHubCliTestRunner({ ghInstalled: false })

    await expect(connectGitHubAuthentication(
      runner,
      '/repo',
      new FakeGitHubCredentialProvider(),
      new FakeGitHubApiClient()
    )).resolves.toMatchObject({
      authenticated: true,
      authProvider: 'git-credential',
      username: 'desktop-user'
    })

    expect(runner.gcmLoginArgs).toEqual(['credential-manager', 'github', 'login'])
  })

  it('lists GitHub user and organization accounts through gh', async () => {
    const runner = new GitHubCliTestRunner({
      userEmails: ['primary@branchpilot.test', 'work@branchpilot.test'],
      accounts: [
        makeAccount({ login: 'branchpilot-user', type: 'user' }),
        makeAccount({ login: 'branchpilot-org', label: 'BranchPilot Org', type: 'organization' })
      ]
    })

    await expect(listGitHubAccounts(runner)).resolves.toEqual([
      makeAccount({ login: 'branchpilot-user', type: 'user', emails: ['primary@branchpilot.test', 'work@branchpilot.test'] }),
      makeAccount({ login: 'branchpilot-org', label: 'BranchPilot Org', type: 'organization' })
    ])

    expect(runner.ghApiArgs).toEqual([
      ['api', 'user'],
      ['api', 'user/orgs', '--paginate'],
      ['api', 'user/emails', '--paginate']
    ])
  })

  it('lists GitHub accounts through Git Credential Manager credentials when gh is not authenticated', async () => {
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

  it('searches GitHub organization members for co-author suggestions through gh', async () => {
    const runner = new GitHubCliTestRunner({
      accounts: [
        makeAccount({ login: 'branchpilot-user', type: 'user' }),
        makeAccount({ login: 'branchpilot-org', label: 'BranchPilot Org', type: 'organization' })
      ],
      orgMembers: {
        'branchpilot-org': [
          makeCoAuthor({
            name: 'Ada Lovelace',
            login: 'ada-lovelace',
            email: '1843+ada-lovelace@users.noreply.github.com'
          }),
          makeCoAuthor({
            name: 'Grace Hopper',
            login: 'grace-hopper',
            email: '1906+grace-hopper@users.noreply.github.com'
          })
        ]
      }
    })

    await expect(searchGitHubCoAuthors(
      runner,
      { query: 'ada', limit: 5 },
      new FakeGitHubCredentialProvider(null)
    )).resolves.toEqual([
      {
        name: 'Ada Lovelace',
        email: '1843+ada-lovelace@users.noreply.github.com',
        login: 'ada-lovelace',
        avatarUrl: 'https://avatars.githubusercontent.com/ada-lovelace',
        profileUrl: 'https://github.com/ada-lovelace',
        source: 'organization',
        organization: 'branchpilot-org'
      }
    ])

    expect(runner.ghApiArgs).toContainEqual([
      'api',
      'orgs/branchpilot-org/members?per_page=100',
      '--paginate'
    ])
  })

  it('returns GitHub co-author suggestions for an empty search query', async () => {
    const runner = new GitHubCliTestRunner({
      accounts: [
        makeAccount({ login: 'branchpilot-user', type: 'user' }),
        makeAccount({ login: 'branchpilot-org', label: 'BranchPilot Org', type: 'organization' })
      ],
      orgMembers: {
        'branchpilot-org': [
          makeCoAuthor({
            name: 'Ada Lovelace',
            login: 'ada-lovelace',
            email: '1843+ada-lovelace@users.noreply.github.com'
          })
        ]
      }
    })

    await expect(searchGitHubCoAuthors(
      runner,
      { query: '', limit: 10 },
      new FakeGitHubCredentialProvider(null)
    )).resolves.toEqual([
      {
        name: 'branchpilot-user',
        email: 'branchpilot-user@users.noreply.github.com',
        login: 'branchpilot-user',
        avatarUrl: undefined,
        profileUrl: 'https://github.com/branchpilot-user',
        source: 'github',
        organization: undefined
      },
      {
        name: 'Ada Lovelace',
        email: '1843+ada-lovelace@users.noreply.github.com',
        login: 'ada-lovelace',
        avatarUrl: 'https://avatars.githubusercontent.com/ada-lovelace',
        profileUrl: 'https://github.com/ada-lovelace',
        source: 'organization',
        organization: 'branchpilot-org'
      }
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
      limit: 500
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
      '500',
      '--no-archived',
      '--visibility',
      'private'
    ])
  })

  it('lists GitHub repositories through Git Credential Manager credentials when gh is not authenticated', async () => {
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
        limit: 500
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
      limit: 500
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

  it('creates a pull request through GitHub API when Git Credential Manager credentials are available', async () => {
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

  it('lists current and open pull requests through Git Credential Manager credentials', async () => {
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

  it('checks out a pull request through system Git when using Git Credential Manager credentials', async () => {
    const runner = new GitHubCliTestRunner({ ghAuthenticated: false })

    await expect(checkoutGitHubPullRequest(
      runner,
      {
        repoPath: '/repo',
        prNumber: 42
      },
      new FakeGitHubCredentialProvider(),
      new FakeGitHubApiClient()
    )).resolves.toBe('/repo')

    expect(runner.gitFetchArgs).toEqual(['fetch', 'origin', 'pull/42/head'])
    expect(runner.gitSwitchArgs).toEqual(['switch', '-c', 'branchpilot/pr-42', 'FETCH_HEAD'])
    expect(runner.gitMergeArgs).toEqual([])
  })

  it('fast-forwards an existing local pull request branch on checkout fallback', async () => {
    const runner = new GitHubCliTestRunner({
      ghAuthenticated: false,
      localPullRequestBranchExists: true
    })

    await expect(checkoutGitHubPullRequest(
      runner,
      {
        repoPath: '/repo',
        prNumber: 42
      },
      new FakeGitHubCredentialProvider(),
      new FakeGitHubApiClient()
    )).resolves.toBe('/repo')

    expect(runner.gitFetchArgs).toEqual(['fetch', 'origin', 'pull/42/head'])
    expect(runner.gitSwitchArgs).toEqual(['switch', 'branchpilot/pr-42'])
    expect(runner.gitMergeArgs).toEqual(['merge', '--ff-only', 'FETCH_HEAD'])
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

  it('reads pull request details through Git Credential Manager credentials', async () => {
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

  it('reads pull request diff through Git Credential Manager credentials', async () => {
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

