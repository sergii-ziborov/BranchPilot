import { ActivityLogService } from '../../lib/activityLogService.js'
import type {
  AgentActivityOptions,
  CurrentGitStateOptions,
  MemoryQueryOptions,
  RecentCommitsOptions,
  SessionNoteOptions
} from './queryOptions.js'
import { normalizeLimit } from './queryPrimitives.js'
import { loadProjectMemorySnapshot } from './snapshotStore.js'

export async function getProjectSummary(options: MemoryQueryOptions) {
  const snapshot = await loadProjectMemorySnapshot(options)
  const activity = await getAgentActivity({ ...options, limit: 10 })

  return {
    scannedAt: snapshot.scannedAt,
    repository: snapshot.repository,
    counts: {
      files: snapshot.files.length,
      symbols: snapshot.symbols.length,
      imports: snapshot.imports.length,
      recentCommits: snapshot.recentCommits.length,
      recentActivity: activity.totalCount
    },
    stackHints: snapshot.stackHints,
    recentCommits: snapshot.recentCommits.slice(0, 10),
    recentActivity: activity.entries
  }
}

export async function getRecentCommits(options: RecentCommitsOptions) {
  const snapshot = await loadProjectMemorySnapshot(options)

  return {
    scannedAt: snapshot.scannedAt,
    repository: snapshot.repository,
    commits: snapshot.recentCommits.slice(0, normalizeLimit(options.limit))
  }
}

export async function getCurrentGitState(options: CurrentGitStateOptions) {
  const snapshot = await loadProjectMemorySnapshot(options)

  return {
    scannedAt: snapshot.scannedAt,
    indexedState: true,
    repository: snapshot.repository
  }
}

const DATE_FILTER_FETCH_LIMIT = 100

export async function getAgentActivity(options: AgentActivityOptions) {
  const snapshot = await loadProjectMemorySnapshot(options)

  if (!options.activityDir) {
    return {
      scannedAt: snapshot.scannedAt,
      repository: snapshot.repository,
      totalCount: 0,
      entries: []
    }
  }

  const since = parseActivityDate(options.since, 'since')
  const until = parseActivityDate(options.until, 'until')
  const limit = normalizeLimit(options.limit)
  const activity = await new ActivityLogService(options.activityDir).getActivityLog({
    repoPath: snapshot.repository.rootPath,
    types: options.types,
    actor: options.actor,
    status: options.status,
    // The service has no date filter, so fetch wide and filter createdAt here.
    limit: since != null || until != null ? DATE_FILTER_FETCH_LIMIT : limit
  })
  const entries = activity.entries
    .filter((entry) => since == null || Date.parse(entry.createdAt) >= since)
    .filter((entry) => until == null || Date.parse(entry.createdAt) <= until)
    .slice(0, limit)

  return {
    scannedAt: snapshot.scannedAt,
    repository: snapshot.repository,
    totalCount: activity.totalCount,
    entries
  }
}

// The ONLY write in the BranchPilot MCP, and it touches BranchPilot's own activity ledger — never the
// repository. Assistants record long/expensive work here ("started full test run") so a crashed or new
// session can check get_agent_activity instead of unknowingly redoing it.
export async function recordSessionNote(options: SessionNoteOptions) {
  const snapshot = await loadProjectMemorySnapshot(options)

  if (!options.activityDir) {
    throw new Error('Activity log directory is not configured for this MCP server. Recopy the config from Reports > MCP.')
  }

  const phase = options.phase ?? 'completed'
  const entry = await new ActivityLogService(options.activityDir).append({
    repoPath: snapshot.repository.rootPath,
    type: 'assistant_session_note',
    actor: 'assistant',
    status: phase === 'failed' ? 'failure' : 'success',
    title: options.title,
    metadata: {
      phase,
      ...(options.detail ? { detail: options.detail } : {})
    }
  })

  return {
    recorded: true,
    entry
  }
}

function parseActivityDate(value: string | undefined, label: string): number | null {
  if (!value?.trim()) {
    return null
  }

  const parsed = Date.parse(value)

  if (Number.isNaN(parsed)) {
    throw new Error(`Invalid ${label} value: "${value}". Use an ISO date such as 2026-07-13 or 2026-07-13T10:00:00Z.`)
  }

  return parsed
}
