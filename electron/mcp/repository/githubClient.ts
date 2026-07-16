import { git } from './gitCommand.js'
import { githubApiHeaders, readGitHubApiJson, readGitHubDesktopCredential } from '../../providers/githubCliService.api.js'
import type { GitHubDesktopCredential } from '../../providers/githubCliService.auth.js'

// GitHub access WITHOUT the gh CLI: the credential comes from GH_TOKEN/GITHUB_TOKEN or from the same
// Git Credential Manager entry `git push` already uses (read strictly non-interactively). The token
// lives in process memory only, is never logged or persisted, and is sent only to api.github.com.
const API_ROOT = 'https://api.github.com'
const TOKEN_TTL_MS = 5 * 60_000

let cachedCredential: { credential: GitHubDesktopCredential; expiresAt: number } | null = null

export interface GitHubRepoRef {
  owner: string
  repo: string
}

export async function resolveGitHubCredential(): Promise<GitHubDesktopCredential> {
  const envToken = process.env.GH_TOKEN?.trim() || process.env.GITHUB_TOKEN?.trim()

  if (envToken) {
    return { token: envToken }
  }

  const now = Date.now()

  if (cachedCredential && cachedCredential.expiresAt > now) {
    return cachedCredential.credential
  }

  const credential = await readGitHubDesktopCredential()

  if (!credential?.token) {
    throw new Error('No GitHub credential found. Set GH_TOKEN/GITHUB_TOKEN, or sign in once via Git Credential Manager (any HTTPS git push/pull to github.com stores it).')
  }

  cachedCredential = { credential, expiresAt: now + TOKEN_TTL_MS }
  return credential
}

export async function resolveGitHubRepo(repoPath: string): Promise<GitHubRepoRef> {
  const result = await git(repoPath, ['remote', 'get-url', 'origin'])
  const url = result.stdout.trim()
  const match = url.match(/github\.com[/:]([^/\s]+)\/([^/\s]+?)(?:\.git)?$/i)

  if (!match) {
    throw new Error(`The origin remote is not a github.com repository: ${url || '(no origin remote)'}`)
  }

  return { owner: match[1], repo: match[2] }
}

export async function githubJson(
  credential: GitHubDesktopCredential,
  path: string,
  searchParams?: Record<string, string>
): Promise<unknown> {
  const url = new URL(`${API_ROOT}${path}`)

  for (const [key, value] of Object.entries(searchParams ?? {})) {
    url.searchParams.set(key, value)
  }

  const response = await fetch(url, { headers: githubApiHeaders(credential) })
  const body = await readGitHubApiJson(response)

  if (!response.ok) {
    throw new Error(githubErrorMessage(path, response.status, body))
  }

  return body
}

// Text endpoints: PR diffs (Accept: application/vnd.github.diff) and Actions job logs. The logs
// endpoint answers with a redirect to signed blob storage; fetch follows it and drops the
// Authorization header on the cross-origin hop automatically.
export async function githubText(
  credential: GitHubDesktopCredential,
  path: string,
  accept = 'application/vnd.github+json'
): Promise<string> {
  const response = await fetch(`${API_ROOT}${path}`, {
    headers: { ...githubApiHeaders(credential), Accept: accept }
  })
  const text = await response.text()

  if (!response.ok) {
    throw new Error(githubErrorMessage(path, response.status, { message: text.slice(0, 300) }))
  }

  return text
}

export async function githubGraphql(
  credential: GitHubDesktopCredential,
  query: string,
  variables: Record<string, unknown>
): Promise<unknown> {
  const response = await fetch(`${API_ROOT}/graphql`, {
    method: 'POST',
    headers: { ...githubApiHeaders(credential), 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables })
  })
  const body = await readGitHubApiJson(response) as { data?: unknown; errors?: Array<{ message?: string }> }

  if (!response.ok || body.errors?.length) {
    throw new Error(githubErrorMessage('/graphql', response.status, { message: body.errors?.[0]?.message }))
  }

  return body.data
}

function githubErrorMessage(path: string, status: number, body: unknown): string {
  const message = body && typeof body === 'object' && 'message' in body ? String((body as { message?: unknown }).message ?? '') : ''
  const hint = status === 401 || status === 403
    ? ' (credential may lack repo scope — refresh it with a git push, or set GH_TOKEN)'
    : status === 404
      ? ' (repository or resource not found — private repos need a credential with repo access)'
      : ''

  return `GitHub API ${status} on ${path}: ${message || 'request failed'}${hint}`
}
