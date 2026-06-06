import { promises as fs } from 'node:fs'
import { spawn } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import type {
  CheckoutPullRequestRequest,
  CreatePullRequestRequest,
  CreatedPullRequest,
  GitHubAccountSummary,
  GitHubCliStatus,
  GitHubPullRequest,
  GitHubPullRequestCheck,
  GitHubPullRequestDetails,
  GitHubPullRequestDiff,
  GitHubPullRequestDiffFile,
  GitHubRepositorySummary,
  ListGitHubRepositoriesRequest,
  PullRequestDetailsRequest
} from '../../src/shared/branchPilot.js'
import { parseUnifiedDiff } from '../lib/diffParser.js'
import { CommandRunner } from '../lib/commandRunner.js'
import { BranchPilotUserError } from '../lib/errors.js'

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

interface GitHubRepositoryInfo {
  owner: string
  repo: string
  remoteUrl: string
}

const DEFAULT_CREDENTIAL_PROVIDER: GitHubCredentialProvider = {
  getCredential: readGitHubDesktopCredential
}

const DEFAULT_API_CLIENT: GitHubApiClient = {
  getViewer: getGitHubApiViewer,
  listAccounts: listGitHubApiAccounts,
  listRepositories: listGitHubApiRepositories,
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
        ? 'GitHub Desktop credential is available. GitHub CLI is installed but not authenticated.'
        : 'GitHub Desktop credential is available. GitHub CLI is not installed.'
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
      message: 'GitHub CLI is not installed and no valid GitHub Desktop credential was found.'
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
    message: 'GitHub CLI is installed but not authenticated. Run gh auth login or sign in with GitHub Desktop.'
  }
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
    throw new BranchPilotUserError('github_cli_missing', 'GitHub CLI is not installed and no GitHub Desktop credential is available.')
  }

  if (status.authProvider !== 'gh' || !status.executable) {
    throw new BranchPilotUserError('github_cli_unauthenticated', 'Run gh auth login or sign in with GitHub Desktop before browsing GitHub accounts.')
  }

  const viewerResult = await runner.run(status.executable, ['api', 'user'], {
    timeoutMs: 30_000
  })
  const orgsResult = await runner.run(status.executable, ['api', 'user/orgs', '--paginate'], {
    timeoutMs: 45_000
  })

  return uniqueGitHubAccounts([
    normalizeGitHubAccount(parseGitHubJson(viewerResult.stdout, 'github_account_parse_failed', 'GitHub CLI did not return a valid account.'), 'user'),
    ...parseGitHubAccountList(orgsResult.stdout, 'organization')
  ])
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
    throw new BranchPilotUserError('github_cli_missing', 'GitHub CLI is not installed and no GitHub Desktop credential is available.')
  }

  if (status.authProvider !== 'gh' || !status.executable) {
    throw new BranchPilotUserError('github_cli_unauthenticated', 'Run gh auth login or sign in with GitHub Desktop before browsing repositories.')
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

async function resolveGhExecutable(runner: CommandRunner): Promise<string | undefined> {
  try {
    const result = await runner.run('/usr/bin/which', ['gh'], {
      timeoutMs: 5_000
    })

    return result.stdout.trim() || 'gh'
  } catch {
    return undefined
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
      'Install or authenticate GitHub CLI, or sign in with GitHub Desktop.'
    )
  }

  throw new BranchPilotUserError(
    'github_auth_unauthenticated',
    'GitHub authentication is not ready.',
    'Run gh auth login or sign in with GitHub Desktop.'
  )
}

async function resolveRepositoryRoot(runner: CommandRunner, repoPath: string): Promise<string> {
  const result = await runner.run('/usr/bin/git', ['rev-parse', '--show-toplevel'], {
    cwd: repoPath,
    timeoutMs: 10_000
  })

  return result.stdout.trim()
}

async function getGitHubRemoteUrl(runner: CommandRunner, rootPath: string): Promise<string> {
  return (await getGitHubRemote(runner, rootPath)).remoteUrl
}

async function getGitHubRemote(runner: CommandRunner, rootPath: string): Promise<GitHubRepositoryInfo & { remoteName: string }> {
  const result = await runner.run('/usr/bin/git', ['remote', '-v'], {
    cwd: rootPath,
    allowedExitCodes: [0, 1],
    timeoutMs: 10_000
  })

  for (const line of result.stdout.split('\n')) {
    const match = line.trim().match(/^(\S+)\s+(\S+)\s+\((fetch|push)\)$/)
    const parsed = match ? parseGitHubRemoteUrl(match[2]) : undefined

    if (match && parsed) {
      return {
        remoteName: match[1],
        remoteUrl: match[2],
        owner: parsed.owner,
        repo: parsed.repo
      }
    }
  }

  throw new BranchPilotUserError('github_remote_missing', 'No GitHub remote was found for this repository.')
}

async function getGitHubRepositoryInfo(runner: CommandRunner, rootPath: string): Promise<GitHubRepositoryInfo> {
  const remote = await getGitHubRemote(runner, rootPath)

  return {
    owner: remote.owner,
    repo: remote.repo,
    remoteUrl: remote.remoteUrl
  }
}

async function checkoutGitHubPullRequestWithGit(
  runner: CommandRunner,
  rootPath: string,
  prNumber: number
): Promise<void> {
  const remote = await getGitHubRemote(runner, rootPath)
  const branchName = `branchpilot/pr-${prNumber}`

  await runner.run('/usr/bin/git', ['fetch', remote.remoteName, `pull/${prNumber}/head`], {
    cwd: rootPath,
    timeoutMs: 120_000
  })

  const branchExists = await runner.run('/usr/bin/git', ['rev-parse', '--verify', `refs/heads/${branchName}`], {
    cwd: rootPath,
    allowedExitCodes: [0, 1],
    timeoutMs: 10_000
  })

  if (branchExists.exitCode === 0) {
    await runner.run('/usr/bin/git', ['switch', branchName], {
      cwd: rootPath,
      timeoutMs: 30_000
    })
    await runner.run('/usr/bin/git', ['merge', '--ff-only', 'FETCH_HEAD'], {
      cwd: rootPath,
      timeoutMs: 120_000
    })
    return
  }

  await runner.run('/usr/bin/git', ['switch', '-c', branchName, 'FETCH_HEAD'], {
    cwd: rootPath,
    timeoutMs: 30_000
  })
}

function parseGitHubRemoteUrl(remoteUrl: string): Pick<GitHubRepositoryInfo, 'owner' | 'repo'> | undefined {
  const trimmed = remoteUrl.trim()
  const scpMatch = trimmed.match(/^(?:[^@\s]+@)?github\.com:([^/\s]+)\/([^/\s]+?)(?:\.git)?$/i)

  if (scpMatch) {
    return normalizeGitHubRepositoryPath(scpMatch[1], scpMatch[2])
  }

  try {
    const parsedUrl = new URL(trimmed)

    if (parsedUrl.hostname.toLowerCase() !== 'github.com') {
      return undefined
    }

    const parts = parsedUrl.pathname
      .replace(/^\/+|\/+$/g, '')
      .split('/')
      .filter(Boolean)

    if (parts.length !== 2) {
      return undefined
    }

    return normalizeGitHubRepositoryPath(parts[0], parts[1])
  } catch {
    return undefined
  }
}

function normalizeGitHubRepositoryPath(owner: string, repo: string): Pick<GitHubRepositoryInfo, 'owner' | 'repo'> | undefined {
  const normalizedRepo = repo.replace(/\.git$/i, '')

  if (!isSafeGitHubPathSegment(owner) || !isSafeGitHubPathSegment(normalizedRepo)) {
    return undefined
  }

  return {
    owner,
    repo: normalizedRepo
  }
}

function isSafeGitHubPathSegment(value: string): boolean {
  return /^[A-Za-z0-9_.-]+$/.test(value)
}

async function getCurrentBranch(runner: CommandRunner, rootPath: string): Promise<string> {
  const result = await runner.run('/usr/bin/git', ['branch', '--show-current'], {
    cwd: rootPath,
    allowedExitCodes: [0, 1],
    timeoutMs: 10_000
  })
  const branch = result.stdout.trim()

  if (!branch) {
    throw new BranchPilotUserError('git_detached_head', 'Cannot create a pull request from a detached HEAD.')
  }

  return branch
}

async function assertHasUpstream(runner: CommandRunner, rootPath: string): Promise<void> {
  const upstream = await runner.run('/usr/bin/git', ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], {
    cwd: rootPath,
    allowedExitCodes: [0, 128],
    timeoutMs: 10_000
  })

  if (upstream.exitCode !== 0 || !upstream.stdout.trim()) {
    throw new BranchPilotUserError('git_no_upstream', 'Publish this branch before creating a pull request.')
  }
}

async function resolveDefaultBaseBranch(runner: CommandRunner, rootPath: string): Promise<string> {
  const originHead = await runner.run('/usr/bin/git', ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'], {
    cwd: rootPath,
    allowedExitCodes: [0, 1],
    timeoutMs: 10_000
  })
  const ref = originHead.stdout.trim()

  return ref ? ref.replace(/^origin\//, '') : 'main'
}

function normalizeBranchName(branchName: string, label: string): string {
  const trimmed = branchName.trim()

  if (!trimmed || trimmed.startsWith('-') || trimmed.includes('\0')) {
    throw new BranchPilotUserError('invalid_branch', `${label} is invalid.`)
  }

  return trimmed
}

function parseGitHubUsername(output: string): string | undefined {
  return output.match(/Logged in to [^\s]+ account ([^\s]+)/)?.[1]
}

async function readGitHubDesktopCredential(): Promise<GitHubDesktopCredential | undefined> {
  const output = await runPrivateCredentialFill()
  const credential = parseGitCredentialOutput(output)

  return credential?.token ? credential : undefined
}

async function runPrivateCredentialFill(): Promise<string> {
  return new Promise((resolve) => {
    const child = spawn('/usr/bin/git', ['credential', 'fill'], {
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe']
    })
    let stdout = ''

    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk
    })
    child.on('error', () => resolve(''))
    child.on('close', (exitCode) => {
      resolve(exitCode === 0 ? stdout : '')
    })
    child.stdin.write('protocol=https\nhost=github.com\n\n')
    child.stdin.end()
  })
}

function parseGitCredentialOutput(output: string): GitHubDesktopCredential | undefined {
  const values = new Map<string, string>()

  for (const line of output.split('\n')) {
    const index = line.indexOf('=')

    if (index <= 0) {
      continue
    }

    values.set(line.slice(0, index), line.slice(index + 1))
  }

  const token = values.get('password')?.trim()

  if (!token) {
    return undefined
  }

  return {
    username: values.get('username')?.trim() || undefined,
    token
  }
}

async function tryGetGitHubApiViewer(
  apiClient: GitHubApiClient,
  credential: GitHubDesktopCredential
): Promise<{ login: string } | undefined> {
  try {
    return await apiClient.getViewer(credential)
  } catch {
    return undefined
  }
}

async function getGitHubApiViewer(credential: GitHubDesktopCredential): Promise<{ login: string }> {
  const response = await fetch('https://api.github.com/user', {
    headers: githubApiHeaders(credential)
  })
  const body = await readGitHubApiBody(response)
  const login = typeof body.login === 'string' ? body.login : ''

  if (!response.ok || !login) {
    throw new BranchPilotUserError(
      'github_credential_invalid',
      'GitHub Desktop credential could not be verified.',
      githubApiErrorMessage(body, response.status)
    )
  }

  return { login }
}

async function listGitHubApiAccounts(credential: GitHubDesktopCredential): Promise<GitHubAccountSummary[]> {
  const [viewerResponse, orgsResponse] = await Promise.all([
    fetch('https://api.github.com/user', {
      headers: githubApiHeaders(credential)
    }),
    fetch('https://api.github.com/user/orgs?per_page=100', {
      headers: githubApiHeaders(credential)
    })
  ])
  const [viewerBody, orgsBody] = await Promise.all([
    readGitHubApiJson(viewerResponse),
    readGitHubApiJson(orgsResponse)
  ])

  if (!viewerResponse.ok) {
    throw new BranchPilotUserError(
      'github_account_list_failed',
      'GitHub API could not load the authenticated account.',
      githubApiErrorMessage(viewerBody, viewerResponse.status)
    )
  }

  if (!orgsResponse.ok) {
    throw new BranchPilotUserError(
      'github_account_list_failed',
      'GitHub API could not load organizations.',
      githubApiErrorMessage(orgsBody, orgsResponse.status)
    )
  }

  if (!Array.isArray(orgsBody)) {
    throw new BranchPilotUserError('github_account_parse_failed', 'GitHub API did not return an organization list.')
  }

  return uniqueGitHubAccounts([
    normalizeGitHubAccount(viewerBody, 'user'),
    ...orgsBody.map((value) => normalizeGitHubAccount(value, 'organization'))
  ])
}

async function createGitHubApiPullRequest(
  credential: GitHubDesktopCredential,
  repository: GitHubRepositoryInfo,
  request: {
    title: string
    description: string
    baseBranch: string
    headBranch: string
  }
): Promise<GitHubApiPullRequest> {
  const response = await fetch(`https://api.github.com/repos/${repository.owner}/${repository.repo}/pulls`, {
    method: 'POST',
    headers: {
      ...githubApiHeaders(credential),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      title: request.title,
      body: request.description,
      base: request.baseBranch,
      head: request.headBranch
    })
  })
  const body = await readGitHubApiBody(response)

  if (!response.ok) {
    throw new BranchPilotUserError(
      'github_pr_create_failed',
      'GitHub API could not create the pull request.',
      githubApiErrorMessage(body, response.status)
    )
  }

  const url = typeof body.html_url === 'string' ? body.html_url : ''

  if (!url) {
    throw new BranchPilotUserError(
      'github_pr_parse_failed',
      'GitHub API did not return a pull request URL.'
    )
  }

  return {
    url,
    title: typeof body.title === 'string' ? body.title : request.title,
    baseBranch: normalizeApiBranchRef(body.base, request.baseBranch),
    headBranch: normalizeApiBranchRef(body.head, request.headBranch)
  }
}

async function listGitHubApiRepositories(
  credential: GitHubDesktopCredential,
  request: ListGitHubRepositoriesRequest
): Promise<GitHubRepositorySummary[]> {
  const limit = normalizeRepositoryListLimit(request.limit)
  const url = new URL('https://api.github.com/user/repos')
  url.searchParams.set('per_page', String(limit))
  url.searchParams.set('sort', 'pushed')
  url.searchParams.set('direction', 'desc')
  url.searchParams.set('affiliation', 'owner,collaborator,organization_member')
  url.searchParams.set('visibility', request.visibility === 'public' || request.visibility === 'private'
    ? request.visibility
    : 'all')

  const response = await fetch(url, {
    headers: githubApiHeaders(credential)
  })
  const body = await readGitHubApiJson(response)

  if (!response.ok) {
    throw new BranchPilotUserError(
      'github_repo_list_failed',
      'GitHub API could not list repositories.',
      githubApiErrorMessage(body, response.status)
    )
  }

  if (!Array.isArray(body)) {
    throw new BranchPilotUserError('github_repo_parse_failed', 'GitHub API did not return a repository list.')
  }

  return filterGitHubRepositories(body.map((value) => normalizeGitHubRepository(value)), request)
}

async function listGitHubApiPullRequests(
  credential: GitHubDesktopCredential,
  repository: GitHubRepositoryInfo
): Promise<GitHubPullRequest[]> {
  const url = new URL(`https://api.github.com/repos/${repository.owner}/${repository.repo}/pulls`)
  url.searchParams.set('state', 'open')
  url.searchParams.set('per_page', '30')
  url.searchParams.set('sort', 'updated')
  url.searchParams.set('direction', 'desc')

  const response = await fetch(url, {
    headers: githubApiHeaders(credential)
  })
  const body = await readGitHubApiJson(response)

  if (!response.ok) {
    throw new BranchPilotUserError(
      'github_pr_list_failed',
      'GitHub API could not list pull requests.',
      githubApiErrorMessage(body, response.status)
    )
  }

  if (!Array.isArray(body)) {
    throw new BranchPilotUserError('github_pr_parse_failed', 'GitHub API did not return a pull request list.')
  }

  return body.map((value) => normalizeGitHubPullRequest(value))
}

async function getGitHubApiPullRequestDetails(
  credential: GitHubDesktopCredential,
  repository: GitHubRepositoryInfo,
  prNumber: number
): Promise<GitHubPullRequestDetails> {
  const response = await fetch(`https://api.github.com/repos/${repository.owner}/${repository.repo}/pulls/${prNumber}`, {
    headers: githubApiHeaders(credential)
  })
  const body = await readGitHubApiJson(response)

  if (!response.ok) {
    throw new BranchPilotUserError(
      'github_pr_details_failed',
      'GitHub API could not load pull request details.',
      githubApiErrorMessage(body, response.status)
    )
  }

  return normalizeGitHubPullRequestDetails(body)
}

async function getGitHubApiPullRequestDiff(
  credential: GitHubDesktopCredential,
  repository: GitHubRepositoryInfo,
  prNumber: number
): Promise<GitHubPullRequestDiff> {
  const url = new URL(`https://api.github.com/repos/${repository.owner}/${repository.repo}/pulls/${prNumber}/files`)
  url.searchParams.set('per_page', '100')
  const response = await fetch(url, {
    headers: githubApiHeaders(credential)
  })
  const body = await readGitHubApiJson(response)

  if (!response.ok) {
    throw new BranchPilotUserError(
      'github_pr_diff_failed',
      'GitHub API could not load pull request diff.',
      githubApiErrorMessage(body, response.status)
    )
  }

  if (!Array.isArray(body)) {
    throw new BranchPilotUserError('github_pr_parse_failed', 'GitHub API did not return pull request files.')
  }

  return buildGitHubPullRequestDiffFromApiFiles(prNumber, body)
}

function githubApiHeaders(credential: GitHubDesktopCredential): HeadersInit {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${credential.token}`,
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'BranchPilot'
  }
}

async function readGitHubApiJson(response: Response): Promise<unknown> {
  const text = await response.text()

  if (!text.trim()) {
    return {}
  }

  try {
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    return { message: text.slice(0, 500) }
  }
}

async function readGitHubApiBody(response: Response): Promise<Record<string, unknown>> {
  const body = await readGitHubApiJson(response)

  if (body && typeof body === 'object' && !Array.isArray(body)) {
    return body as Record<string, unknown>
  }

  return {}
}

function githubApiErrorMessage(body: unknown, status: number): string {
  const record = body && typeof body === 'object' && !Array.isArray(body)
    ? body as Record<string, unknown>
    : {}
  const message = typeof record.message === 'string' ? record.message : `HTTP ${status}`
  const errors = Array.isArray(record.errors)
    ? record.errors
        .map((error) => typeof error === 'string'
          ? error
          : error && typeof error === 'object' && 'message' in error && typeof error.message === 'string'
            ? error.message
            : '')
        .filter(Boolean)
    : []

  return [message, ...errors].join('\n')
}

function normalizeApiBranchRef(value: unknown, fallback: string): string {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const ref = (value as Record<string, unknown>).ref

    if (typeof ref === 'string' && ref.trim()) {
      return ref
    }
  }

  return fallback
}

function parsePullRequestUrl(output: string): string {
  const url = output.match(/https:\/\/github\.com\/[^\s]+\/[^\s]+\/pull\/\d+/)?.[0]

  if (!url) {
    throw new BranchPilotUserError('github_pr_parse_failed', 'GitHub CLI did not return a pull request URL.', output)
  }

  return url
}

const PR_JSON_FIELDS = 'number,title,url,state,headRefName,baseRefName,isDraft'
const PR_DETAILS_JSON_FIELDS = 'number,title,body,url,state,headRefName,baseRefName,isDraft,author,createdAt,updatedAt,additions,deletions,changedFiles'
const PR_CHECK_JSON_FIELDS = 'name,state,bucket,workflow,description,link,startedAt,completedAt'
const REPOSITORY_JSON_FIELDS = 'name,nameWithOwner,owner,description,visibility,isPrivate,isFork,isArchived,url,sshUrl,defaultBranchRef,updatedAt,pushedAt'

function normalizePullRequestNumber(prNumber: number): number {
  if (!Number.isInteger(prNumber) || prNumber <= 0) {
    throw new BranchPilotUserError('invalid_pr_number', 'Pull request number is invalid.')
  }

  return prNumber
}

function parseGitHubPullRequestList(output: string): GitHubPullRequest[] {
  if (!output.trim()) {
    return []
  }

  const parsed = parseGitHubJson(output)

  if (!Array.isArray(parsed)) {
    throw new BranchPilotUserError('github_pr_parse_failed', 'GitHub CLI did not return a pull request list.', output)
  }

  return parsed.map((value) => normalizeGitHubPullRequest(value))
}

function parseGitHubPullRequest(output: string): GitHubPullRequest {
  return normalizeGitHubPullRequest(parseGitHubJson(output))
}

function parseGitHubRepositoryList(output: string): GitHubRepositorySummary[] {
  if (!output.trim()) {
    return []
  }

  const parsed = parseGitHubJson(output, 'github_repo_parse_failed', 'GitHub CLI did not return a repository list.')

  if (!Array.isArray(parsed)) {
    throw new BranchPilotUserError('github_repo_parse_failed', 'GitHub CLI did not return a repository list.', output)
  }

  return parsed.map((value) => normalizeGitHubRepository(value))
}

function parseGitHubAccountList(
  output: string,
  fallbackType: GitHubAccountSummary['type']
): GitHubAccountSummary[] {
  if (!output.trim()) {
    return []
  }

  const parsed = parseGitHubJson(output, 'github_account_parse_failed', 'GitHub CLI did not return a valid account list.')

  if (!Array.isArray(parsed)) {
    throw new BranchPilotUserError('github_account_parse_failed', 'GitHub CLI did not return an account list.', output)
  }

  return parsed.map((value) => normalizeGitHubAccount(value, fallbackType))
}

function parseGitHubPullRequestChecks(output: string): GitHubPullRequestCheck[] {
  if (!output.trim()) {
    return []
  }

  const parsed = parseGitHubJson(output)

  if (!Array.isArray(parsed)) {
    throw new BranchPilotUserError('github_pr_parse_failed', 'GitHub CLI did not return a pull request checks list.', output)
  }

  return parsed.map((value) => normalizeGitHubPullRequestCheck(value))
}

function parseGitHubPullRequestDiff(prNumber: number, output: string): GitHubPullRequestDiff {
  const rawFiles = splitUnifiedDiffByFile(output)
  const parsedFiles = parseUnifiedDiff(output)
  const files: GitHubPullRequestDiffFile[] = parsedFiles.map((file, index) => {
    const text = rawFiles[index] ?? file.hunks.map((hunk) => hunk.patch).join('\n')
    const path = file.newPath === '/dev/null' ? file.oldPath ?? file.newPath : file.newPath

    return {
      ...file,
      path,
      text,
      status: inferDiffFileStatus(file.oldPath, file.newPath),
      additions: countPatchLines(text, '+'),
      deletions: countPatchLines(text, '-')
    }
  })

  return {
    prNumber,
    text: output,
    files
  }
}

function buildGitHubPullRequestDiffFromApiFiles(
  prNumber: number,
  values: unknown[]
): GitHubPullRequestDiff {
  const apiFiles = values.map((value) => normalizeGitHubPullRequestApiFile(value))
  const text = apiFiles.map((file) => file.text).join('')
  const parsedFiles = parseUnifiedDiff(text)

  return {
    prNumber,
    text,
    files: apiFiles.map((apiFile, index) => {
      const parsedFile = parsedFiles[index]

      return {
        oldPath: parsedFile?.oldPath ?? apiFile.oldPath,
        newPath: parsedFile?.newPath ?? apiFile.newPath,
        hunks: parsedFile?.hunks ?? [],
        path: apiFile.path,
        text: apiFile.text,
        status: apiFile.status,
        additions: apiFile.additions,
        deletions: apiFile.deletions
      }
    })
  }
}

function parseGitHubJson(
  output: string,
  code = 'github_pr_parse_failed',
  message = 'GitHub CLI returned invalid pull request JSON.'
): unknown {
  try {
    return JSON.parse(output) as unknown
  } catch {
    throw new BranchPilotUserError(code, message, output)
  }
}

function normalizeGitHubAccount(
  value: unknown,
  fallbackType: GitHubAccountSummary['type']
): GitHubAccountSummary {
  if (!value || typeof value !== 'object') {
    throw new BranchPilotUserError('github_account_parse_failed', 'GitHub returned an invalid account.')
  }

  const record = value as Record<string, unknown>
  const login = typeof record.login === 'string' ? record.login.trim() : ''

  if (!login || !isSafeGitHubPathSegment(login)) {
    throw new BranchPilotUserError('github_account_parse_failed', 'GitHub returned an incomplete account.')
  }

  const rawType = typeof record.type === 'string' ? record.type.toLowerCase() : ''
  const type: GitHubAccountSummary['type'] = rawType === 'organization' || rawType === 'org'
    ? 'organization'
    : fallbackType

  return {
    login,
    label: optionalString(record.name) ?? optionalString(record.description) ?? login,
    type,
    url: optionalString(record.html_url) ?? optionalString(record.url) ?? `https://github.com/${login}`
  }
}

function normalizeGitHubRepository(value: unknown): GitHubRepositorySummary {
  if (!value || typeof value !== 'object') {
    throw new BranchPilotUserError('github_repo_parse_failed', 'GitHub CLI returned an invalid repository.')
  }

  const record = value as Record<string, unknown>
  const explicitNameWithOwner = typeof record.nameWithOwner === 'string'
    ? record.nameWithOwner
    : typeof record.full_name === 'string'
      ? record.full_name
      : ''
  const nameWithOwnerParts = explicitNameWithOwner.split('/').filter(Boolean)
  const name = typeof record.name === 'string' && record.name.trim()
    ? record.name.trim()
    : nameWithOwnerParts[1] ?? ''
  const owner = normalizeRepositoryOwner(record.owner) || nameWithOwnerParts[0] || ''
  const normalizedPath = normalizeGitHubRepositoryPath(owner, name)
  const url = typeof record.url === 'string'
    ? record.url.trim()
    : typeof record.html_url === 'string'
      ? record.html_url.trim()
      : ''

  if (!normalizedPath || !url) {
    throw new BranchPilotUserError('github_repo_parse_failed', 'GitHub CLI returned an incomplete repository.')
  }

  return {
    name: normalizedPath.repo,
    nameWithOwner: `${normalizedPath.owner}/${normalizedPath.repo}`,
    owner: normalizedPath.owner,
    description: optionalString(record.description) ?? '',
    visibility: optionalString(record.visibility) ?? (record.isPrivate || record.private ? 'PRIVATE' : 'PUBLIC'),
    isPrivate: Boolean(record.isPrivate ?? record.private),
    isFork: Boolean(record.isFork ?? record.fork),
    isArchived: Boolean(record.isArchived ?? record.archived),
    url,
    sshUrl: optionalString(record.sshUrl) ?? optionalString(record.ssh_url) ?? '',
    defaultBranch: normalizeRepositoryDefaultBranch(record.defaultBranchRef ?? record.default_branch),
    updatedAt: optionalString(record.updatedAt) ?? optionalString(record.updated_at) ?? '',
    pushedAt: optionalString(record.pushedAt) ?? optionalString(record.pushed_at) ?? ''
  }
}

function normalizeGitHubPullRequestDetails(value: unknown): GitHubPullRequestDetails {
  const pullRequest = normalizeGitHubPullRequest(value)
  const record = value as Record<string, unknown>

  return {
    ...pullRequest,
    body: typeof record.body === 'string' ? record.body : '',
    author: normalizeGitHubAuthor(record.author ?? record.user),
    createdAt: optionalString(record.createdAt) ?? optionalString(record.created_at) ?? '',
    updatedAt: optionalString(record.updatedAt) ?? optionalString(record.updated_at) ?? '',
    additions: normalizeNonNegativeNumber(record.additions),
    deletions: normalizeNonNegativeNumber(record.deletions),
    changedFiles: normalizeNonNegativeNumber(record.changedFiles ?? record.changed_files)
  }
}

function normalizeGitHubPullRequest(value: unknown): GitHubPullRequest {
  if (!value || typeof value !== 'object') {
    throw new BranchPilotUserError('github_pr_parse_failed', 'GitHub CLI returned an invalid pull request.')
  }

  const record = value as Record<string, unknown>
  const number = Number(record.number)
  const title = typeof record.title === 'string' ? record.title : ''
  const url = optionalString(record.html_url) ?? optionalString(record.url) ?? ''
  const state = typeof record.state === 'string' ? record.state : ''
  const headBranch = optionalString(record.headRefName) ?? normalizeApiBranchRef(record.head, '')
  const baseBranch = optionalString(record.baseRefName) ?? normalizeApiBranchRef(record.base, '')

  if (!Number.isInteger(number) || number <= 0 || !title || !url || !state || !headBranch || !baseBranch) {
    throw new BranchPilotUserError('github_pr_parse_failed', 'GitHub CLI returned an incomplete pull request.')
  }

  return {
    number,
    title,
    url,
    state,
    headBranch,
    baseBranch,
    draft: Boolean(record.isDraft ?? record.draft)
  }
}

function normalizeGitHubPullRequestCheck(value: unknown): GitHubPullRequestCheck {
  if (!value || typeof value !== 'object') {
    throw new BranchPilotUserError('github_pr_parse_failed', 'GitHub CLI returned an invalid pull request check.')
  }

  const record = value as Record<string, unknown>
  const name = typeof record.name === 'string' ? record.name : ''
  const state = typeof record.state === 'string' ? record.state : ''
  const bucket = typeof record.bucket === 'string' ? record.bucket : state

  if (!name || !state) {
    throw new BranchPilotUserError('github_pr_parse_failed', 'GitHub CLI returned an incomplete pull request check.')
  }

  return {
    name,
    state,
    bucket,
    workflow: optionalString(record.workflow),
    description: optionalString(record.description),
    link: optionalString(record.link),
    startedAt: optionalString(record.startedAt),
    completedAt: optionalString(record.completedAt)
  }
}

function normalizeGitHubPullRequestApiFile(value: unknown): {
  oldPath?: string
  newPath: string
  path: string
  text: string
  status: GitHubPullRequestDiffFile['status']
  additions: number
  deletions: number
} {
  if (!value || typeof value !== 'object') {
    throw new BranchPilotUserError('github_pr_parse_failed', 'GitHub API returned an invalid pull request file.')
  }

  const record = value as Record<string, unknown>
  const filename = optionalString(record.filename) ?? ''
  const apiStatus = optionalString(record.status) ?? 'modified'

  if (!filename) {
    throw new BranchPilotUserError('github_pr_parse_failed', 'GitHub API returned an incomplete pull request file.')
  }

  const status = normalizeGitHubFileStatus(apiStatus)
  const previousPath = optionalString(record.previous_filename)
  const oldPath = status === 'added' ? undefined : previousPath ?? filename
  const newPath = status === 'deleted' ? '/dev/null' : filename
  const text = buildGitHubApiFilePatch({
    filename,
    oldPath,
    newPath,
    previousPath,
    status,
    patch: optionalString(record.patch)
  })

  return {
    oldPath,
    newPath,
    path: filename,
    text,
    status,
    additions: normalizeNonNegativeNumber(record.additions),
    deletions: normalizeNonNegativeNumber(record.deletions)
  }
}

function normalizeGitHubAuthor(value: unknown): GitHubPullRequestDetails['author'] {
  if (!value || typeof value !== 'object') {
    return undefined
  }

  const record = value as Record<string, unknown>
  const login = typeof record.login === 'string' ? record.login : ''

  if (!login) {
    return undefined
  }

  return {
    login,
    name: optionalString(record.name),
    url: optionalString(record.url)
  }
}

function normalizeGitHubFileStatus(status: string): GitHubPullRequestDiffFile['status'] {
  if (status === 'added') return 'added'
  if (status === 'removed') return 'deleted'
  if (status === 'renamed') return 'renamed'
  if (status === 'copied') return 'copied'
  if (status === 'modified' || status === 'changed') return 'modified'
  return 'unknown'
}

function buildGitHubApiFilePatch(file: {
  filename: string
  oldPath?: string
  newPath: string
  previousPath?: string
  status: GitHubPullRequestDiffFile['status']
  patch?: string
}): string {
  const diffOldPath = file.oldPath ?? file.filename
  const diffNewPath = file.newPath === '/dev/null' ? file.filename : file.newPath
  const oldHeaderPath = file.oldPath ? `a/${file.oldPath}` : '/dev/null'
  const newHeaderPath = file.newPath === '/dev/null' ? '/dev/null' : `b/${file.newPath}`
  const header = [
    `diff --git a/${diffOldPath} b/${diffNewPath}`,
    file.status === 'added' ? 'new file mode 100644' : undefined,
    file.status === 'deleted' ? 'deleted file mode 100644' : undefined,
    file.status === 'renamed' && file.previousPath ? `rename from ${file.previousPath}` : undefined,
    file.status === 'renamed' ? `rename to ${file.filename}` : undefined,
    `--- ${oldHeaderPath}`,
    `+++ ${newHeaderPath}`
  ].filter((line): line is string => Boolean(line))

  return `${header.join('\n')}${file.patch ? `\n${file.patch}` : ''}\n`
}

function normalizeRepositoryOwner(value: unknown): string {
  if (!value || typeof value !== 'object') {
    return ''
  }

  const record = value as Record<string, unknown>
  return typeof record.login === 'string' ? record.login.trim() : ''
}

function normalizeRepositoryDefaultBranch(value: unknown): string {
  if (typeof value === 'string') {
    return value.trim()
  }

  if (!value || typeof value !== 'object') {
    return ''
  }

  const record = value as Record<string, unknown>
  return typeof record.name === 'string' ? record.name.trim() : ''
}

function normalizeRepositoryListLimit(limit: number | undefined): number {
  if (typeof limit !== 'number' || !Number.isFinite(limit)) {
    return 30
  }

  return Math.min(100, Math.max(1, Math.trunc(limit)))
}

function normalizeOptionalGitHubOwner(owner: string | undefined): string | undefined {
  const trimmed = owner?.trim()

  if (!trimmed) {
    return undefined
  }

  if (trimmed.startsWith('-') || !isSafeGitHubPathSegment(trimmed)) {
    throw new BranchPilotUserError('invalid_github_owner', 'GitHub owner is invalid.')
  }

  return trimmed
}

function filterGitHubRepositories(
  repositories: GitHubRepositorySummary[],
  request: ListGitHubRepositoriesRequest
): GitHubRepositorySummary[] {
  const owner = normalizeOptionalGitHubOwner(request.owner)?.toLowerCase()
  const query = request.query?.trim().toLowerCase()
  const visibility = request.visibility && request.visibility !== 'all'
    ? request.visibility.toLowerCase()
    : undefined

  return repositories.filter((repository) => {
    if (owner && repository.owner.toLowerCase() !== owner) {
      return false
    }

    if (visibility && repository.visibility.toLowerCase() !== visibility) {
      return false
    }

    return query ? matchesGitHubRepositoryQuery(repository, query) : true
  })
}

function uniqueGitHubAccounts(accounts: GitHubAccountSummary[]): GitHubAccountSummary[] {
  const seen = new Set<string>()
  const unique: GitHubAccountSummary[] = []

  for (const account of accounts) {
    const key = account.login.toLowerCase()

    if (!seen.has(key)) {
      unique.push(account)
      seen.add(key)
    }
  }

  return unique
}

function matchesGitHubRepositoryQuery(repository: GitHubRepositorySummary, query: string): boolean {
  return [
    repository.nameWithOwner,
    repository.name,
    repository.owner,
    repository.description,
    repository.visibility,
    repository.defaultBranch
  ].some((value) => value.toLowerCase().includes(query))
}

function normalizeNonNegativeNumber(value: unknown): number {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : 0
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function splitUnifiedDiffByFile(text: string): string[] {
  const normalized = text.replace(/\r\n/g, '\n')
  const lines = normalized.endsWith('\n') ? normalized.slice(0, -1).split('\n') : normalized.split('\n')
  const files: string[] = []
  let current: string[] = []

  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      if (current.length > 0) {
        files.push(`${current.join('\n')}\n`)
      }

      current = [line]
    } else if (current.length > 0) {
      current.push(line)
    }
  }

  if (current.length > 0) {
    files.push(`${current.join('\n')}\n`)
  }

  return files
}

function inferDiffFileStatus(oldPath: string | undefined, newPath: string): GitHubPullRequestDiffFile['status'] {
  if (!oldPath) return 'added'
  if (newPath === '/dev/null') return 'deleted'
  if (oldPath !== newPath) return 'renamed'
  return 'modified'
}

function countPatchLines(text: string, prefix: '+' | '-'): number {
  return text
    .split('\n')
    .filter((line) => line.startsWith(prefix) && !line.startsWith(`${prefix}${prefix}${prefix}`))
    .length
}
