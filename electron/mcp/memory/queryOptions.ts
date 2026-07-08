import type {
  ActivityLogActor,
  ActivityLogEventType,
  ActivityLogStatus,
  ProjectMemorySymbolKind,
  ProjectWikiPageId
} from '../../../src/shared/branchPilot.js'

export interface MemoryQueryOptions {
  memoryDir: string
  activityDir?: string
  wikiDir?: string
  repoPath?: string
}

export interface SearchFilesOptions extends MemoryQueryOptions {
  query?: string
  language?: string
  limit?: number
}

export interface SearchSymbolsOptions extends MemoryQueryOptions {
  query?: string
  kind?: ProjectMemorySymbolKind
  path?: string
  limit?: number
}

export interface FileOutlineOptions extends MemoryQueryOptions {
  path: string
}

export interface SymbolContextOptions extends MemoryQueryOptions {
  symbolId?: string
  name?: string
  path?: string
}

export interface RecentCommitsOptions extends MemoryQueryOptions {
  limit?: number
}

export type CurrentGitStateOptions = MemoryQueryOptions

export interface AgentActivityOptions extends MemoryQueryOptions {
  types?: ActivityLogEventType[]
  actor?: ActivityLogActor
  status?: ActivityLogStatus
  limit?: number
}

export interface WikiPageOptions extends MemoryQueryOptions {
  pageId: ProjectWikiPageId
}
