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

export interface RepositoryDiffOptions extends MemoryQueryOptions {
  mode?: 'all' | 'staged' | 'unstaged'
  format?: 'patch' | 'stat' | 'name-only'
  path?: string
  base?: string
  head?: string
  mergeBase?: boolean
  contextLines?: number
  maxBytes?: number
}

export interface CommitSearchOptions extends MemoryQueryOptions {
  query?: string
  author?: string
  since?: string
  until?: string
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
