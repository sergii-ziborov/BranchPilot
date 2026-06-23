import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type {
  CheckoutPullRequestRequest,
  CoAuthor,
  CreateGitHubRepositoryRequest,
  CreatePullRequestRequest,
  CreatedGitHubRepository,
  CreatedPullRequest,
  GitHubAccountSummary,
  GitHubCliStatus,
  GitHubCoAuthorSearchRequest,
  GitHubPullRequest,
  GitHubPullRequestCheck,
  GitHubPullRequestDetails,
  GitHubPullRequestDiff,
  GitHubRepositorySummary,
  ListGitHubRepositoriesRequest,
  PullRequestDetailsRequest
} from '../../src/shared/branchPilot.js'
import { CommandRunner } from '../lib/commandRunner.js'
import { BranchPilotUserError } from '../lib/errors.js'
import { GIT_EXECUTABLE } from '../lib/platformExecutables.js'
import {
  createGitHubApiPullRequest, createGitHubApiRepository, getGitHubApiPullRequestDetails, getGitHubApiPullRequestDiff, getGitHubApiViewer, githubApiHeaders, listGitHubApiAccounts, listGitHubApiPullRequests, listGitHubApiRepositories, parseGitHubUsername, parsePullRequestUrl, readGitHubApiJson, readGitHubDesktopCredential, tryGetGitHubApiViewer
} from './githubCliService.api.js'
import { normalizeConfigValue, normalizeRemoteName } from '../lib/repositoryService.helpers.js'
import {
  PR_CHECK_JSON_FIELDS, PR_DETAILS_JSON_FIELDS, PR_JSON_FIELDS, REPOSITORY_JSON_FIELDS, filterGitHubRepositories, normalizeGitHubAccount, normalizeGitHubPullRequestDetails, normalizeGitHubRepository, normalizeOptionalGitHubOwner, normalizePullRequestNumber, normalizeRepositoryListLimit, optionalString, parseGitHubAccountList, parseGitHubEmailList, parseGitHubJson, parseGitHubPullRequest, parseGitHubPullRequestChecks, parseGitHubPullRequestDiff, parseGitHubPullRequestList, parseGitHubRepositoryList, uniqueGitHubAccounts
} from './githubCliService.parsers.js'
import type { GitHubRepositoryInfo } from './githubCliService.shared.js'
import { isSafeGitHubPathSegment } from './githubCliService.shared.js'
import {
  assertHasUpstream, checkoutGitHubPullRequestWithGit, getCurrentBranch, getGitHubRemoteUrl, getGitHubRepositoryInfo, normalizeBranchName, resolveDefaultBaseBranch, resolveGhExecutable, resolveRepositoryRoot
} from './githubCliService.context.js'

export interface GitHubDesktopCredential {
  username?: string
  token: string
}

export interface GitHubCredentialProvider {
  getCredential(): Promise<GitHubDesktopCredential | undefined>
}

export interface GitHubApiPullRequest {
  url: string
  title: string
  baseBranch: string
  headBranch: string
}

export interface GitHubApiClient {
  getViewer(credential: GitHubDesktopCredential): Promise<{ login: string }>
  listAccounts(credential: GitHubDesktopCredential): Promise<GitHubAccountSummary[]>
  listRepositories(
    credential: GitHubDesktopCredential,
    request: ListGitHubRepositoriesRequest
  ): Promise<GitHubRepositorySummary[]>
  createRepository(
    credential: GitHubDesktopCredential,
    request: CreateGitHubRepositoryRequest
  ): Promise<GitHubRepositorySummary>
  listPullRequests(
    credential: GitHubDesktopCredential,
    repository: GitHubRepositoryInfo
  ): Promise<GitHubPullRequest[]>
  getPullRequestDetails(
    credential: GitHubDesktopCredential,
    repository: GitHubRepositoryInfo,
    prNumber: number
  ): Promise<GitHubPullRequestDetails>
  getPullRequestDiff(
    credential: GitHubDesktopCredential,
    repository: GitHubRepositoryInfo,
    prNumber: number
  ): Promise<GitHubPullRequestDiff>
  createPullRequest(
    credential: GitHubDesktopCredential,
    repository: GitHubRepositoryInfo,
    request: {
      title: string
      description: string
      baseBranch: string
      headBranch: string
    }
  ): Promise<GitHubApiPullRequest>
}

const DEFAULT_CREDENTIAL_PROVIDER: GitHubCredentialProvider = {
  getCredential: readGitHubDesktopCredential
}

const DEFAULT_API_CLIENT: GitHubApiClient = {
  getViewer: getGitHubApiViewer,
  listAccounts: listGitHubApiAccounts,
  listRepositories: listGitHubApiRepositories,
  createRepository: createGitHubApiRepository,
  listPullRequests: listGitHubApiPullRequests,
  getPullRequestDetails: getGitHubApiPullRequestDetails,
  getPullRequestDiff: getGitHubApiPullRequestDiff,
  createPullRequest: createGitHubApiPullRequest
}

export async function getGitHubCliStatus(
  runner: CommandRunner,
  repoPath?: string,
  credentialProvider = DEFAULT_CREDENTIAL_PROVIDER,
  apiClient = DEFAULT_API_CLIENT
): Promise<GitHubCliStatus> {
  const executable = await resolveGhExecutable(runner)

  if (executable) {
    const auth = await runner.run(executable, ['auth', 'status'], {
      cwd: repoPath,
      allowedExitCodes: [0, 1],
      timeoutMs: 15_000
    })

    if (auth.exitCode === 0) {
      return {
        state: 'authenticated',
        installed: true,
        authenticated: true,
        ghAuthenticated: true,
        gitCredentialAuthenticated: false,
        authProvider: 'gh',
        executable,
        username: parseGitHubUsername([auth.stdout, auth.stderr].filter(Boolean).join('\n')),
        message: 'GitHub CLI is authenticated.'
      }
    }
  }

  const credential = await credentialProvider.getCredential()
  const viewer = credential ? await tryGetGitHubApiViewer(apiClient, credential) : undefined

  if (credential && viewer) {
    return {
      state: 'authenticated',
      installed: Boolean(executable),
      authenticated: true,
      ghAuthenticated: false,
      gitCredentialAuthenticated: true,
      authProvider: 'git-credential',
      executable,
      username: viewer.login || credential.username,
      message: executable
        ? 'Git credential is available. GitHub CLI is installed but not authenticated.'
        : 'Git credential is available. GitHub CLI is not installed.'
    }
  }

  if (!executable) {
    return {
      state: 'missing',
      installed: false,
      authenticated: false,
      ghAuthenticated: false,
      gitCredentialAuthenticated: false,
      authProvider: 'none',
      message: 'No GitHub API credential was found. Connect with Git Credential Manager or install GitHub CLI.'
    }
  }

  return {
    state: 'unauthenticated',
    installed: true,
    authenticated: false,
    ghAuthenticated: false,
    gitCredentialAuthenticated: false,
    authProvider: 'none',
    executable,
    message: 'GitHub CLI is installed but not authenticated. Connect GitHub to sign in.'
  }
}

export async function connectGitHubAuthentication(
  runner: CommandRunner,
  repoPath?: string,
  credentialProvider = DEFAULT_CREDENTIAL_PROVIDER,
  apiClient = DEFAULT_API_CLIENT
): Promise<GitHubCliStatus> {
  const executable = await resolveGhExecutable(runner)

  try {
    if (executable) {
      await runner.run(executable, [
        'auth',
        'login',
        '--hostname',
        'github.com',
        '--git-protocol',
        'https',
        '--web'
      ], {
        cwd: repoPath,
        timeoutMs: 180_000
      })
    } else {
      await runner.run(GIT_EXECUTABLE, ['credential-manager', 'github', 'login'], {
        cwd: repoPath,
        timeoutMs: 180_000
      })
    }
  } catch (error) {
    if (error instanceof BranchPilotUserError) {
      throw error
    }

    throw new BranchPilotUserError(
      'github_auth_failed',
      'GitHub sign-in did not complete.',
      error instanceof Error ? error.message : String(error)
    )
  }

  const status = await getGitHubCliStatus(runner, repoPath, credentialProvider, apiClient)

  if (!status.authenticated) {
    throw new BranchPilotUserError(
      'github_auth_unauthenticated',
      'GitHub sign-in did not produce a usable API credential.',
      status.message
    )
  }

  return status
}

export async function createGitHubPullRequest(
  runner: CommandRunner,
  request: CreatePullRequestRequest,
  credentialProvider = DEFAULT_CREDENTIAL_PROVIDER,
  apiClient = DEFAULT_API_CLIENT
): Promise<CreatedPullRequest> {
  const rootPath = await resolveRepositoryRoot(runner, request.repoPath)
  const auth = await resolveGitHubAuth(runner, rootPath, credentialProvider, apiClient)
  const currentBranch = await getCurrentBranch(runner, rootPath)
  const headBranch = normalizeBranchName(request.headBranch || currentBranch, 'Head branch')

  if (headBranch !== currentBranch) {
    throw new BranchPilotUserError('invalid_branch', 'Only the checked-out branch can be used as the pull request head.')
  }

  await assertHasUpstream(runner, rootPath)

  const title = request.title.trim()

  if (!title) {
    throw new BranchPilotUserError('invalid_pr_title', 'Pull request title is required.')
  }

  const baseBranch = normalizeBranchName(request.baseBranch || await resolveDefaultBaseBranch(runner, rootPath), 'Base branch')

  if (auth.provider === 'git-credential') {
    const remote = await getGitHubRepositoryInfo(runner, rootPath)
    const pullRequest = await apiClient.createPullRequest(auth.credential, remote, {
      title,
      description: request.description.trim(),
      baseBranch,
      headBranch
    })

    return {
      url: pullRequest.url,
      title: pullRequest.title,
      baseBranch: pullRequest.baseBranch,
      headBranch: pullRequest.headBranch
    }
  }

  const bodyFile = path.join(os.tmpdir(), `branchpilot-pr-${Date.now()}.md`)

  await fs.writeFile(bodyFile, request.description.trim(), 'utf8')

  try {
    const result = await runner.run(auth.executable, [
      'pr',
      'create',
      '--title',
      title,
      '--body-file',
      bodyFile,
      '--base',
      baseBranch,
      '--head',
      headBranch
    ], {
      cwd: rootPath,
      timeoutMs: 120_000
    })

    return {
      url: parsePullRequestUrl(result.stdout),
      title,
      baseBranch,
      headBranch
    }
  } finally {
    await fs.rm(bodyFile, { force: true })
  }
}

export async function getCurrentBranchPullRequest(
  runner: CommandRunner,
  repoPath: string,
  credentialProvider = DEFAULT_CREDENTIAL_PROVIDER,
  apiClient = DEFAULT_API_CLIENT
): Promise<GitHubPullRequest | null> {
  const rootPath = await resolveRepositoryRoot(runner, repoPath)
  const auth = await resolveGitHubAuth(runner, rootPath, credentialProvider, apiClient)
  const currentBranch = await getCurrentBranch(runner, rootPath)

  if (auth.provider === 'git-credential') {
    const remote = await getGitHubRepositoryInfo(runner, rootPath)
    const pullRequests = await apiClient.listPullRequests(auth.credential, remote)

    return pullRequests.find((pullRequest) => pullRequest.headBranch === currentBranch) ?? null
  }

  const result = await runner.run(auth.executable, [
    'pr',
    'view',
    '--json',
    PR_JSON_FIELDS
  ], {
    cwd: rootPath,
    allowedExitCodes: [0, 1],
    timeoutMs: 30_000
  })

  if (result.exitCode !== 0 || !result.stdout.trim()) {
    return null
  }

  return parseGitHubPullRequest(result.stdout)
}

export async function listGitHubPullRequests(
  runner: CommandRunner,
  repoPath: string,
  credentialProvider = DEFAULT_CREDENTIAL_PROVIDER,
  apiClient = DEFAULT_API_CLIENT
): Promise<GitHubPullRequest[]> {
  const rootPath = await resolveRepositoryRoot(runner, repoPath)
  const auth = await resolveGitHubAuth(runner, rootPath, credentialProvider, apiClient)

  if (auth.provider === 'git-credential') {
    return apiClient.listPullRequests(auth.credential, await getGitHubRepositoryInfo(runner, rootPath))
  }

  const result = await runner.run(auth.executable, [
    'pr',
    'list',
    '--json',
    PR_JSON_FIELDS,
    '--limit',
    '30'
  ], {
    cwd: rootPath,
    timeoutMs: 30_000
  })

  return parseGitHubPullRequestList(result.stdout)
}

export async function listGitHubAccounts(
  runner: CommandRunner,
  credentialProvider = DEFAULT_CREDENTIAL_PROVIDER,
  apiClient = DEFAULT_API_CLIENT
): Promise<GitHubAccountSummary[]> {
  const status = await getGitHubCliStatus(runner, undefined, credentialProvider, apiClient)

  if (status.authProvider === 'git-credential') {
    const credential = await credentialProvider.getCredential()

    if (credential) {
      return apiClient.listAccounts(credential)
    }
  }

  if (status.state === 'missing') {
    throw new BranchPilotUserError('github_cli_missing', 'No GitHub API credential is available.')
  }

  if (status.authProvider !== 'gh' || !status.executable) {
    throw new BranchPilotUserError('github_cli_unauthenticated', 'Connect GitHub before browsing GitHub accounts.')
  }

  const viewerResult = await runner.run(status.executable, ['api', 'user'], {
    timeoutMs: 30_000
  })
  const orgsResult = await runner.run(status.executable, ['api', 'user/orgs', '--paginate'], {
    timeoutMs: 45_000
  })
  const emailsResult = await runner.run(status.executable, ['api', 'user/emails', '--paginate'], {
    allowedExitCodes: [0, 1],
    timeoutMs: 30_000
  })
  const viewer = normalizeGitHubAccount(parseGitHubJson(viewerResult.stdout, 'github_account_parse_failed', 'GitHub CLI did not return a valid account.'), 'user')
  const emails = emailsResult.exitCode === 0 ? safeParseGitHubEmailList(emailsResult.stdout) : []

  if (emails.length > 0) {
    viewer.emails = emails
  }

  return uniqueGitHubAccounts([
    viewer,
    ...parseGitHubAccountList(orgsResult.stdout, 'organization')
  ])
}

function safeParseGitHubEmailList(output: string): string[] {
  try {
    return parseGitHubEmailList(output)
  } catch {
    return []
  }
}

export async function listGitHubContributors(runner: CommandRunner, repoPath: string): Promise<CoAuthor[]> {
  const rootPath = await resolveRepositoryRoot(runner, repoPath)
  const status = await getGitHubCliStatus(runner, rootPath)

  if (status.authProvider !== 'gh' || !status.executable) {
    return []
  }

  let remote
  try {
    remote = await getGitHubRepositoryInfo(runner, rootPath)
  } catch {
    return []
  }

  const result = await runner.run(status.executable, ['api', `repos/${remote.owner}/${remote.repo}/contributors?per_page=100`], {
    cwd: rootPath,
    allowedExitCodes: [0, 1],
    timeoutMs: 30_000
  })

  if (result.exitCode !== 0) return []

  let parsed: unknown
  try {
    parsed = JSON.parse(result.stdout)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []

  const contributors: CoAuthor[] = []
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    const login = typeof record.login === 'string' ? record.login : ''
    const id = record.id
    const type = typeof record.type === 'string' ? record.type : 'User'
    if (!login || typeof id !== 'number' || type !== 'User') continue
    contributors.push({
      name: login,
      email: `${id}+${login}@users.noreply.github.com`,
      login,
      avatarUrl: typeof record.avatar_url === 'string' ? record.avatar_url : undefined,
      profileUrl: typeof record.html_url === 'string' ? record.html_url : `https://github.com/${login}`,
      source: 'github'
    })
  }

  return contributors.slice(0, 100)
}

export async function searchGitHubCoAuthors(
  runner: CommandRunner,
  request: GitHubCoAuthorSearchRequest,
  credentialProvider = DEFAULT_CREDENTIAL_PROVIDER
): Promise<CoAuthor[]> {
  const query = normalizeCoAuthorSearchQuery(request.query)
  if (query.length === 1) return []

  const limit = normalizeCoAuthorSearchLimit(request.limit)
  const status = await getGitHubCliStatus(runner, request.repoPath)

  if (status.authProvider === 'git-credential') {
    const credential = await credentialProvider.getCredential()

    if (!credential) return []

    return filterCoAuthorPool(await loadGitCredentialCoAuthorPool(credential), query, limit)
  }

  if (status.authProvider !== 'gh' || !status.executable) {
    return []
  }

  return filterCoAuthorPool(await loadGhCoAuthorPool(runner, status.executable), query, limit)
}

async function loadGitCredentialCoAuthorPool(credential: GitHubDesktopCredential): Promise<CoAuthor[]> {
  const [viewer, orgs] = await Promise.all([
    fetchGitHubApiJson('https://api.github.com/user', credential),
    fetchGitHubApiJson('https://api.github.com/user/orgs?per_page=100', credential).catch(() => [])
  ])
  const contributors: CoAuthor[] = []
  const viewerContributor = normalizeGitHubUserCoAuthor(viewer, 'github')

  if (viewerContributor) contributors.push(viewerContributor)

  for (const org of Array.isArray(orgs) ? orgs : []) {
    const orgLogin = normalizeGitHubLogin(org)
    if (!orgLogin) continue

    const members = await fetchGitHubApiJson(`https://api.github.com/orgs/${orgLogin}/members?per_page=100`, credential)
      .catch(() => [])

    for (const member of Array.isArray(members) ? members : []) {
      const contributor = normalizeGitHubUserCoAuthor(member, 'organization', orgLogin)
      if (contributor) contributors.push(contributor)
    }
  }

  return uniqueCoAuthors(contributors)
}

async function fetchGitHubApiJson(url: string, credential: GitHubDesktopCredential): Promise<unknown> {
  const response = await fetch(url, {
    headers: githubApiHeaders(credential)
  })
  const body = await readGitHubApiJson(response)

  if (!response.ok) {
    return []
  }

  return body
}

async function loadGhCoAuthorPool(runner: CommandRunner, executable: string): Promise<CoAuthor[]> {
  const [viewer, orgs] = await Promise.all([
    runGhApiJson(runner, executable, 'user'),
    runGhApiJson(runner, executable, 'user/orgs', true)
  ])
  const contributors: CoAuthor[] = []
  const viewerContributor = normalizeGitHubUserCoAuthor(viewer, 'github')

  if (viewerContributor) contributors.push(viewerContributor)

  for (const org of Array.isArray(orgs) ? orgs : []) {
    const orgLogin = normalizeGitHubLogin(org)
    if (!orgLogin) continue

    const members = await runGhApiJson(runner, executable, `orgs/${orgLogin}/members?per_page=100`, true)

    for (const member of Array.isArray(members) ? members : []) {
      const contributor = normalizeGitHubUserCoAuthor(member, 'organization', orgLogin)
      if (contributor) contributors.push(contributor)
    }
  }

  return uniqueCoAuthors(contributors)
}

async function runGhApiJson(
  runner: CommandRunner,
  executable: string,
  endpoint: string,
  paginate = false
): Promise<unknown> {
  const result = await runner.run(executable, ['api', endpoint, ...(paginate ? ['--paginate'] : [])], {
    allowedExitCodes: [0, 1],
    timeoutMs: 30_000
  })

  if (result.exitCode !== 0) return []

  try {
    return JSON.parse(result.stdout) as unknown
  } catch {
    return []
  }
}

function normalizeGitHubUserCoAuthor(
  value: unknown,
  source: CoAuthor['source'],
  organization?: string
): CoAuthor | undefined {
  if (!value || typeof value !== 'object') return undefined

  const record = value as Record<string, unknown>
  const login = normalizeGitHubLogin(record)
  if (!login) return undefined

  const id = typeof record.id === 'number' && Number.isFinite(record.id)
    ? Math.trunc(record.id)
    : undefined
  const name = optionalString(record.name) ?? login

  return {
    name,
    email: id ? `${id}+${login}@users.noreply.github.com` : `${login}@users.noreply.github.com`,
    login,
    avatarUrl: optionalString(record.avatar_url),
    profileUrl: optionalString(record.html_url) ?? `https://github.com/${login}`,
    source,
    organization
  }
}

function normalizeGitHubLogin(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined

  const login = optionalString((value as Record<string, unknown>).login)
  return login && isSafeGitHubPathSegment(login) ? login : undefined
}

function filterCoAuthorPool(pool: CoAuthor[], query: string, limit: number): CoAuthor[] {
  const normalizedQuery = query.toLowerCase()

  return uniqueCoAuthors(pool)
    .filter((contributor) => [
      contributor.name,
      contributor.email,
      contributor.login ?? '',
      contributor.organization ?? ''
    ].some((value) => value.toLowerCase().includes(normalizedQuery)))
    .slice(0, limit)
}

function uniqueCoAuthors(contributors: CoAuthor[]): CoAuthor[] {
  const seen = new Map<string, CoAuthor>()

  for (const contributor of contributors) {
    const key = (contributor.email || contributor.login || contributor.name).toLowerCase()
    if (!key || seen.has(key)) continue
    seen.set(key, contributor)
  }

  return [...seen.values()]
}

function normalizeCoAuthorSearchQuery(query: string): string {
  return query.trim().replace(/\s+/g, ' ').slice(0, 80)
}

function normalizeCoAuthorSearchLimit(limit?: number): number {
  if (!Number.isFinite(limit)) return 12
  return Math.max(1, Math.min(100, Math.trunc(limit ?? 12)))
}

export async function listGitHubRepositories(
  runner: CommandRunner,
  request: ListGitHubRepositoriesRequest = {},
  credentialProvider = DEFAULT_CREDENTIAL_PROVIDER,
  apiClient = DEFAULT_API_CLIENT
): Promise<GitHubRepositorySummary[]> {
  const status = await getGitHubCliStatus(runner, undefined, credentialProvider, apiClient)
  const limit = normalizeRepositoryListLimit(request.limit)
  const owner = normalizeOptionalGitHubOwner(request.owner)

  if (status.authProvider === 'git-credential') {
    const credential = await credentialProvider.getCredential()

    if (credential) {
      return filterGitHubRepositories(await apiClient.listRepositories(credential, {
        ...request,
        owner,
        limit
      }), {
        ...request,
        owner,
        limit
      })
    }
  }

  if (status.state === 'missing') {
    throw new BranchPilotUserError('github_cli_missing', 'No GitHub API credential is available.')
  }

  if (status.authProvider !== 'gh' || !status.executable) {
    throw new BranchPilotUserError('github_cli_unauthenticated', 'Connect GitHub before browsing repositories.')
  }

  const args = [
    'repo',
    'list',
    ...(owner ? [owner] : []),
    '--json',
    REPOSITORY_JSON_FIELDS,
    '--limit',
    String(limit),
    '--no-archived'
  ]

  if (request.visibility && request.visibility !== 'all') {
    args.push('--visibility', request.visibility)
  }

  const result = await runner.run(status.executable, args, {
    timeoutMs: 45_000
  })

  return filterGitHubRepositories(parseGitHubRepositoryList(result.stdout), {
    ...request,
    owner,
    limit
  })
}

export async function createGitHubRepository(
  runner: CommandRunner,
  request: CreateGitHubRepositoryRequest,
  credentialProvider = DEFAULT_CREDENTIAL_PROVIDER,
  apiClient = DEFAULT_API_CLIENT
): Promise<GitHubRepositorySummary> {
  const normalized = normalizeCreateGitHubRepositoryRequest(request)
  const auth = await resolveGitHubCreationAuth(runner, credentialProvider, apiClient)

  if (auth.provider === 'git-credential') {
    return apiClient.createRepository(auth.credential, normalized)
  }

  return createGitHubRepositoryWithGh(runner, auth.executable, normalized)
}

export async function publishLocalGitHubRepository(
  runner: CommandRunner,
  request: CreateGitHubRepositoryRequest,
  credentialProvider = DEFAULT_CREDENTIAL_PROVIDER,
  apiClient = DEFAULT_API_CLIENT
): Promise<Omit<CreatedGitHubRepository, 'snapshot'> & { rootPath: string }> {
  if (!request.confirmed) {
    throw new BranchPilotUserError('confirmation_required', 'Creating a GitHub repository requires confirmation.')
  }

  const normalized = normalizeCreateGitHubRepositoryRequest(request)
  const rootPath = await resolveRepositoryRoot(runner, request.repoPath)
  const currentBranch = await getCurrentBranch(runner, rootPath)
  const remoteName = normalizeRemoteName(normalized.remoteName || 'origin')
  const existingRemote = await runner.run(GIT_EXECUTABLE, ['remote', 'get-url', remoteName], {
    cwd: rootPath,
    allowedExitCodes: [0, 2],
    timeoutMs: 10_000
  })

  if (existingRemote.exitCode === 0) {
    throw new BranchPilotUserError('git_remote_exists', `Remote "${remoteName}" is already configured.`)
  }

  if (normalized.gitUserName?.trim() || normalized.gitUserEmail?.trim()) {
    const name = normalizeConfigValue(normalized.gitUserName ?? '', 'Name')
    const email = normalizeConfigValue(normalized.gitUserEmail ?? '', 'Email')

    await runner.run(GIT_EXECUTABLE, ['config', '--local', 'user.name', name], { cwd: rootPath })
    await runner.run(GIT_EXECUTABLE, ['config', '--local', 'user.email', email], { cwd: rootPath })
  }

  const repository = await createGitHubRepository(runner, normalized, credentialProvider, apiClient)
  const protocol = normalized.remoteProtocol === 'ssh' ? 'ssh' : 'https'
  const remoteUrl = protocol === 'ssh'
    ? repository.sshUrl
    : `https://github.com/${repository.owner}/${repository.name}.git`

  if (!remoteUrl) {
    throw new BranchPilotUserError('github_repo_create_failed', 'GitHub did not return a usable remote URL.')
  }

  await runner.run(GIT_EXECUTABLE, ['remote', 'add', remoteName, remoteUrl], {
    cwd: rootPath,
    timeoutMs: 10_000
  })

  const starterFilesWritten = await writeRepositoryStarterFiles(rootPath, normalized)

  if (normalized.commitStarterFiles && starterFilesWritten.length > 0) {
    await runner.run(GIT_EXECUTABLE, ['add', '--', ...starterFilesWritten], {
      cwd: rootPath,
      timeoutMs: 10_000
    })
    await runner.run(GIT_EXECUTABLE, ['commit', '-m', 'Add repository starter files', '--', ...starterFilesWritten], {
      cwd: rootPath,
      timeoutMs: 30_000
    })
  }

  let pushed = false

  if (normalized.push !== false) {
    const hasHead = await runner.run(GIT_EXECUTABLE, ['rev-parse', '--verify', 'HEAD'], {
      cwd: rootPath,
      allowedExitCodes: [0, 128],
      timeoutMs: 10_000
    })

    if (hasHead.exitCode !== 0) {
      throw new BranchPilotUserError(
        'git_no_commits',
        'Create an initial commit before publishing, or enable starter file commit.'
      )
    }

    await runner.run(GIT_EXECUTABLE, ['push', '-u', remoteName, currentBranch], {
      cwd: rootPath,
      timeoutMs: 120_000
    })
    pushed = true
  }

  return {
    rootPath,
    name: repository.name,
    nameWithOwner: repository.nameWithOwner,
    owner: repository.owner,
    url: repository.url,
    sshUrl: repository.sshUrl,
    remoteName,
    remoteUrl,
    defaultBranch: repository.defaultBranch || currentBranch,
    pushed,
    starterFilesWritten
  }
}

export async function getGitHubPullRequestDetails(
  runner: CommandRunner,
  request: PullRequestDetailsRequest,
  credentialProvider = DEFAULT_CREDENTIAL_PROVIDER,
  apiClient = DEFAULT_API_CLIENT
): Promise<GitHubPullRequestDetails> {
  const rootPath = await resolveRepositoryRoot(runner, request.repoPath)
  const auth = await resolveGitHubAuth(runner, rootPath, credentialProvider, apiClient)
  const prNumber = normalizePullRequestNumber(request.prNumber)

  if (auth.provider === 'git-credential') {
    return apiClient.getPullRequestDetails(auth.credential, await getGitHubRepositoryInfo(runner, rootPath), prNumber)
  }

  const result = await runner.run(auth.executable, [
    'pr',
    'view',
    String(prNumber),
    '--json',
    PR_DETAILS_JSON_FIELDS
  ], {
    cwd: rootPath,
    timeoutMs: 30_000
  })

  return normalizeGitHubPullRequestDetails(parseGitHubJson(result.stdout))
}

export async function getGitHubPullRequestChecks(
  runner: CommandRunner,
  request: PullRequestDetailsRequest
): Promise<GitHubPullRequestCheck[]> {
  const rootPath = await resolveRepositoryRoot(runner, request.repoPath)
  const status = await assertGitHubCliReady(runner, rootPath)
  const prNumber = normalizePullRequestNumber(request.prNumber)
  const result = await runner.run(status.executable, [
    'pr',
    'checks',
    String(prNumber),
    '--json',
    PR_CHECK_JSON_FIELDS
  ], {
    cwd: rootPath,
    allowedExitCodes: [0, 1, 8],
    timeoutMs: 30_000
  })

  if (!result.stdout.trim() && result.exitCode !== 0) {
    throw new BranchPilotUserError('github_pr_checks_failed', 'GitHub CLI did not return pull request checks.', result.stderr)
  }

  return parseGitHubPullRequestChecks(result.stdout)
}

export async function getGitHubPullRequestDiff(
  runner: CommandRunner,
  request: PullRequestDetailsRequest,
  credentialProvider = DEFAULT_CREDENTIAL_PROVIDER,
  apiClient = DEFAULT_API_CLIENT
): Promise<GitHubPullRequestDiff> {
  const rootPath = await resolveRepositoryRoot(runner, request.repoPath)
  const auth = await resolveGitHubAuth(runner, rootPath, credentialProvider, apiClient)
  const prNumber = normalizePullRequestNumber(request.prNumber)

  if (auth.provider === 'git-credential') {
    return apiClient.getPullRequestDiff(auth.credential, await getGitHubRepositoryInfo(runner, rootPath), prNumber)
  }

  const result = await runner.run(auth.executable, ['pr', 'diff', String(prNumber), '--patch'], {
    cwd: rootPath,
    timeoutMs: 120_000
  })

  return parseGitHubPullRequestDiff(prNumber, result.stdout)
}

export async function checkoutGitHubPullRequest(
  runner: CommandRunner,
  request: CheckoutPullRequestRequest,
  credentialProvider = DEFAULT_CREDENTIAL_PROVIDER,
  apiClient = DEFAULT_API_CLIENT
): Promise<string> {
  const rootPath = await resolveRepositoryRoot(runner, request.repoPath)
  const auth = await resolveGitHubAuth(runner, rootPath, credentialProvider, apiClient)
  const prNumber = normalizePullRequestNumber(request.prNumber)

  if (auth.provider === 'git-credential') {
    await checkoutGitHubPullRequestWithGit(runner, rootPath, prNumber)
    return rootPath
  }

  await runner.run(auth.executable, ['pr', 'checkout', String(prNumber)], {
    cwd: rootPath,
    timeoutMs: 120_000
  })

  return rootPath
}

export async function isGitHubRepository(runner: CommandRunner, repoPath: string): Promise<boolean> {
  try {
    await getGitHubRemoteUrl(runner, await resolveRepositoryRoot(runner, repoPath))
    return true
  } catch {
    return false
  }
}

async function assertGitHubCliReady(runner: CommandRunner, rootPath: string): Promise<GitHubCliStatus & { executable: string }> {
  const status = await assertGitHubCliAuthenticated(runner, rootPath)

  await getGitHubRemoteUrl(runner, rootPath)

  return status
}

async function assertGitHubCliAuthenticated(runner: CommandRunner, repoPath?: string): Promise<GitHubCliStatus & { executable: string }> {
  const status = await getGitHubCliStatus(runner, repoPath)

  if (status.state === 'missing') {
    throw new BranchPilotUserError('github_cli_missing', 'GitHub CLI is not installed.')
  }

  if (status.authProvider !== 'gh' || !status.executable) {
    throw new BranchPilotUserError('github_cli_unauthenticated', 'Run gh auth login before using GitHub CLI actions.')
  }

  return {
    ...status,
    executable: status.executable
  }
}

async function resolveGitHubCreationAuth(
  runner: CommandRunner,
  credentialProvider: GitHubCredentialProvider,
  apiClient: GitHubApiClient
): Promise<
  | { provider: 'gh'; executable: string }
  | { provider: 'git-credential'; credential: GitHubDesktopCredential }
> {
  const status = await getGitHubCliStatus(runner, undefined, credentialProvider, apiClient)

  if (status.authProvider === 'gh' && status.executable) {
    return {
      provider: 'gh',
      executable: status.executable
    }
  }

  if (status.authProvider === 'git-credential') {
    const credential = await credentialProvider.getCredential()

    if (credential) {
      return {
        provider: 'git-credential',
        credential
      }
    }
  }

  if (status.state === 'missing') {
    throw new BranchPilotUserError(
      'github_auth_missing',
      'No GitHub authentication is available.',
      'Connect GitHub with GitHub CLI or Git Credential Manager.'
    )
  }

  throw new BranchPilotUserError(
    'github_auth_unauthenticated',
    'GitHub authentication is not ready.',
    'Connect GitHub with GitHub CLI or Git Credential Manager.'
  )
}

async function createGitHubRepositoryWithGh(
  runner: CommandRunner,
  executable: string,
  request: CreateGitHubRepositoryRequest
): Promise<GitHubRepositorySummary> {
  const viewerResult = await runner.run(executable, ['api', 'user'], {
    timeoutMs: 30_000
  })
  const viewer = parseGitHubJson(viewerResult.stdout, 'github_account_parse_failed', 'GitHub CLI did not return the authenticated user.')
  const viewerRecord = viewer && typeof viewer === 'object' && !Array.isArray(viewer)
    ? viewer as Record<string, unknown>
    : {}
  const viewerLogin = typeof viewerRecord.login === 'string' ? viewerRecord.login : ''
  const endpoint = request.owner === viewerLogin
    ? 'user/repos'
    : `orgs/${request.owner}/repos`
  const result = await runner.run(executable, [
    'api',
    '-X',
    'POST',
    endpoint,
    '-f',
    `name=${request.name}`,
    '-f',
    `description=${request.description}`,
    '-F',
    `private=${request.visibility === 'private' ? 'true' : 'false'}`,
    '-F',
    'auto_init=false'
  ], {
    timeoutMs: 60_000
  })

  return normalizeGitHubRepository(parseGitHubJson(result.stdout, 'github_repo_parse_failed', 'GitHub CLI did not return the created repository.'))
}

function normalizeCreateGitHubRepositoryRequest(request: CreateGitHubRepositoryRequest): CreateGitHubRepositoryRequest {
  const owner = request.owner.trim()
  const name = request.name.trim().replace(/\.git$/i, '')

  if (!isSafeGitHubPathSegment(owner)) {
    throw new BranchPilotUserError('invalid_github_owner', 'GitHub owner is invalid.')
  }

  if (!isSafeGitHubPathSegment(name) || name.startsWith('-')) {
    throw new BranchPilotUserError('invalid_github_repository', 'Repository name can contain letters, numbers, dots, underscores, and hyphens.')
  }

  return {
    ...request,
    owner,
    name,
    description: request.description.trim().slice(0, 350),
    visibility: request.visibility === 'private' ? 'private' : 'public',
    remoteName: request.remoteName?.trim() || 'origin',
    remoteProtocol: request.remoteProtocol === 'ssh' ? 'ssh' : 'https'
  }
}

async function writeRepositoryStarterFiles(rootPath: string, request: CreateGitHubRepositoryRequest): Promise<string[]> {
  const files = [
    { path: 'README.md', content: request.readme },
    { path: '.gitignore', content: request.gitignore }
  ].filter((file): file is { path: string; content: string } => Boolean(file.content?.trim()))
  const written: string[] = []

  for (const file of files) {
    const targetPath = path.join(rootPath, file.path)

    try {
      await fs.access(targetPath)
      continue
    } catch {
      await fs.writeFile(targetPath, ensureTrailingNewline(file.content), 'utf8')
      written.push(file.path)
    }
  }

  return written
}

function ensureTrailingNewline(content: string): string {
  return content.endsWith('\n') ? content : `${content}\n`
}

async function resolveGitHubAuth(
  runner: CommandRunner,
  rootPath: string,
  credentialProvider: GitHubCredentialProvider,
  apiClient: GitHubApiClient
): Promise<
  | { provider: 'gh'; executable: string }
  | { provider: 'git-credential'; credential: GitHubDesktopCredential }
> {
  const status = await getGitHubCliStatus(runner, rootPath, credentialProvider, apiClient)

  if (status.authProvider === 'gh' && status.executable) {
    await getGitHubRemoteUrl(runner, rootPath)

    return {
      provider: 'gh',
      executable: status.executable
    }
  }

  if (status.authProvider === 'git-credential') {
    const credential = await credentialProvider.getCredential()

    if (credential) {
      await getGitHubRemoteUrl(runner, rootPath)

      return {
        provider: 'git-credential',
        credential
      }
    }
  }

  if (status.state === 'missing') {
    throw new BranchPilotUserError(
      'github_auth_missing',
      'No GitHub authentication is available.',
      'Connect GitHub with GitHub CLI or Git Credential Manager.'
    )
  }

  throw new BranchPilotUserError(
    'github_auth_unauthenticated',
    'GitHub authentication is not ready.',
    'Connect GitHub with GitHub CLI or Git Credential Manager.'
  )
}

