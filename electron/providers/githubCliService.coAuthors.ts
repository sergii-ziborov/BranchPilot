import type { CoAuthor, GitHubCliStatus, GitHubCoAuthorSearchRequest } from '../../src/shared/branchPilot.js'
import { CommandRunner } from '../lib/commandRunner.js'
import { githubApiHeaders, readGitHubApiJson } from './githubCliService.api.js'
import type { GitHubDesktopCredential, GitHubCredentialProvider } from './githubCliService.auth.js'
import { optionalString } from './githubCliService.parsers.js'
import { isSafeGitHubPathSegment } from './githubCliService.shared.js'
import { getGitHubRepositoryInfo, resolveRepositoryRoot } from './githubCliService.context.js'

type GitHubCliStatusResolver = (runner: CommandRunner, repoPath?: string) => Promise<GitHubCliStatus>

export async function listGitHubContributorsWithAuth(
  runner: CommandRunner,
  repoPath: string,
  resolveStatus: GitHubCliStatusResolver,
  credentialProvider?: GitHubCredentialProvider
): Promise<CoAuthor[]> {
  const rootPath = await resolveRepositoryRoot(runner, repoPath)
  const status = await resolveStatus(runner, rootPath)

  let remote
  try {
    remote = await getGitHubRepositoryInfo(runner, rootPath)
  } catch {
    return []
  }

  if (status.authProvider === 'git-credential') {
    const credential = await credentialProvider?.getCredential()
    if (!credential) return []

    const collaborators = await fetchGitHubApiJsonArrayPages(
      `https://api.github.com/repos/${remote.owner}/${remote.repo}/collaborators?affiliation=all&per_page=100`,
      credential
    ).catch(() => [])

    return normalizeGitHubUserCoAuthors(collaborators, 'collaborator')
  }

  if (status.authProvider !== 'gh' || !status.executable) {
    return []
  }

  const result = await runner.run(status.executable, ['api', `repos/${remote.owner}/${remote.repo}/collaborators?affiliation=all&per_page=100`, '--paginate'], {
    cwd: rootPath,
    allowedExitCodes: [0, 1],
    timeoutMs: 30_000
  })

  if (result.exitCode !== 0) return []

  const parsed = parseGitHubApiJsonOutput(result.stdout)
  if (!Array.isArray(parsed)) return []

  return normalizeGitHubUserCoAuthors(parsed, 'collaborator')
}

export async function searchGitHubCoAuthorsWithAuth(
  runner: CommandRunner,
  request: GitHubCoAuthorSearchRequest,
  credentialProvider: GitHubCredentialProvider,
  resolveStatus: GitHubCliStatusResolver
): Promise<CoAuthor[]> {
  const query = normalizeCoAuthorSearchQuery(request.query)
  if (query.length === 1) return []

  const limit = normalizeCoAuthorSearchLimit(request.limit)
  const status = await resolveStatus(runner, request.repoPath)
  const scopedOwner = await resolveCoAuthorSearchOwner(runner, request.repoPath)

  if (status.authProvider === 'git-credential') {
    const credential = await credentialProvider.getCredential()

    if (!credential) return []

    return filterCoAuthorPool(await loadGitCredentialCoAuthorPool(credential, scopedOwner), query, limit)
  }

  if (status.authProvider !== 'gh' || !status.executable) {
    return []
  }

  return filterCoAuthorPool(await loadGhCoAuthorPool(runner, status.executable, scopedOwner), query, limit)
}

async function resolveCoAuthorSearchOwner(runner: CommandRunner, repoPath: string | undefined): Promise<string | undefined> {
  if (!repoPath) return undefined

  try {
    const rootPath = await resolveRepositoryRoot(runner, repoPath)
    const remote = await getGitHubRepositoryInfo(runner, rootPath)
    return remote.owner.toLowerCase()
  } catch {
    return undefined
  }
}

async function loadGitCredentialCoAuthorPool(credential: GitHubDesktopCredential, scopedOwner?: string): Promise<CoAuthor[]> {
  const [viewer, orgs] = await Promise.all([
    fetchGitHubApiJson('https://api.github.com/user', credential),
    fetchGitHubApiJson('https://api.github.com/user/orgs?per_page=100', credential).catch(() => [])
  ])
  const contributors: CoAuthor[] = []
  const viewerContributor = normalizeGitHubUserCoAuthor(viewer, 'github')
  const viewerLogin = normalizeGitHubLogin(viewer)?.toLowerCase()

  if (viewerContributor) contributors.push(viewerContributor)

  const orgLogins = (Array.isArray(orgs) ? orgs : [])
    .map((org) => normalizeGitHubLogin(org))
    .filter((orgLogin): orgLogin is string => Boolean(orgLogin))
  const searchableOrgLogins = scopedOwner
    ? orgLogins.filter((orgLogin) => orgLogin.toLowerCase() === scopedOwner && orgLogin.toLowerCase() !== viewerLogin)
    : orgLogins

  for (const orgLogin of searchableOrgLogins) {
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

async function fetchGitHubApiJsonArrayPages(url: string, credential: GitHubDesktopCredential): Promise<unknown[]> {
  const values: unknown[] = []
  let nextUrl: string | undefined = url

  while (nextUrl) {
    const response = await fetch(nextUrl, {
      headers: githubApiHeaders(credential)
    })
    const body = await readGitHubApiJson(response)

    if (!response.ok) return values
    if (Array.isArray(body)) values.push(...body)

    nextUrl = parseNextLink(response.headers.get('link'))
  }

  return values
}

function parseNextLink(linkHeader: string | null): string | undefined {
  if (!linkHeader) return undefined

  for (const part of linkHeader.split(',')) {
    if (!/;\s*rel="next"/.test(part)) continue
    return part.match(/<([^>]+)>/)?.[1]
  }

  return undefined
}

async function loadGhCoAuthorPool(runner: CommandRunner, executable: string, scopedOwner?: string): Promise<CoAuthor[]> {
  const [viewer, orgs] = await Promise.all([
    runGhApiJson(runner, executable, 'user'),
    runGhApiJson(runner, executable, 'user/orgs', true)
  ])
  const contributors: CoAuthor[] = []
  const viewerContributor = normalizeGitHubUserCoAuthor(viewer, 'github')
  const viewerLogin = normalizeGitHubLogin(viewer)?.toLowerCase()

  if (viewerContributor) contributors.push(viewerContributor)

  const orgLogins = (Array.isArray(orgs) ? orgs : [])
    .map((org) => normalizeGitHubLogin(org))
    .filter((orgLogin): orgLogin is string => Boolean(orgLogin))
  const searchableOrgLogins = scopedOwner
    ? orgLogins.filter((orgLogin) => orgLogin.toLowerCase() === scopedOwner && orgLogin.toLowerCase() !== viewerLogin)
    : orgLogins

  for (const orgLogin of searchableOrgLogins) {
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

  return parseGitHubApiJsonOutput(result.stdout)
}

function parseGitHubApiJsonOutput(output: string): unknown {
  const trimmed = output.trim()
  if (!trimmed) return []

  try {
    return JSON.parse(trimmed) as unknown
  } catch {
    try {
      const paged = JSON.parse(`[${trimmed.replace(/\]\s*\[/g, '],[')}]`) as unknown
      if (Array.isArray(paged) && paged.every(Array.isArray)) {
        return paged.flat()
      }
    } catch {
      return []
    }
  }

  return []
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

function normalizeGitHubUserCoAuthors(
  values: unknown[],
  source: CoAuthor['source'],
  organization?: string
): CoAuthor[] {
  const contributors: CoAuthor[] = []

  for (const value of values) {
    const contributor = normalizeGitHubUserCoAuthor(value, source, organization)
    if (contributor) contributors.push(contributor)
  }

  return uniqueCoAuthors(contributors)
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
