import { promises as fs } from 'node:fs'
import type {
  RepositoryFileChunkRequest,
  RepositoryFileChunkResult,
  RepositoryFileContentRequest,
  RepositoryFileContentResult,
  RepositoryFileEntry,
  RepositorySearchMatch,
  RepositorySearchRequest,
  RepositorySearchResult
} from '../../src/shared/branchPilot.js'
import {
  normalizeRelativePath,
  resolveRepositoryPath
} from './repositoryService.helpers.js'
import { RepositoryServiceSnapshotQueries } from './repositoryService.queries.snapshot.js'
import { BranchPilotUserError } from './errors.js'

const MAX_REPOSITORY_FILE_CONTENT_BYTES = 900_000
const DEFAULT_REPOSITORY_FILE_CHUNK_BYTES = 96_000
const MAX_REPOSITORY_FILE_CHUNK_BYTES = 192_000
const DEFAULT_REPOSITORY_SEARCH_RESULTS = 250
const MAX_REPOSITORY_SEARCH_RESULTS = 500
const MAX_REPOSITORY_SEARCH_OUTPUT_BYTES = 6_000_000
const MAX_REPOSITORY_SEARCH_QUERY_LENGTH = 256

function normalizeRepositorySearchQuery(query: string): string {
  const normalized = query.trim()
  if (normalized.length < 2) {
    throw new BranchPilotUserError('search_query_too_short', 'Search text must contain at least two characters.')
  }
  if (normalized.length > MAX_REPOSITORY_SEARCH_QUERY_LENGTH || normalized.includes('\0')) {
    throw new BranchPilotUserError('search_query_invalid', 'Search text is too long or contains invalid characters.')
  }
  return normalized
}

function normalizeRepositorySearchLimit(value: number | undefined): number {
  if (!Number.isFinite(value)) return DEFAULT_REPOSITORY_SEARCH_RESULTS
  return Math.min(MAX_REPOSITORY_SEARCH_RESULTS, Math.max(1, Math.trunc(value ?? DEFAULT_REPOSITORY_SEARCH_RESULTS)))
}

function searchPreview(line: string, column: number, length: number): string {
  const start = Math.max(0, column - 42)
  const end = Math.min(line.length, column + length + 90)
  const prefix = start > 0 ? '...' : ''
  const suffix = end < line.length ? '...' : ''
  return `${prefix}${line.slice(start, end).trim()}${suffix}`
}

function parseRipgrepSearchLine(line: string, query: string): RepositorySearchMatch | null {
  const match = line.match(/^(.+?):(\d+):(\d+):(\d+):(.*)$/)
  if (!match) return null

  const lineNumber = Number(match[2])
  const column = Number(match[3]) - 1
  const byteOffset = Number(match[4])
  if (!Number.isInteger(lineNumber) || !Number.isInteger(column) || !Number.isInteger(byteOffset)) return null

  return {
    filePath: normalizeRelativePath(match[1]),
    lineNumber,
    column: Math.max(0, column),
    length: query.length,
    byteOffset: Math.max(0, byteOffset),
    preview: searchPreview(match[5], Math.max(0, column), query.length)
  }
}

function parseGitGrepSearchLine(line: string, query: string): RepositorySearchMatch | null {
  const match = line.match(/^(.+?):(\d+):(.*)$/)
  if (!match) return null

  const lineNumber = Number(match[2])
  if (!Number.isInteger(lineNumber)) return null

  const content = match[3]
  const column = Math.max(0, content.toLowerCase().indexOf(query.toLowerCase()))
  return {
    filePath: normalizeRelativePath(match[1]),
    lineNumber,
    column,
    length: query.length,
    byteOffset: 0,
    preview: searchPreview(content, column, query.length)
  }
}

function uniqueSearchMatches(matches: RepositorySearchMatch[], limit: number): RepositorySearchMatch[] {
  const seen = new Set<string>()
  const unique: RepositorySearchMatch[] = []
  for (const match of matches) {
    const key = match.filePath
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(match)
    if (unique.length >= limit) break
  }
  return unique
}

export abstract class RepositoryServiceFileQueries extends RepositoryServiceSnapshotQueries {
  async listRepositoryFiles(repoPath: string): Promise<RepositoryFileEntry[]> {
    const rootPath = await this.resolveRepositoryRoot(repoPath)
    const result = await this.git(rootPath, ['ls-files', '-co', '--exclude-standard', '-z'])

    return result.stdout
      .split('\0')
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b))
      .map((filePath) => ({ path: normalizeRelativePath(filePath) }))
  }

  async searchRepositoryContent(request: RepositorySearchRequest): Promise<RepositorySearchResult> {
    const rootPath = await this.resolveRepositoryRoot(request.repoPath)
    const query = normalizeRepositorySearchQuery(request.query)
    const limit = normalizeRepositorySearchLimit(request.maxResults)
    const startedAt = Date.now()

    try {
      const result = await this.runner.run('rg', [
        '--line-number',
        '--column',
        '--byte-offset',
        '--fixed-strings',
        '--ignore-case',
        '--hidden',
        '--max-count', '1',
        '--max-filesize', '2M',
        '--color', 'never',
        '--no-heading',
        '--glob', '!.git/**',
        '--glob', '!node_modules/**',
        '--glob', '!dist/**',
        '--',
        query
      ], {
        cwd: rootPath,
        allowedExitCodes: [0, 1],
        timeoutMs: 20_000,
        maxOutputBytes: MAX_REPOSITORY_SEARCH_OUTPUT_BYTES
      })
      const parsed = result.stdout
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => parseRipgrepSearchLine(line, query))
        .filter((match): match is RepositorySearchMatch => Boolean(match))
      const matches = uniqueSearchMatches(parsed, limit)

      return {
        query,
        matches,
        truncated: result.stdoutTruncated || parsed.length > matches.length,
        engine: 'rg',
        durationMs: Date.now() - startedAt
      }
    } catch {
      const result = await this.git(rootPath, [
        'grep',
        '-n',
        '-I',
        '-i',
        '-F',
        '-m', '1',
        '--full-name',
        '-e', query,
        '--'
      ], {
        allowedExitCodes: [0, 1],
        timeoutMs: 20_000,
        maxOutputBytes: MAX_REPOSITORY_SEARCH_OUTPUT_BYTES
      })
      const parsed = result.stdout
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => parseGitGrepSearchLine(line, query))
        .filter((match): match is RepositorySearchMatch => Boolean(match))
      const matches = uniqueSearchMatches(parsed, limit)

      return {
        query,
        matches,
        truncated: result.stdoutTruncated || parsed.length > matches.length,
        engine: 'git-grep',
        durationMs: Date.now() - startedAt
      }
    }
  }

  async getRepositoryFileContent(request: RepositoryFileContentRequest): Promise<RepositoryFileContentResult> {
    const rootPath = await this.resolveRepositoryRoot(request.repoPath)
    const filePath = normalizeRelativePath(request.filePath)
    const absolutePath = resolveRepositoryPath(rootPath, filePath)
    const stats = await fs.stat(absolutePath).catch(() => undefined)

    if (!stats?.isFile()) {
      throw new BranchPilotUserError('file_not_found', 'File is not available in the working tree.')
    }
    if (stats.size > MAX_REPOSITORY_FILE_CONTENT_BYTES) {
      return { filePath, text: '', binary: false, tooLarge: true }
    }

    const text = await fs.readFile(absolutePath, 'utf8')
    const binary = text.includes('\0')

    return {
      filePath,
      text: binary ? '' : text,
      binary,
      tooLarge: false
    }
  }

  async getRepositoryFileChunk(request: RepositoryFileChunkRequest): Promise<RepositoryFileChunkResult> {
    const rootPath = await this.resolveRepositoryRoot(request.repoPath)
    const filePath = normalizeRelativePath(request.filePath)
    const absolutePath = resolveRepositoryPath(rootPath, filePath)
    const stats = await fs.stat(absolutePath).catch(() => undefined)

    if (!stats?.isFile()) {
      throw new BranchPilotUserError('file_not_found', 'File is not available in the working tree.')
    }

    const requestedOffset = Number.isFinite(request.offset) ? Math.max(0, Math.floor(request.offset)) : 0
    const startOffset = Math.min(requestedOffset, stats.size)
    const requestedMaxBytes = request.maxBytes && Number.isFinite(request.maxBytes)
      ? Math.floor(request.maxBytes)
      : DEFAULT_REPOSITORY_FILE_CHUNK_BYTES
    const maxBytes = Math.min(
      MAX_REPOSITORY_FILE_CHUNK_BYTES,
      Math.max(1, requestedMaxBytes)
    )
    const bytesToRead = Math.min(maxBytes, Math.max(0, stats.size - startOffset))

    if (bytesToRead === 0) {
      return {
        filePath,
        text: '',
        base64: request.mode === 'bytes' ? '' : undefined,
        binary: request.mode === 'bytes',
        byteSize: stats.size,
        startOffset,
        endOffset: startOffset,
        hasMore: false
      }
    }

    const file = await fs.open(absolutePath, 'r')
    try {
      const buffer = Buffer.alloc(bytesToRead)
      const { bytesRead } = await file.read(buffer, 0, bytesToRead, startOffset)
      let chunk = buffer.subarray(0, bytesRead)
      let endOffset = startOffset + bytesRead

      if (request.mode === 'bytes') {
        return {
          filePath,
          text: '',
          base64: chunk.toString('base64'),
          binary: true,
          byteSize: stats.size,
          startOffset,
          endOffset,
          hasMore: endOffset < stats.size
        }
      }

      if (chunk.includes(0)) {
        return {
          filePath,
          text: '',
          binary: true,
          byteSize: stats.size,
          startOffset,
          endOffset,
          hasMore: endOffset < stats.size
        }
      }

      if (endOffset < stats.size) {
        const lastLineBreak = chunk.lastIndexOf(0x0a)
        if (lastLineBreak > 0) {
          chunk = chunk.subarray(0, lastLineBreak + 1)
          endOffset = startOffset + lastLineBreak + 1
        }
      }

      return {
        filePath,
        text: chunk.toString('utf8'),
        binary: false,
        byteSize: stats.size,
        startOffset,
        endOffset,
        hasMore: endOffset < stats.size
      }
    } finally {
      await file.close()
    }
  }
}
