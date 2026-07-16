import type {
  ActivityLogActor,
  ActivityLogEventType,
  ActivityLogStatus,
  ProjectWikiPageId
} from '../../../src/shared/branchPilot.js'

export interface MemoryQueryOptions {
  memoryDir: string
  activityDir?: string
  wikiDir?: string
  agentRunDir?: string
  repoPath?: string
}

export interface AgentRunListOptions extends MemoryQueryOptions {
  limit?: number
}

export interface AgentRunDetailOptions extends MemoryQueryOptions {
  id: string
}

export interface RecentCommitsOptions extends MemoryQueryOptions {
  limit?: number
}

export type CurrentGitStateOptions = MemoryQueryOptions

export interface AgentActivityOptions extends MemoryQueryOptions {
  types?: ActivityLogEventType[]
  actor?: ActivityLogActor
  status?: ActivityLogStatus
  since?: string
  until?: string
  limit?: number
}

export interface WikiPageOptions extends MemoryQueryOptions {
  pageId: ProjectWikiPageId
}

export interface SessionNoteOptions extends MemoryQueryOptions {
  title: string
  detail?: string
  phase?: 'started' | 'completed' | 'failed'
}
