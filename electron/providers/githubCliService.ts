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
import { parsePullRequestUrl } from './githubCliService.api.js'
import {
  DEFAULT_API_CLIENT,
  DEFAULT_CREDENTIAL_PROVIDER,
  assertGitHubCliReady,
  connectGitHubAuthentication,
  getGitHubCliStatus,
  resolveGitHubAuth
} from './githubCliService.auth.js'
import {
  PR_CHECK_JSON_FIELDS, PR_DETAILS_JSON_FIELDS, PR_JSON_FIELDS, REPOSITORY_JSON_FIELDS, filterGitHubRepositories, normalizeGitHubAccount, normalizeGitHubPullRequestDetails, normalizeOptionalGitHubOwner, normalizePullRequestNumber, normalizeRepositoryListLimit, parseGitHubAccountList, parseGitHubEmailList, parseGitHubJson, parseGitHubPullRequest, parseGitHubPullRequestChecks, parseGitHubPullRequestDiff, parseGitHubPullRequestList, parseGitHubRepositoryList, uniqueGitHubAccounts
} from './githubCliService.parsers.js'
import {
  assertHasUpstream, checkoutGitHubPullRequestWithGit, getCurrentBranch, getGitHubRemoteUrl, getGitHubRepositoryInfo, normalizeBranchName, resolveDefaultBaseBranch, resolveRepositoryRoot
} from './githubCliService.context.js'
import {
  listGitHubContributorsWithAuth,
  searchGitHubCoAuthorsWithAuth
} from './githubCliService.coAuthors.js'
import {
  createGitHubRepositoryWithAuth,
  publishLocalGitHubRepositoryWithAuth
} from './githubCliService.repositories.js'

export { connectGitHubAuthentication, getGitHubCliStatus }
export type { GitHubApiClient, GitHubApiPullRequest, GitHubCredentialProvider, GitHubDesktopCredential } from './githubCliService.auth.js'

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

export async function listGitHubContributors(
  runner: CommandRunner,
  repoPath: string,
  credentialProvider = DEFAULT_CREDENTIAL_PROVIDER
): Promise<CoAuthor[]> {
  return listGitHubContributorsWithAuth(
    runner,
    repoPath,
    (commandRunner, statusRepoPath) => getGitHubCliStatus(commandRunner, statusRepoPath, credentialProvider),
    credentialProvider
  )
}

export async function searchGitHubCoAuthors(
  runner: CommandRunner,
  request: GitHubCoAuthorSearchRequest,
  credentialProvider = DEFAULT_CREDENTIAL_PROVIDER
): Promise<CoAuthor[]> {
  return searchGitHubCoAuthorsWithAuth(
    runner,
    request,
    credentialProvider,
    (commandRunner, statusRepoPath) => getGitHubCliStatus(commandRunner, statusRepoPath, credentialProvider)
  )
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
  return createGitHubRepositoryWithAuth(runner, request, credentialProvider, apiClient)
}

export async function publishLocalGitHubRepository(
  runner: CommandRunner,
  request: CreateGitHubRepositoryRequest,
  credentialProvider = DEFAULT_CREDENTIAL_PROVIDER,
  apiClient = DEFAULT_API_CLIENT
): Promise<Omit<CreatedGitHubRepository, 'snapshot'> & { rootPath: string }> {
  return publishLocalGitHubRepositoryWithAuth(runner, request, credentialProvider, apiClient)
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

