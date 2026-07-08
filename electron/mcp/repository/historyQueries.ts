import type {
  CommitDetailsOptions,
  CommitSearchOptions,
  FileBlameOptions,
  FileHistoryOptions
} from './types.js'
import { git, requireRepositoryPath } from './gitCommand.js'
import {
  normalizeGitRef,
  normalizeLimit,
  normalizeMaxBytes,
  normalizeRepositoryRelativePath,
  truncateText
} from './normalization.js'

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
