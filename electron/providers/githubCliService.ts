import { promises as fs } from 'node:fs'
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
  GitHubRepositorySummary,
  ListGitHubRepositoriesRequest,
  PullRequestDetailsRequest
} from '../../src/shared/branchPilot.js'
import { CommandRunner } from '../lib/commandRunner.js'
import { BranchPilotUserError } from '../lib/errors.js'
import {
  createGitHubApiPullRequest, getGitHubApiPullRequestDetails, getGitHubApiPullRequestDiff, getGitHubApiViewer, listGitHubApiAccounts, listGitHubApiPullRequests, listGitHubApiRepositories, parseGitHubUsername, parsePullRequestUrl, readGitHubDesktopCredential, tryGetGitHubApiViewer
} from './githubCliService.api.js'
import {
  PR_CHECK_JSON_FIELDS, PR_DETAILS_JSON_FIELDS, PR_JSON_FIELDS, REPOSITORY_JSON_FIELDS, filterGitHubRepositories, normalizeGitHubAccount, normalizeGitHubPullRequestDetails, normalizeOptionalGitHubOwner, normalizePullRequestNumber, normalizeRepositoryListLimit, parseGitHubAccountList, parseGitHubJson, parseGitHubPullRequest, parseGitHubPullRequestChecks, parseGitHubPullRequestDiff, parseGitHubPullRequestList, parseGitHubRepositoryList, uniqueGitHubAccounts
} from './githubCliService.parsers.js'

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

export interface GitHubRepositoryInfo {
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

export function normalizeGitHubRepositoryPath(owner: string, repo: string): Pick<GitHubRepositoryInfo, 'owner' | 'repo'> | undefined {
  const normalizedRepo = repo.replace(/\.git$/i, '')

  if (!isSafeGitHubPathSegment(owner) || !isSafeGitHubPathSegment(normalizedRepo)) {
    return undefined
  }

  return {
    owner,
    repo: normalizedRepo
  }
}

export function isSafeGitHubPathSegment(value: string): boolean {
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


