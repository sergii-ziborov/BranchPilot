import path from 'node:path'
import { BranchPilotUserError } from './errors.js'
import { normalizeNativePath } from './platformExecutables.js'
import type {
  CommitFileChange,
  CommitSummary,
  GitGraphToken,
  GitLfsFile,
  GitLfsFileStatus,
  GitLfsPattern,
  StashEntry,
  SubmoduleStatus,
  TagSummary,
  WorktreeSummary
} from '../../src/shared/branchPilot.js'

/** Parsers: git/gh output -> structured RepositoryService models. */

const GRAPH_PAYLOAD_SEPARATOR = '\x1f'
const ANSI_PATTERN = /\x1b\[[0-9;]*m/g
const ANSI_COLOR_MAP = new Map<string, string>([
  ['30', '#8b949e'],
  ['31', '#ff7b72'],
  ['32', '#3fb950'],
  ['33', '#d29922'],
  ['34', '#58a6ff'],
  ['35', '#bc8cff'],
  ['36', '#39c5cf'],
  ['37', '#c9d1d9'],
  ['90', '#6e7681'],
  ['91', '#ff938a'],
  ['92', '#56d364'],
  ['93', '#eac54f'],
  ['94', '#79c0ff'],
  ['95', '#d2a8ff'],
  ['96', '#56d4dd'],
  ['97', '#f0f6fc'],
  ['1;30', '#8b949e'],
  ['1;31', '#ff938a'],
  ['1;32', '#56d364'],
  ['1;33', '#eac54f'],
  ['1;34', '#79c0ff'],
  ['1;35', '#d2a8ff'],
  ['1;36', '#56d4dd'],
  ['1;37', '#f0f6fc']
])

function stripAnsi(value: string): string {
  return value.replace(ANSI_PATTERN, '')
}

function parseGraphTokens(value: string): GitGraphToken[] {
  const tokens: GitGraphToken[] = []
  let color: string | undefined
  let column = 0
  let index = 0

  while (index < value.length) {
    if (value[index] === '\x1b') {
      const match = /^\x1b\[([0-9;]*)m/.exec(value.slice(index))
      if (match) {
        color = ANSI_COLOR_MAP.get(match[1] || '0')
        index += match[0].length
        continue
      }
    }

    const ch = value[index]
    if (ch !== ' ') tokens.push({ column, ch, ...(color ? { color } : {}) })
    column += 1
    index += 1
  }

  return tokens
}

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
  const payloadIndex = line.indexOf(GRAPH_PAYLOAD_SEPARATOR)
  if (payloadIndex !== -1) {
    const graphPrefixRaw = line.slice(0, payloadIndex)
    const graphPrefix = stripAnsi(graphPrefixRaw).trimEnd()
    const [sha, shortSha, subject, parentShasText, authorName, authorEmail, authoredAt] = stripAnsi(line.slice(payloadIndex + 1)).split('\0')
    const graphPrefixTokens = parseGraphTokens(graphPrefixRaw)

    return {
      sha,
      shortSha: shortSha || sha.slice(0, 7),
      subject: subject || '',
      parentShas: parentShasText ? parentShasText.split(' ').filter(Boolean) : [],
      authorName: authorName || '',
      authorEmail: authorEmail || '',
      authoredAt: authoredAt || '',
      ...(graphPrefix ? { graphPrefix } : {}),
      ...(graphPrefixTokens.length ? { graphPrefixTokens } : {})
    }
  }

  const firstSeparator = line.indexOf('\0')
  const head = firstSeparator === -1 ? line : line.slice(0, firstSeparator)
  const shaMatch = /([0-9a-f]{40})$/i.exec(head)
  const graphPrefix = shaMatch && shaMatch.index > 0 ? head.slice(0, shaMatch.index).trimEnd() : undefined
  const sha = shaMatch ? shaMatch[1] : head
  const fields = firstSeparator === -1 ? [] : line.slice(firstSeparator + 1).split('\0')
  const [shortSha, subject, parentShasText, authorName, authorEmail, authoredAt] = fields

  return {
    sha,
    shortSha: shortSha || sha.slice(0, 7),
    subject: subject || '',
    parentShas: parentShasText ? parentShasText.split(' ').filter(Boolean) : [],
    authorName: authorName || '',
    authorEmail: authorEmail || '',
    authoredAt: authoredAt || '',
    ...(graphPrefix ? { graphPrefix } : {})
  }
}

export function parseCommitHistory(output: string): CommitSummary[] {
  const commits: CommitSummary[] = []
  let lastCommit: CommitSummary | null = null

  for (const line of output.split('\n')) {
    if (!line) continue

    if (line.includes('\0')) {
      const commit = parseCommitSummary(line)
      commits.push(commit)
      lastCommit = commit
      continue
    }

    if (!lastCommit) continue
    const rawGraphLine = line.trimEnd()
    const graphLine = stripAnsi(rawGraphLine)
    if (!graphLine) continue
    lastCommit.graphAfter = [...(lastCommit.graphAfter ?? []), graphLine]
    lastCommit.graphAfterTokens = [...(lastCommit.graphAfterTokens ?? []), parseGraphTokens(rawGraphLine)]
  }

  return commits
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
  const normalizedRootPath = path.resolve(normalizeNativePath(rootPath))

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
        path: normalizeNativePath(value),
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
    path: normalizeNativePath(worktree.path ?? ''),
    branch: worktree.branch,
    head: worktree.head,
    detached: Boolean(worktree.detached),
    bare: Boolean(worktree.bare),
    locked: Boolean(worktree.locked),
    prunable: Boolean(worktree.prunable),
    current: path.resolve(normalizeNativePath(worktree.path ?? '')) === normalizedRootPath,
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
