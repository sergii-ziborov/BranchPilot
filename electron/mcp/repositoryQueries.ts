import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import type { MemoryQueryOptions } from './memoryQueries.js'
import { GIT_EXECUTABLE } from '../lib/platformExecutables.js'

const execFileAsync = promisify(execFile)

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200
const DEFAULT_MAX_BYTES = 120_000
const MAX_TEXT_FILE_BYTES = 900_000
const DEFAULT_MAX_LINES = 400
const MAX_LINES = 2_000
const SKIPPED_DIRECTORIES = new Set([
  '.git',
  'node_modules',
  'dist',
  'dist-electron',
  'build',
  'coverage',
  'release',
  'out',
  '.next',
  '.turbo',
  '.vite',
  '.cache',
  'vendor'
])

export interface RepositoryStatusChange {
  path: string
  originalPath?: string
  index: string
  worktree: string
  status: string
}

export interface RepositoryFileListOptions extends MemoryQueryOptions {
  query?: string
  extension?: string
  includeUntracked?: boolean
  limit?: number
}

export interface RepositoryFileReadOptions extends MemoryQueryOptions {
  path: string
  revision?: string
  startLine?: number
  maxLines?: number
  maxBytes?: number
}

export interface RepositoryTextSearchOptions extends MemoryQueryOptions {
  query: string
  path?: string
  extension?: string
  caseSensitive?: boolean
  contextLines?: number
  limit?: number
}

export interface RepositoryDiffOptions extends MemoryQueryOptions {
  mode?: 'all' | 'staged' | 'unstaged'
  path?: string
  base?: string
  head?: string
  maxBytes?: number
}

export interface CommitSearchOptions extends MemoryQueryOptions {
  query?: string
  path?: string
  limit?: number
}

export interface CommitDetailsOptions extends MemoryQueryOptions {
  ref: string
  includePatch?: boolean
  maxBytes?: number
}

export interface FileHistoryOptions extends MemoryQueryOptions {
  path: string
  limit?: number
}

export interface FileBlameOptions extends MemoryQueryOptions {
  path: string
  startLine?: number
  lineCount?: number
}

export const REPOSITORY_RESOURCE_URIS = [
  'branchpilot://repo/current/live-status',
  'branchpilot://repo/current/worktree',
  'branchpilot://repo/current/refs',
  'branchpilot://repo/current/diff'
] as const

export async function getRepositoryStatus(options: MemoryQueryOptions) {
  const repoPath = await requireRepositoryPath(options)
  const raw = await git(repoPath, ['status', '--porcelain=v1', '-b', '--untracked-files=all'])
  const lines = raw.stdout.split(/\r?\n/).filter(Boolean)
  const branch = parseBranchLine(lines[0] ?? '')
  const changes = lines.slice(1).map(parseStatusLine)
  const counts = {
    changed: changes.length,
    staged: changes.filter((change) => change.index !== ' ' && change.index !== '?').length,
    unstaged: changes.filter((change) => change.worktree !== ' ' && change.worktree !== '?').length,
    untracked: changes.filter((change) => change.status === 'untracked').length,
    conflicted: changes.filter((change) => change.status === 'conflicted').length
  }

  return {
    repository: {
      rootPath: repoPath
    },
    branch,
    clean: changes.length === 0,
    counts,
    changes
  }
}

export async function listRepositoryRefs(options: MemoryQueryOptions) {
  const repoPath = await requireRepositoryPath(options)
  const [localBranches, remoteBranches, tags, remotes, worktrees] = await Promise.all([
    git(repoPath, ['branch', '--format=%(refname:short)%00%(objectname:short)%00%(upstream:short)%00%(committerdate:iso8601)%00%(subject)']),
    git(repoPath, ['branch', '-r', '--format=%(refname:short)%00%(objectname:short)%00%(committerdate:iso8601)%00%(subject)']),
    git(repoPath, ['tag', '--sort=-creatordate', '--format=%(refname:short)%00%(objectname:short)%00%(creatordate:iso8601)%00%(subject)']),
    git(repoPath, ['remote', '-v']),
    git(repoPath, ['worktree', 'list', '--porcelain'])
  ])

  return {
    repository: {
      rootPath: repoPath
    },
    localBranches: parseLocalBranches(localBranches.stdout),
    remoteBranches: parseRemoteBranches(remoteBranches.stdout),
    tags: parseTags(tags.stdout),
    remotes: parseRemotes(remotes.stdout),
    worktrees: parseWorktrees(worktrees.stdout)
  }
}

export async function listRepositoryFiles(options: RepositoryFileListOptions) {
  const repoPath = await requireRepositoryPath(options)
  const files = await getRepositoryFilePaths(repoPath, options.includeUntracked ?? true)
  const query = normalizeQuery(options.query)
  const extension = normalizeExtension(options.extension)
  const filtered = files
    .filter((filePath) => !query || normalizeQuery(filePath).includes(query))
    .filter((filePath) => !extension || path.posix.extname(filePath).toLowerCase() === extension)
    .slice(0, normalizeLimit(options.limit))

  const entries = await Promise.all(filtered.map(async (filePath) => {
    const absolutePath = resolveRepositoryFilePath(repoPath, filePath)
    const stat = await fs.stat(absolutePath).catch(() => null)

    return {
      path: filePath,
      extension: path.posix.extname(filePath),
      sizeBytes: stat?.size ?? 0,
      modifiedAt: stat?.mtime.toISOString() ?? null
    }
  }))

  return {
    repository: {
      rootPath: repoPath
    },
    totalMatched: files
      .filter((filePath) => !query || normalizeQuery(filePath).includes(query))
      .filter((filePath) => !extension || path.posix.extname(filePath).toLowerCase() === extension)
      .length,
    files: entries
  }
}

export async function readRepositoryFile(options: RepositoryFileReadOptions) {
  const repoPath = await requireRepositoryPath(options)
  const relativePath = normalizeRepositoryRelativePath(options.path)
  const maxBytes = normalizeMaxBytes(options.maxBytes)
  const text = options.revision
    ? await readGitFile(repoPath, options.revision, relativePath, maxBytes)
    : await readWorkingTreeFile(repoPath, relativePath, maxBytes)

  return sliceTextLines({
    repository: { rootPath: repoPath },
    path: relativePath,
    revision: options.revision ?? 'working-tree',
    text,
    startLine: options.startLine,
    maxLines: options.maxLines
  })
}

export async function searchRepositoryText(options: RepositoryTextSearchOptions) {
  const repoPath = await requireRepositoryPath(options)
  const query = options.query.trim()

  if (!query) {
    throw new Error('Search query is required.')
  }

  const basePath = options.path ? normalizeRepositoryRelativePath(options.path) : ''
  const extension = normalizeExtension(options.extension)
  const limit = normalizeLimit(options.limit)
  const contextLines = Math.min(5, Math.max(0, Math.floor(options.contextLines ?? 1)))
  const matcher = options.caseSensitive
    ? (line: string) => line.includes(query)
    : (line: string) => line.toLowerCase().includes(query.toLowerCase())
  const files = (await getRepositoryFilePaths(repoPath, true))
    .filter((filePath) => !basePath || filePath === basePath || filePath.startsWith(`${basePath}/`))
    .filter((filePath) => !extension || path.posix.extname(filePath).toLowerCase() === extension)
  const matches: Array<{ path: string; line: number; text: string; before: string[]; after: string[] }> = []

  for (const filePath of files) {
    if (matches.length >= limit) break

    const absolutePath = resolveRepositoryFilePath(repoPath, filePath)
    const stat = await fs.stat(absolutePath).catch(() => null)

    if (!stat || stat.size > MAX_TEXT_FILE_BYTES || !(await looksTextFile(absolutePath))) continue

    const text = await fs.readFile(absolutePath, 'utf8').catch(() => '')
    const lines = text.split(/\r?\n/)

    for (let index = 0; index < lines.length; index += 1) {
      if (!matcher(lines[index])) continue

      matches.push({
        path: filePath,
        line: index + 1,
        text: lines[index],
        before: lines.slice(Math.max(0, index - contextLines), index),
        after: lines.slice(index + 1, Math.min(lines.length, index + 1 + contextLines))
      })

      if (matches.length >= limit) break
    }
  }

  return {
    repository: {
      rootPath: repoPath
    },
    query,
    matches
  }
}

export async function getRepositoryDiff(options: RepositoryDiffOptions) {
  const repoPath = await requireRepositoryPath(options)
  const args = diffArgs(options)
  const statArgs = diffArgs({ ...options, maxBytes: undefined }).filter((arg) => arg !== '--patch')
  const [diff, stat] = await Promise.all([
    git(repoPath, args),
    git(repoPath, [...statArgs.slice(0, 1), '--stat', ...statArgs.slice(1)])
  ])

  return {
    repository: {
      rootPath: repoPath
    },
    mode: options.base || options.head ? 'compare' : options.mode ?? 'all',
    path: options.path ? normalizeRepositoryRelativePath(options.path) : undefined,
    base: options.base,
    head: options.head,
    stat: truncateText(stat.stdout.trim(), normalizeMaxBytes(options.maxBytes)),
    diff: truncateText(diff.stdout, normalizeMaxBytes(options.maxBytes))
  }
}

export async function searchCommitHistory(options: CommitSearchOptions) {
  const repoPath = await requireRepositoryPath(options)
  const args = [
    'log',
    `--max-count=${normalizeLimit(options.limit)}`,
    '--date=iso-strict',
    '--format=%H%x00%h%x00%an%x00%ae%x00%aI%x00%s'
  ]

  if (options.query?.trim()) {
    args.push('--regexp-ignore-case', `--grep=${options.query.trim()}`)
  }

  if (options.path) {
    args.push('--', normalizeRepositoryRelativePath(options.path))
  }

  const result = await git(repoPath, args)

  return {
    repository: {
      rootPath: repoPath
    },
    commits: parseCommitLines(result.stdout)
  }
}

export async function getCommitDetails(options: CommitDetailsOptions) {
  const repoPath = await requireRepositoryPath(options)
  const ref = normalizeGitRef(options.ref)
  const [metadata, files, body] = await Promise.all([
    git(repoPath, ['show', '-s', '--format=%H%x00%h%x00%an%x00%ae%x00%aI%x00%cn%x00%cI%x00%s%x00%b', ref]),
    git(repoPath, ['show', '--name-status', '--format=', ref]),
    git(repoPath, ['show', '--no-ext-diff', options.includePatch ? '--patch' : '--stat', '--format=fuller', ref])
  ])

  return {
    repository: {
      rootPath: repoPath
    },
    commit: parseCommitDetails(metadata.stdout),
    files: parseNameStatus(files.stdout),
    text: truncateText(body.stdout, normalizeMaxBytes(options.maxBytes))
  }
}

export async function getFileHistory(options: FileHistoryOptions) {
  const repoPath = await requireRepositoryPath(options)
  const relativePath = normalizeRepositoryRelativePath(options.path)
  const result = await git(repoPath, [
    'log',
    '--follow',
    `--max-count=${normalizeLimit(options.limit)}`,
    '--date=iso-strict',
    '--format=%H%x00%h%x00%an%x00%ae%x00%aI%x00%s',
    '--',
    relativePath
  ])

  return {
    repository: {
      rootPath: repoPath
    },
    path: relativePath,
    commits: parseCommitLines(result.stdout)
  }
}

export async function getRepositoryBlame(options: FileBlameOptions) {
  const repoPath = await requireRepositoryPath(options)
  const relativePath = normalizeRepositoryRelativePath(options.path)
  const startLine = Math.max(1, Math.floor(options.startLine ?? 1))
  const lineCount = Math.min(200, Math.max(1, Math.floor(options.lineCount ?? 80)))
  const result = await git(repoPath, [
    'blame',
    '--line-porcelain',
    '-L',
    `${startLine},+${lineCount}`,
    '--',
    relativePath
  ])

  return {
    repository: {
      rootPath: repoPath
    },
    path: relativePath,
    startLine,
    lineCount,
    lines: parseBlamePorcelain(result.stdout)
  }
}

export async function getRepositoryResourcePayload(options: MemoryQueryOptions, uri: string): Promise<unknown> {
  if (uri === 'branchpilot://repo/current/live-status') {
    return getRepositoryStatus(options)
  }

  if (uri === 'branchpilot://repo/current/worktree') {
    return listRepositoryFiles({ ...options, limit: 200 })
  }

  if (uri === 'branchpilot://repo/current/refs') {
    return listRepositoryRefs(options)
  }

  if (uri === 'branchpilot://repo/current/diff') {
    return getRepositoryDiff({ ...options, mode: 'all', maxBytes: 80_000 })
  }

  throw new Error(`Unknown BranchPilot repository resource: ${uri}`)
}

async function requireRepositoryPath(options: MemoryQueryOptions): Promise<string> {
  const repoPath = options.repoPath?.trim()

  if (!repoPath) {
    throw new Error('Repository path is required. Recopy the BranchPilot MCP config from Reports > MCP.')
  }

  const resolved = path.resolve(repoPath)
  const stat = await fs.stat(resolved).catch(() => null)

  if (!stat?.isDirectory()) {
    throw new Error(`Repository path does not exist: ${repoPath}`)
  }

  return resolved
}

async function git(repoPath: string, args: string[], maxBuffer = 4_000_000) {
  try {
    const result = await execFileAsync(GIT_EXECUTABLE, args, {
      cwd: repoPath,
      encoding: 'utf8',
      maxBuffer,
      windowsHide: true
    })

    return {
      stdout: result.stdout,
      stderr: result.stderr
    }
  } catch (error) {
    const details = error as { stdout?: string; stderr?: string; message?: string }
    const message = [details.stderr, details.stdout, details.message]
      .filter(Boolean)
      .join('\n')
      .trim()

    throw new Error(message || `Git command failed: git ${args.join(' ')}`, {
      cause: error
    })
  }
}

async function getRepositoryFilePaths(repoPath: string, includeUntracked: boolean): Promise<string[]> {
  const args = includeUntracked
    ? ['ls-files', '-co', '--exclude-standard']
    : ['ls-files']

  try {
    const result = await git(repoPath, args)
    return result.stdout
      .split(/\r?\n/)
      .map((entry) => entry.trim())
      .filter(Boolean)
      .filter((entry) => !isSkippedPath(entry))
      .sort((left, right) => left.localeCompare(right))
  } catch {
    return walkRepositoryFiles(repoPath)
  }
}

async function walkRepositoryFiles(repoPath: string): Promise<string[]> {
  const files: string[] = []

  async function walk(directoryPath: string, relativeDirectory: string) {
    const entries = await fs.readdir(directoryPath, { withFileTypes: true }).catch(() => [])

    for (const entry of entries) {
      const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name

      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(entry.name)) {
          await walk(path.join(directoryPath, entry.name), relativePath)
        }
        continue
      }

      if (entry.isFile() && !isSkippedPath(relativePath)) {
        files.push(relativePath)
      }
    }
  }

  await walk(repoPath, '')

  return files.sort((left, right) => left.localeCompare(right))
}

function parseBranchLine(line: string) {
  const value = line.replace(/^##\s*/, '')
  const detached = value.startsWith('HEAD ')
  const match = value.match(/^([^.\s]+|\S+?)(?:\.\.\.([^\s]+))?(?:\s+\[(.+)\])?/)
  const status = match?.[3] ?? ''

  return {
    name: detached ? 'HEAD' : match?.[1] ?? value,
    upstream: match?.[2],
    detached,
    ahead: Number(status.match(/ahead\s+(\d+)/)?.[1] ?? 0),
    behind: Number(status.match(/behind\s+(\d+)/)?.[1] ?? 0)
  }
}

function parseStatusLine(line: string): RepositoryStatusChange {
  const index = line[0] ?? ' '
  const worktree = line[1] ?? ' '
  const body = line.slice(3)
  const [originalPath, nextPath] = body.includes(' -> ') ? body.split(' -> ') : [undefined, body]

  return {
    path: nextPath,
    originalPath,
    index,
    worktree,
    status: statusLabel(index, worktree)
  }
}

function statusLabel(index: string, worktree: string): string {
  if (index === '?' && worktree === '?') return 'untracked'
  if (index === 'U' || worktree === 'U' || (index === 'A' && worktree === 'A') || (index === 'D' && worktree === 'D')) return 'conflicted'
  if (index !== ' ' && worktree !== ' ') return 'staged_and_unstaged'
  if (index !== ' ') return 'staged'
  if (worktree !== ' ') return 'unstaged'
  return 'clean'
}

function parseLocalBranches(raw: string) {
  return raw.split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [name, shortSha, upstream, committedAt, subject] = line.split('\0')
      return { name, shortSha, upstream: upstream || null, committedAt: committedAt || null, subject: subject || '' }
    })
}

function parseRemoteBranches(raw: string) {
  return raw.split(/\r?\n/)
    .filter(Boolean)
    .filter((line) => !line.startsWith('origin/HEAD'))
    .map((line) => {
      const [name, shortSha, committedAt, subject] = line.split('\0')
      return { name, shortSha, committedAt: committedAt || null, subject: subject || '' }
    })
}

function parseTags(raw: string) {
  return raw.split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [name, shortSha, createdAt, subject] = line.split('\0')
      return { name, shortSha, createdAt: createdAt || null, subject: subject || '' }
    })
}

function parseRemotes(raw: string) {
  const remotes = new Map<string, { name: string; fetchUrl?: string; pushUrl?: string }>()

  for (const line of raw.split(/\r?\n/).filter(Boolean)) {
    const match = line.match(/^(\S+)\s+(\S+)\s+\((fetch|push)\)$/)
    if (!match) continue
    const entry = remotes.get(match[1]) ?? { name: match[1] }
    if (match[3] === 'fetch') entry.fetchUrl = match[2]
    if (match[3] === 'push') entry.pushUrl = match[2]
    remotes.set(entry.name, entry)
  }

  return [...remotes.values()]
}

function parseWorktrees(raw: string) {
  const worktrees: Array<Record<string, string | boolean>> = []
  let current: Record<string, string | boolean> | null = null

  for (const line of raw.split(/\r?\n/)) {
    if (line.startsWith('worktree ')) {
      current = { path: line.slice('worktree '.length) }
      worktrees.push(current)
      continue
    }

    if (!current || !line) continue

    if (line === 'bare' || line === 'detached') {
      current[line] = true
      continue
    }

    const [key, ...rest] = line.split(' ')
    current[key] = rest.join(' ')
  }

  return worktrees
}

function diffArgs(options: RepositoryDiffOptions): string[] {
  const args = ['diff', '--no-ext-diff']
  const relativePath = options.path ? normalizeRepositoryRelativePath(options.path) : undefined

  if (options.base || options.head) {
    const base = normalizeGitRef(options.base ?? 'HEAD')
    const head = normalizeGitRef(options.head ?? 'HEAD')
    args.push(`${base}..${head}`)
  } else if (options.mode === 'staged') {
    args.push('--cached')
  } else if (options.mode === 'unstaged') {
    // plain git diff
  } else {
    args.push('HEAD')
  }

  if (relativePath) {
    args.push('--', relativePath)
  }

  return args
}

async function readWorkingTreeFile(repoPath: string, relativePath: string, maxBytes: number): Promise<string> {
  const absolutePath = resolveRepositoryFilePath(repoPath, relativePath)
  const stat = await fs.stat(absolutePath)

  if (!stat.isFile()) {
    throw new Error(`Repository path is not a file: ${relativePath}`)
  }

  if (stat.size > maxBytes) {
    const handle = await fs.open(absolutePath, 'r')
    try {
      const buffer = Buffer.alloc(maxBytes)
      const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0)
      return buffer.subarray(0, bytesRead).toString('utf8')
    } finally {
      await handle.close()
    }
  }

  return fs.readFile(absolutePath, 'utf8')
}

async function readGitFile(repoPath: string, revision: string, relativePath: string, maxBytes: number): Promise<string> {
  const ref = normalizeGitRef(revision)
  const result = await git(repoPath, ['show', `${ref}:${relativePath}`], maxBytes * 2)
  return truncateText(result.stdout, maxBytes)
}

function sliceTextLines(input: {
  repository: { rootPath: string }
  path: string
  revision: string
  text: string
  startLine?: number
  maxLines?: number
}) {
  const lines = input.text.split(/\r?\n/)
  const startLine = Math.max(1, Math.floor(input.startLine ?? 1))
  const maxLines = Math.min(MAX_LINES, Math.max(1, Math.floor(input.maxLines ?? DEFAULT_MAX_LINES)))
  const selected = lines.slice(startLine - 1, startLine - 1 + maxLines)

  return {
    repository: input.repository,
    path: input.path,
    revision: input.revision,
    startLine,
    endLine: startLine + selected.length - 1,
    totalLines: lines.length,
    truncated: startLine + selected.length - 1 < lines.length,
    text: selected.join('\n')
  }
}

function parseCommitLines(raw: string) {
  return raw.split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [sha, shortSha, authorName, authorEmail, authoredAt, subject] = line.split('\0')
      return { sha, shortSha, authorName, authorEmail, authoredAt, subject }
    })
}

function parseCommitDetails(raw: string) {
  const [sha, shortSha, authorName, authorEmail, authoredAt, committerName, committedAt, subject, body] = raw.split('\0')

  return {
    sha,
    shortSha,
    authorName,
    authorEmail,
    authoredAt,
    committerName,
    committedAt,
    subject,
    body: body?.trim() ?? ''
  }
}

function parseNameStatus(raw: string) {
  return raw.split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [status, filePath, nextPath] = line.split(/\t/)
      return {
        status,
        path: nextPath ?? filePath,
        originalPath: nextPath ? filePath : undefined
      }
    })
}

function parseBlamePorcelain(raw: string) {
  const lines: Array<{ sha: string; line: number; author?: string; authoredAt?: string; summary?: string; text: string }> = []
  let current: { sha: string; line: number; author?: string; authoredAt?: string; summary?: string } | null = null

  for (const line of raw.split(/\r?\n/)) {
    const header = line.match(/^([0-9a-f]{40})\s+\d+\s+(\d+)/)
    if (header) {
      current = { sha: header[1], line: Number(header[2]) }
      continue
    }

    if (!current) continue

    if (line.startsWith('author ')) current.author = line.slice('author '.length)
    if (line.startsWith('author-time ')) current.authoredAt = new Date(Number(line.slice('author-time '.length)) * 1000).toISOString()
    if (line.startsWith('summary ')) current.summary = line.slice('summary '.length)
    if (line.startsWith('\t')) {
      lines.push({ ...current, text: line.slice(1) })
      current = null
    }
  }

  return lines
}

async function looksTextFile(filePath: string): Promise<boolean> {
  const handle = await fs.open(filePath, 'r').catch(() => null)

  if (!handle) return false

  try {
    const buffer = Buffer.alloc(512)
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
    return !buffer.subarray(0, bytesRead).includes(0)
  } finally {
    await handle.close()
  }
}

function resolveRepositoryFilePath(repoPath: string, relativePath: string): string {
  const root = path.resolve(repoPath)
  const absolutePath = path.resolve(root, normalizeRepositoryRelativePath(relativePath))
  const relative = path.relative(root, absolutePath)

  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Path escapes repository root: ${relativePath}`)
  }

  return absolutePath
}

function normalizeRepositoryRelativePath(value: string): string {
  const normalized = value.replace(/\\/g, '/').replace(/^\/+/, '').trim()

  if (!normalized || normalized.split('/').some((part) => part === '..')) {
    throw new Error(`Invalid repository-relative path: ${value}`)
  }

  return normalized
}

function normalizeGitRef(value: string): string {
  const normalized = value.trim()

  if (!normalized || normalized.startsWith('-')) {
    throw new Error(`Invalid Git ref: ${value}`)
  }

  return normalized
}

function normalizeExtension(value: string | undefined): string {
  const normalized = value?.trim().toLowerCase()

  if (!normalized) return ''

  return normalized.startsWith('.') ? normalized : `.${normalized}`
}

function normalizeQuery(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase()
}

function normalizeLimit(limit: number | undefined): number {
  if (!limit || !Number.isFinite(limit)) {
    return DEFAULT_LIMIT
  }

  return Math.min(MAX_LIMIT, Math.max(1, Math.floor(limit)))
}

function normalizeMaxBytes(maxBytes: number | undefined): number {
  if (!maxBytes || !Number.isFinite(maxBytes)) {
    return DEFAULT_MAX_BYTES
  }

  return Math.min(1_000_000, Math.max(4_000, Math.floor(maxBytes)))
}

function truncateText(text: string, maxBytes: number): string {
  const buffer = Buffer.from(text)

  if (buffer.length <= maxBytes) {
    return text
  }

  return `${buffer.subarray(0, maxBytes).toString('utf8')}\n\n[truncated at ${maxBytes} bytes]`
}

function isSkippedPath(filePath: string): boolean {
  return filePath
    .split(/[\\/]+/)
    .some((part) => SKIPPED_DIRECTORIES.has(part))
}
