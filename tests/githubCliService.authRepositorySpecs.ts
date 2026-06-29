import { expect, it } from 'vitest'
import {
  connectGitHubAuthentication,
  getGitHubCliStatus,
  listGitHubAccounts,
  listGitHubContributors,
  listGitHubRepositories,
  searchGitHubCoAuthors
} from '../electron/providers/githubCliService'
import {
  FakeGitHubApiClient,
  FakeGitHubCredentialProvider,
  GitHubCliTestRunner,
  jsonResponse,
  makeAccount,
  makeCoAuthor,
  makeRepository
} from './support/githubCliTestSupport'

export function registerGitHubAuthRepositorySpecs() {
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

  it('lists current repository collaborators for co-author suggestions through gh', async () => {
    const runner = new GitHubCliTestRunner({
      remoteUrl: 'https://github.com/branchpilot-org/project.git',
      repositoryCollaborators: [
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
    })

    await expect(listGitHubContributors(runner, '/repo')).resolves.toEqual([
      {
        name: 'Ada Lovelace',
        email: '1843+ada-lovelace@users.noreply.github.com',
        login: 'ada-lovelace',
        avatarUrl: 'https://avatars.githubusercontent.com/ada-lovelace',
        profileUrl: 'https://github.com/ada-lovelace',
        source: 'collaborator',
        organization: undefined
      },
      {
        name: 'Grace Hopper',
        email: '1906+grace-hopper@users.noreply.github.com',
        login: 'grace-hopper',
        avatarUrl: 'https://avatars.githubusercontent.com/grace-hopper',
        profileUrl: 'https://github.com/grace-hopper',
        source: 'collaborator',
        organization: undefined
      }
    ])

    expect(runner.ghApiArgs).toContainEqual([
      'api',
      'repos/branchpilot-org/project/collaborators?affiliation=all&per_page=100',
      '--paginate'
    ])
    expect(runner.ghApiArgs).not.toContainEqual([
      'api',
      'repos/branchpilot-org/project/contributors?per_page=100'
    ])
  })

  it('lists current repository collaborators through Git Credential Manager credentials', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input)

      if (url === 'https://api.github.com/user') {
        return jsonResponse({ login: 'desktop-user' })
      }

      if (url === 'https://api.github.com/repos/branchpilot-org/project/collaborators?affiliation=all&per_page=100') {
        return jsonResponse([
          {
            login: 'ada-lovelace',
            id: 1843,
            name: 'Ada Lovelace',
            avatar_url: 'https://avatars.githubusercontent.com/ada-lovelace',
            html_url: 'https://github.com/ada-lovelace',
            type: 'User'
          }
        ])
      }

      return jsonResponse({ message: `Unexpected URL ${url}` }, 404)
    }) as typeof fetch

    try {
      await expect(listGitHubContributors(
        new GitHubCliTestRunner({
          ghAuthenticated: false,
          remoteUrl: 'https://github.com/branchpilot-org/project.git'
        }),
        '/repo',
        new FakeGitHubCredentialProvider()
      )).resolves.toEqual([
        {
          name: 'Ada Lovelace',
          email: '1843+ada-lovelace@users.noreply.github.com',
          login: 'ada-lovelace',
          avatarUrl: 'https://avatars.githubusercontent.com/ada-lovelace',
          profileUrl: 'https://github.com/ada-lovelace',
          source: 'collaborator',
          organization: undefined
        }
      ])
    } finally {
      globalThis.fetch = originalFetch
    }
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

  it('scopes GitHub organization co-author suggestions to the current remote owner', async () => {
    const runner = new GitHubCliTestRunner({
      remoteUrl: 'https://github.com/branchpilot-org/project.git',
      accounts: [
        makeAccount({ login: 'branchpilot-user', type: 'user' }),
        makeAccount({ login: 'branchpilot-org', label: 'BranchPilot Org', type: 'organization' }),
        makeAccount({ login: 'other-org', label: 'Other Org', type: 'organization' })
      ],
      orgMembers: {
        'branchpilot-org': [
          makeCoAuthor({
            name: 'Ada Lovelace',
            login: 'ada-lovelace',
            email: '1843+ada-lovelace@users.noreply.github.com'
          })
        ],
        'other-org': [
          makeCoAuthor({
            name: 'Wrong Person',
            login: 'wrong-person',
            email: '9999+wrong-person@users.noreply.github.com'
          })
        ]
      }
    })

    await expect(searchGitHubCoAuthors(
      runner,
      { repoPath: '/repo', query: 'person', limit: 10 },
      new FakeGitHubCredentialProvider(null)
    )).resolves.toEqual([])

    expect(runner.ghApiArgs).toContainEqual([
      'api',
      'orgs/branchpilot-org/members?per_page=100',
      '--paginate'
    ])
    expect(runner.ghApiArgs).not.toContainEqual([
      'api',
      'orgs/other-org/members?per_page=100',
      '--paginate'
    ])
  })

  it('does not list organization members for personal repository co-author search', async () => {
    const runner = new GitHubCliTestRunner({
      remoteUrl: 'https://github.com/branchpilot-user/project.git',
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
      { repoPath: '/repo', query: 'ada', limit: 10 },
      new FakeGitHubCredentialProvider(null)
    )).resolves.toEqual([])

    expect(runner.ghApiArgs).not.toContainEqual([
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
}
