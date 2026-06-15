import type {
  GitHubAccountSummary, GitHubPullRequest, GitHubPullRequestCheck, GitHubPullRequestDetails, GitHubPullRequestDiff, GitHubPullRequestDiffFile, GitHubRepositorySummary, ListGitHubRepositoriesRequest
} from '../../src/shared/branchPilot.js'
import { parseUnifiedDiff } from '../lib/diffParser.js'
import { BranchPilotUserError } from '../lib/errors.js'
import { isSafeGitHubPathSegment, normalizeApiBranchRef, normalizeGitHubRepositoryPath } from './githubCliService.shared.js'

/** Parsers and normalizers for GitHub CLI/API output. */

export const PR_JSON_FIELDS = 'number,title,url,state,headRefName,baseRefName,isDraft'
export const PR_DETAILS_JSON_FIELDS = 'number,title,body,url,state,headRefName,baseRefName,isDraft,author,createdAt,updatedAt,additions,deletions,changedFiles'
export const PR_CHECK_JSON_FIELDS = 'name,state,bucket,workflow,description,link,startedAt,completedAt'
export const REPOSITORY_JSON_FIELDS = 'name,nameWithOwner,owner,description,visibility,isPrivate,isFork,isArchived,url,sshUrl,defaultBranchRef,updatedAt,pushedAt'

export function normalizePullRequestNumber(prNumber: number): number {
  if (!Number.isInteger(prNumber) || prNumber <= 0) {
    throw new BranchPilotUserError('invalid_pr_number', 'Pull request number is invalid.')
  }

  return prNumber
}

export function parseGitHubPullRequestList(output: string): GitHubPullRequest[] {
  if (!output.trim()) {
    return []
  }

  const parsed = parseGitHubJson(output)

  if (!Array.isArray(parsed)) {
    throw new BranchPilotUserError('github_pr_parse_failed', 'GitHub CLI did not return a pull request list.', output)
  }

  return parsed.map((value) => normalizeGitHubPullRequest(value))
}

export function parseGitHubPullRequest(output: string): GitHubPullRequest {
  return normalizeGitHubPullRequest(parseGitHubJson(output))
}

export function parseGitHubRepositoryList(output: string): GitHubRepositorySummary[] {
  if (!output.trim()) {
    return []
  }

  const parsed = parseGitHubJson(output, 'github_repo_parse_failed', 'GitHub CLI did not return a repository list.')

  if (!Array.isArray(parsed)) {
    throw new BranchPilotUserError('github_repo_parse_failed', 'GitHub CLI did not return a repository list.', output)
  }

  return parsed.map((value) => normalizeGitHubRepository(value))
}

export function parseGitHubAccountList(
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

export function parseGitHubPullRequestChecks(output: string): GitHubPullRequestCheck[] {
  if (!output.trim()) {
    return []
  }

  const parsed = parseGitHubJson(output)

  if (!Array.isArray(parsed)) {
    throw new BranchPilotUserError('github_pr_parse_failed', 'GitHub CLI did not return a pull request checks list.', output)
  }

  return parsed.map((value) => normalizeGitHubPullRequestCheck(value))
}

export function parseGitHubPullRequestDiff(prNumber: number, output: string): GitHubPullRequestDiff {
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

export function buildGitHubPullRequestDiffFromApiFiles(
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

export function parseGitHubJson(
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

export function normalizeGitHubAccount(
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

export function normalizeGitHubRepository(value: unknown): GitHubRepositorySummary {
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

export function normalizeGitHubPullRequestDetails(value: unknown): GitHubPullRequestDetails {
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

export function normalizeGitHubPullRequest(value: unknown): GitHubPullRequest {
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

export function normalizeGitHubPullRequestCheck(value: unknown): GitHubPullRequestCheck {
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

export function normalizeGitHubPullRequestApiFile(value: unknown): {
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

export function normalizeGitHubAuthor(value: unknown): GitHubPullRequestDetails['author'] {
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

export function normalizeGitHubFileStatus(status: string): GitHubPullRequestDiffFile['status'] {
  if (status === 'added') return 'added'
  if (status === 'removed') return 'deleted'
  if (status === 'renamed') return 'renamed'
  if (status === 'copied') return 'copied'
  if (status === 'modified' || status === 'changed') return 'modified'
  return 'unknown'
}

export function buildGitHubApiFilePatch(file: {
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

export function normalizeRepositoryOwner(value: unknown): string {
  if (!value || typeof value !== 'object') {
    return ''
  }

  const record = value as Record<string, unknown>
  return typeof record.login === 'string' ? record.login.trim() : ''
}

export function normalizeRepositoryDefaultBranch(value: unknown): string {
  if (typeof value === 'string') {
    return value.trim()
  }

  if (!value || typeof value !== 'object') {
    return ''
  }

  const record = value as Record<string, unknown>
  return typeof record.name === 'string' ? record.name.trim() : ''
}

export function normalizeRepositoryListLimit(limit: number | undefined): number {
  if (typeof limit !== 'number' || !Number.isFinite(limit)) {
    return 30
  }

  return Math.min(100, Math.max(1, Math.trunc(limit)))
}

export function normalizeOptionalGitHubOwner(owner: string | undefined): string | undefined {
  const trimmed = owner?.trim()

  if (!trimmed) {
    return undefined
  }

  if (trimmed.startsWith('-') || !isSafeGitHubPathSegment(trimmed)) {
    throw new BranchPilotUserError('invalid_github_owner', 'GitHub owner is invalid.')
  }

  return trimmed
}

export function filterGitHubRepositories(
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

export function uniqueGitHubAccounts(accounts: GitHubAccountSummary[]): GitHubAccountSummary[] {
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

export function matchesGitHubRepositoryQuery(repository: GitHubRepositorySummary, query: string): boolean {
  return [
    repository.nameWithOwner,
    repository.name,
    repository.owner,
    repository.description,
    repository.visibility,
    repository.defaultBranch
  ].some((value) => value.toLowerCase().includes(query))
}

export function normalizeNonNegativeNumber(value: unknown): number {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : 0
}

export function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

export function splitUnifiedDiffByFile(text: string): string[] {
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

export function inferDiffFileStatus(oldPath: string | undefined, newPath: string): GitHubPullRequestDiffFile['status'] {
  if (!oldPath) return 'added'
  if (newPath === '/dev/null') return 'deleted'
  if (oldPath !== newPath) return 'renamed'
  return 'modified'
}

export function countPatchLines(text: string, prefix: '+' | '-'): number {
  return text
    .split('\n')
    .filter((line) => line.startsWith(prefix) && !line.startsWith(`${prefix}${prefix}${prefix}`))
    .length
}
