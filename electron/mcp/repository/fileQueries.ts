import { promises as fs } from 'node:fs'
import path from 'node:path'
import type {
  RepositoryFileListOptions,
  RepositoryFileReadOptions,
  RepositoryTextSearchOptions
} from './types.js'
import { git, requireRepositoryPath } from './gitCommand.js'
import {
  normalizeExtension,
  normalizeGitRef,
  normalizeLimit,
  normalizeMaxBytes,
  normalizeQuery,
  normalizeRepositoryRelativePath,
  resolveRepositoryFilePath,
  truncateText
} from './normalization.js'

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

function isSkippedPath(filePath: string): boolean {
  return filePath
    .split(/[\\/]+/)
    .some((part) => SKIPPED_DIRECTORIES.has(part))
}
