import type { MemoryQueryOptions } from '../memoryQueries.js'

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
