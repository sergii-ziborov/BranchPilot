import { createReadStream, promises as fs } from 'node:fs'
import { createInterface } from 'node:readline'
import path from 'node:path'
import type {
  RepositoryFileListOptions,
  RepositoryFileReadOptions
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
  const startLine = Math.max(1, Math.floor(options.startLine ?? 1))
  const maxLines = Math.min(MAX_LINES, Math.max(1, Math.floor(options.maxLines ?? DEFAULT_MAX_LINES)))

  // The working-tree reader streams line by line so a deep startLine stays reachable in large
  // files (the old byte window started at offset 0, so lines past the cap were unreachable).
  const window = options.revision
    ? sliceRevisionLines(await readGitFile(repoPath, options.revision, relativePath, maxBytes), startLine, maxLines)
    : await readWorkingTreeLineWindow(repoPath, relativePath, startLine, maxLines, maxBytes)

  return {
    repository: { rootPath: repoPath },
    path: relativePath,
    revision: options.revision ?? 'working-tree',
    startLine: window.startLine,
    endLine: window.startLine + window.lines.length - 1,
    lineCount: window.lines.length,
    hasMore: window.hasMore,
    text: truncateText(window.lines.join('\n'), maxBytes)
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

interface LineWindow {
  startLine: number
  lines: string[]
  hasMore: boolean
}

// Stream the working-tree file and keep only the [startLine, startLine+maxLines) window, stopping as
// soon as one line past the window is seen (hasMore) or the byte budget for the window is exhausted.
// Bounded memory, and any depth is reachable without reading the whole file into memory.
async function readWorkingTreeLineWindow(
  repoPath: string,
  relativePath: string,
  startLine: number,
  maxLines: number,
  byteBudget: number
): Promise<LineWindow> {
  const absolutePath = resolveRepositoryFilePath(repoPath, relativePath)
  const stat = await fs.stat(absolutePath)

  if (!stat.isFile()) {
    throw new Error(`Repository path is not a file: ${relativePath}`)
  }

  const stream = createReadStream(absolutePath, { encoding: 'utf8' })
  const reader = createInterface({ input: stream, crlfDelay: Infinity })
  const endLine = startLine + maxLines - 1
  const lines: string[] = []
  let lineNumber = 0
  let collectedBytes = 0
  let hasMore = false

  try {
    for await (const line of reader) {
      lineNumber += 1

      if (lineNumber < startLine) {
        continue
      }

      if (lineNumber > endLine) {
        hasMore = true
        break
      }

      const lineBytes = Buffer.byteLength(line) + 1

      if (lines.length > 0 && collectedBytes + lineBytes > byteBudget) {
        hasMore = true
        break
      }

      lines.push(line)
      collectedBytes += lineBytes
    }
  } finally {
    reader.close()
    stream.destroy()
  }

  return { startLine, lines, hasMore }
}

async function readGitFile(repoPath: string, revision: string, relativePath: string, maxBytes: number): Promise<string> {
  const ref = normalizeGitRef(revision)
  const result = await git(repoPath, ['show', `${ref}:${relativePath}`], maxBytes * 2)
  return truncateText(result.stdout, maxBytes)
}

function sliceRevisionLines(text: string, startLine: number, maxLines: number): LineWindow {
  const lines = text.split(/\r?\n/)
  const selected = lines.slice(startLine - 1, startLine - 1 + maxLines)

  return {
    startLine,
    lines: selected,
    hasMore: startLine - 1 + selected.length < lines.length
  }
}

function isSkippedPath(filePath: string): boolean {
  return filePath
    .split(/[\\/]+/)
    .some((part) => SKIPPED_DIRECTORIES.has(part))
}
