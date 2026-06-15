import path from 'node:path'
import { BranchPilotUserError } from './errors.js'
import type {
  CommitFileChange,
  CommitSummary,
  GitLfsFile,
  GitLfsFileStatus,
  GitLfsPattern,
  StashEntry,
  SubmoduleStatus,
  TagSummary,
  WorktreeSummary
} from '../../src/shared/branchPilot.js'

/** Parsers: git/gh output -> structured RepositoryService models. */

export function normalizeRelativePath(filePath: string): string {
  if (!filePath || path.isAbsolute(filePath) || filePath.includes('..')) {
    throw new BranchPilotUserError('invalid_path', 'Only repository-relative paths are allowed.')
  }

  return filePath
}

export function isConflictOutput(output: string): boolean {
  const normalized = output.toLowerCase()

  return normalized.includes('automatic merge failed')
    || normalized.includes('fix conflicts')
    || normalized.includes('merge conflict')
    || normalized.includes('conflict (')
}

export function parseCommitSummary(line: string): CommitSummary {
  const [sha, shortSha, subject, authorName, authorEmail, authoredAt] = line.split('\0')

  return {
    sha,
    shortSha,
    subject,
    authorName,
    authorEmail,
    authoredAt
  }
}

export function parseStashEntry(line: string): StashEntry {
  const [ref, sha, createdAtLabel, message] = line.split('\0')

  return {
    ref,
    sha,
    createdAtLabel,
    message
  }
}

export function parseNameStatusRecords(output: string): CommitFileChange[] {
  const records = output.split('\0').filter(Boolean)
  const files: CommitFileChange[] = []

  for (let index = 0; index < records.length; index += 1) {
    const rawStatus = records[index]

    if (rawStatus.startsWith('R') || rawStatus.startsWith('C')) {
      files.push({
        rawStatus,
        status: rawStatus.startsWith('R') ? 'renamed' : 'copied',
        originalPath: records[index + 1],
        path: records[index + 2]
      })
      index += 2
      continue
    }

    files.push({
      rawStatus,
      status: mapRawStatus(rawStatus),
      path: records[index + 1]
    })
    index += 1
  }

  return files
}

export function parseBranchCompareCommitCounts(output: string): [number, number] {
  const [baseOnly, targetOnly] = output.trim().split(/\s+/).map((value) => Number.parseInt(value, 10))

  return [
    Number.isFinite(baseOnly) ? baseOnly : 0,
    Number.isFinite(targetOnly) ? targetOnly : 0
  ]
}

export function parseTagSummary(line: string): TagSummary {
  const [name, objectSha, objectShortSha, dereferencedSha, dereferencedShortSha, createdAt, subject] = line.split('\0')

  return {
    name,
    targetSha: dereferencedSha || objectSha,
    targetShortSha: dereferencedShortSha || objectShortSha,
    createdAt: createdAt || undefined,
    subject: subject || undefined
  }
}

export interface ParsedSubmoduleConfig {
  name: string
  path?: string
  url?: string
  branch?: string
}

export interface ParsedSubmoduleStatus {
  path: string
  head?: string
  status: SubmoduleStatus
  description?: string
}

export function parseGitmodulesConfig(output: string): Array<Required<Pick<ParsedSubmoduleConfig, 'name' | 'path'>> & Partial<ParsedSubmoduleConfig>> {
  const entries = new Map<string, ParsedSubmoduleConfig>()

  for (const record of output.split('\0').filter(Boolean)) {
    const separatorIndex = record.indexOf('\n')

    if (separatorIndex === -1) {
      continue
    }

    const key = record.slice(0, separatorIndex)
    const value = record.slice(separatorIndex + 1)
    const match = key.match(/^submodule\.(.+)\.(path|url|branch)$/)

    if (!match) {
      continue
    }

    const [, name, property] = match
    const entry = entries.get(name) ?? { name }

    if (property === 'path') {
      entry.path = value
    } else if (property === 'url') {
      entry.url = value
    } else if (property === 'branch') {
      entry.branch = value
    }

    entries.set(name, entry)
  }

  return [...entries.values()]
    .filter((entry): entry is Required<Pick<ParsedSubmoduleConfig, 'name' | 'path'>> & Partial<ParsedSubmoduleConfig> =>
      Boolean(entry.path)
    )
    .map((entry) => ({
      ...entry,
      path: normalizeRelativePath(entry.path)
    }))
}

export function parseSubmoduleStatus(output: string): ParsedSubmoduleStatus[] {
  return output
    .split('\n')
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map(parseSubmoduleStatusLine)
    .filter((entry): entry is ParsedSubmoduleStatus => Boolean(entry))
}

export function parseSubmoduleStatusLine(line: string): ParsedSubmoduleStatus | null {
  const prefix = line[0]
  const rest = line.slice(1)
  const firstSpaceIndex = rest.indexOf(' ')

  if (firstSpaceIndex === -1) {
    return null
  }

  const head = rest.slice(0, firstSpaceIndex)
  let pathAndDescription = rest.slice(firstSpaceIndex + 1)
  let description: string | undefined
  const descriptionIndex = pathAndDescription.lastIndexOf(' (')

  if (descriptionIndex !== -1 && pathAndDescription.endsWith(')')) {
    description = pathAndDescription.slice(descriptionIndex + 2, -1)
    pathAndDescription = pathAndDescription.slice(0, descriptionIndex)
  }

  return {
    path: normalizeRelativePath(pathAndDescription),
    head: head || undefined,
    status: mapSubmoduleStatus(prefix),
    description
  }
}

export function mapSubmoduleStatus(prefix: string): SubmoduleStatus {
  if (prefix === ' ') return 'initialized'
  if (prefix === '-') return 'uninitialized'
  if (prefix === '+') return 'modified'
  if (prefix === 'U') return 'conflicted'
  return 'unknown'
}

export function parseGitLfsVersion(output: string): string | undefined {
  const firstLine = output.trim().split('\n')[0]

  return firstLine || undefined
}

export function gitLfsMessage(installed: boolean, patternCount: number, fileCount: number, version?: string): string {
  if (!installed) {
    return patternCount > 0
      ? 'Git LFS patterns are configured, but git-lfs is not installed.'
      : 'Git LFS is not installed.'
  }

  if (patternCount === 0 && fileCount === 0) {
    return `${version ?? 'Git LFS'} detected. No tracked LFS patterns were found.`
  }

  return `${version ?? 'Git LFS'} detected with ${patternCount} tracked pattern${patternCount === 1 ? '' : 's'} and ${fileCount} known LFS file${fileCount === 1 ? '' : 's'}.`
}

export function parseGitLfsPatterns(content: string, sourcePath: string): GitLfsPattern[] {
  return content
    .split('\n')
    .map((line, index) => parseGitLfsPatternLine(line, sourcePath, index + 1))
    .filter((pattern): pattern is GitLfsPattern => Boolean(pattern))
}

export function buildCommitMessage(title: string, description: string, coAuthors?: string): string {
  const parts = [title.trim()]
  const body = description.trim()
  const coAuthorTrailers = normalizeCoAuthorTrailers(coAuthors)

  if (body) {
    parts.push(body)
  }

  if (coAuthorTrailers.length > 0) {
    parts.push(coAuthorTrailers.join('\n'))
  }

  return parts.join('\n\n')
}

export function normalizeCoAuthorTrailers(input?: string): string[] {
  return (input ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const identity = line.replace(/^co-authored-by:\s*/i, '').trim()

      if (!/^.+\s<[^<>\s]+@[^<>\s]+>$/.test(identity)) {
        throw new BranchPilotUserError(
          'invalid_co_author',
          'Co-author lines must use Name <email@example.com> format.'
        )
      }

      return `Co-authored-by: ${identity}`
    })
}

export function parseGitLfsPatternLine(line: string, sourcePath: string, lineNumber: number): GitLfsPattern | null {
  const trimmed = line.trim()

  if (!trimmed || trimmed.startsWith('#')) {
    return null
  }

  const [pattern, ...attributes] = trimmed.split(/\s+/)

  if (!pattern || pattern.startsWith('#') || !attributes.includes('filter=lfs')) {
    return null
  }

  return {
    pattern,
    sourcePath,
    line: lineNumber
  }
}

export function parseGitLfsFiles(output: string): GitLfsFile[] {
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map(parseGitLfsFileLine)
    .filter((file): file is GitLfsFile => Boolean(file))
}

export function parseGitLfsFileLine(line: string): GitLfsFile | null {
  const match = line.match(/^([a-fA-F0-9]{40,64})\s+([*-])\s+(.+)$/)

  if (match) {
    const [, oid, marker, filePath] = match

    return {
      oid,
      path: normalizeRelativePath(filePath),
      status: mapGitLfsFileStatus(marker)
    }
  }

  const fallback = line.match(/^([*-])\s+(.+)$/)

  if (fallback) {
    const [, marker, filePath] = fallback

    return {
      path: normalizeRelativePath(filePath),
      status: mapGitLfsFileStatus(marker)
    }
  }

  return null
}

export function mapGitLfsFileStatus(marker: string): GitLfsFileStatus {
  if (marker === '*') return 'present'
  if (marker === '-') return 'pointer'
  return 'unknown'
}

export function parseWorktreeList(output: string, rootPath: string): WorktreeSummary[] {
  const entries: WorktreeSummary[] = []
  const records = output.split('\0')
  let current: Partial<WorktreeSummary> | null = null
  const normalizedRootPath = path.resolve(rootPath)

  for (const record of records) {
    if (!record) {
      if (current?.path) {
        entries.push(finalizeWorktreeSummary(current, normalizedRootPath))
      }
      current = null
      continue
    }

    const [key, ...valueParts] = record.split(' ')
    const value = valueParts.join(' ')

    if (key === 'worktree') {
      if (current?.path) {
        entries.push(finalizeWorktreeSummary(current, normalizedRootPath))
      }
      current = {
        path: value,
        detached: false,
        bare: false,
        locked: false,
        prunable: false,
        current: false
      }
      continue
    }

    if (!current) {
      continue
    }

    if (key === 'HEAD') {
      current.head = value || undefined
    } else if (key === 'branch') {
      current.branch = value.startsWith('refs/heads/') ? value.slice('refs/heads/'.length) : value
    } else if (key === 'detached') {
      current.detached = true
    } else if (key === 'bare') {
      current.bare = true
    } else if (key === 'locked') {
      current.locked = true
      current.reason = value || current.reason
    } else if (key === 'prunable') {
      current.prunable = true
      current.reason = value || current.reason
    }
  }

  if (current?.path) {
    entries.push(finalizeWorktreeSummary(current, normalizedRootPath))
  }

  return entries
}

export function finalizeWorktreeSummary(worktree: Partial<WorktreeSummary>, normalizedRootPath: string): WorktreeSummary {
  return {
    path: worktree.path ?? '',
    branch: worktree.branch,
    head: worktree.head,
    detached: Boolean(worktree.detached),
    bare: Boolean(worktree.bare),
    locked: Boolean(worktree.locked),
    prunable: Boolean(worktree.prunable),
    current: path.resolve(worktree.path ?? '') === normalizedRootPath,
    reason: worktree.reason
  }
}

export function mapRawStatus(rawStatus: string) {
  if (rawStatus.startsWith('A')) return 'added'
  if (rawStatus.startsWith('D')) return 'deleted'
  if (rawStatus.startsWith('R')) return 'renamed'
  if (rawStatus.startsWith('C')) return 'copied'
  if (rawStatus.startsWith('M')) return 'modified'

  return 'unknown'
}
