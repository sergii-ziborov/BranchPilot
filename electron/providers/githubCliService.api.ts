import type {
  GitHubAccountSummary, GitHubPullRequest, GitHubPullRequestDetails, GitHubPullRequestDiff, GitHubRepositorySummary, ListGitHubRepositoriesRequest
} from '../../src/shared/branchPilot.js'
import { spawn } from 'node:child_process'
import { BranchPilotUserError } from '../lib/errors.js'
import type {
  GitHubDesktopCredential, GitHubApiClient, GitHubApiPullRequest
} from './githubCliService.js'
import {
  buildGitHubPullRequestDiffFromApiFiles, filterGitHubRepositories, normalizeGitHubAccount, normalizeGitHubPullRequest, normalizeGitHubPullRequestDetails, normalizeGitHubRepository, normalizeRepositoryListLimit, uniqueGitHubAccounts
} from './githubCliService.parsers.js'

/** GitHub HTTP API client + credential helpers. */

export function parseGitHubUsername(output: string): string | undefined {
  return output.match(/Logged in to [^\s]+ account ([^\s]+)/)?.[1]
}

export async function readGitHubDesktopCredential(): Promise<GitHubDesktopCredential | undefined> {
  const output = await runPrivateCredentialFill()
  const credential = parseGitCredentialOutput(output)

  return credential?.token ? credential : undefined
}

export async function runPrivateCredentialFill(): Promise<string> {
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

export function parseGitCredentialOutput(output: string): GitHubDesktopCredential | undefined {
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

export async function tryGetGitHubApiViewer(
  apiClient: GitHubApiClient,
  credential: GitHubDesktopCredential
): Promise<{ login: string } | undefined> {
  try {
    return await apiClient.getViewer(credential)
  } catch {
    return undefined
  }
}

export async function getGitHubApiViewer(credential: GitHubDesktopCredential): Promise<{ login: string }> {
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

export async function listGitHubApiAccounts(credential: GitHubDesktopCredential): Promise<GitHubAccountSummary[]> {
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

export async function createGitHubApiPullRequest(
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

export async function listGitHubApiRepositories(
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

export async function listGitHubApiPullRequests(
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

export async function getGitHubApiPullRequestDetails(
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

export async function getGitHubApiPullRequestDiff(
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

export function githubApiHeaders(credential: GitHubDesktopCredential): HeadersInit {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${credential.token}`,
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'BranchPilot'
  }
}

export async function readGitHubApiJson(response: Response): Promise<unknown> {
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

export async function readGitHubApiBody(response: Response): Promise<Record<string, unknown>> {
  const body = await readGitHubApiJson(response)

  if (body && typeof body === 'object' && !Array.isArray(body)) {
    return body as Record<string, unknown>
  }

  return {}
}

export function githubApiErrorMessage(body: unknown, status: number): string {
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

export function normalizeApiBranchRef(value: unknown, fallback: string): string {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const ref = (value as Record<string, unknown>).ref

    if (typeof ref === 'string' && ref.trim()) {
      return ref
    }
  }

  return fallback
}

export function parsePullRequestUrl(output: string): string {
  const url = output.match(/https:\/\/github\.com\/[^\s]+\/[^\s]+\/pull\/\d+/)?.[0]

  if (!url) {
    throw new BranchPilotUserError('github_pr_parse_failed', 'GitHub CLI did not return a pull request URL.', output)
  }

  return url
}
