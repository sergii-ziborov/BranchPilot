import type {
  CreateGitHubRepositoryRequest,
  GitHubAccountSummary,
  GitHubCliStatus,
  GitHubPullRequest,
  GitHubPullRequestDetails,
  GitHubPullRequestDiff,
  GitHubRepositorySummary,
  ListGitHubRepositoriesRequest
} from '../../src/shared/branchPilot.js'
import { CommandRunner } from '../lib/commandRunner.js'
import { BranchPilotUserError } from '../lib/errors.js'
import { GIT_EXECUTABLE } from '../lib/platformExecutables.js'
import {
  createGitHubApiPullRequest,
  createGitHubApiRepository,
  getGitHubApiPullRequestDetails,
  getGitHubApiPullRequestDiff,
  getGitHubApiViewer,
  listGitHubApiAccounts,
  listGitHubApiPullRequests,
  listGitHubApiRepositories,
  parseGitHubUsername,
  readGitHubDesktopCredential,
  tryGetGitHubApiViewer
} from './githubCliService.api.js'
import { getGitHubRemoteUrl, resolveGhExecutable } from './githubCliService.context.js'
import type { GitHubRepositoryInfo } from './githubCliService.shared.js'

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

export const DEFAULT_CREDENTIAL_PROVIDER: GitHubCredentialProvider = {
  getCredential: readGitHubDesktopCredential
}

export const DEFAULT_API_CLIENT: GitHubApiClient = {
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

export async function assertGitHubCliReady(runner: CommandRunner, rootPath: string): Promise<GitHubCliStatus & { executable: string }> {
  const status = await assertGitHubCliAuthenticated(runner, rootPath)

  await getGitHubRemoteUrl(runner, rootPath)

  return status
}

export async function assertGitHubCliAuthenticated(runner: CommandRunner, repoPath?: string): Promise<GitHubCliStatus & { executable: string }> {
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

export async function resolveGitHubAuth(
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
