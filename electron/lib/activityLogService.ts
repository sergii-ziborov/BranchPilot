import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type {
  ActivityLogActor,
  ActivityLogEntry,
  ActivityLogEventType,
  ActivityLogMetadata,
  ActivityLogMetadataValue,
  ActivityLogQuery,
  ActivityLogSnapshot,
  ActivityLogStatus
} from '../../src/shared/branchPilot.js'
import { redact } from './commandRunner.js'
import { BranchPilotUserError } from './errors.js'
import { normalizeNativePath } from './platformExecutables.js'

const ACTIVITY_LOG_VERSION = 1
const RETENTION_LIMIT = 500
const DEFAULT_QUERY_LIMIT = 100
const MAX_QUERY_LIMIT = 500
const MAX_METADATA_STRING_LENGTH = 300

interface PersistedActivityLog {
  version: 1
  repoPath: string
  entries: ActivityLogEntry[]
}

export interface ActivityLogAppendInput {
  repoPath: string
  type: ActivityLogEventType
  actor: ActivityLogActor
  status: ActivityLogStatus
  title: string
  metadata?: ActivityLogMetadata
}

export class ActivityLogService {
  constructor(private readonly directoryPath: string) {}

  async append(input: ActivityLogAppendInput): Promise<ActivityLogEntry> {
    const repoPath = normalizeRepoPath(input.repoPath)
    const log = await this.readPersisted(repoPath)
    const entry: ActivityLogEntry = {
      id: randomUUID(),
      repoPath,
      type: input.type,
      actor: input.actor,
      status: input.status,
      title: sanitizeTitle(input.title),
      createdAt: new Date().toISOString(),
      metadata: sanitizeMetadata(input.metadata ?? {})
    }

    log.entries = [entry, ...log.entries].slice(0, RETENTION_LIMIT)

    await this.writePersisted(log)

    return entry
  }

  async getActivityLog(query: ActivityLogQuery): Promise<ActivityLogSnapshot> {
    const repoPath = normalizeRepoPath(query.repoPath)
    const log = await this.readPersisted(repoPath)
    const filtered = log.entries
      .filter((entry) => !query.types?.length || query.types.includes(entry.type))
      .filter((entry) => !query.actor || entry.actor === query.actor)
      .filter((entry) => !query.status || entry.status === query.status)

    return {
      repoPath,
      totalCount: filtered.length,
      entries: filtered.slice(0, normalizeLimit(query.limit))
    }
  }

  async clearActivityLog(repoPath: string, confirmed: boolean): Promise<ActivityLogSnapshot> {
    const rootPath = normalizeRepoPath(repoPath)

    if (!confirmed) {
      throw new BranchPilotUserError('confirmation_required', 'Clearing the activity log requires confirmation.')
    }

    await this.writePersisted({
      version: ACTIVITY_LOG_VERSION,
      repoPath: rootPath,
      entries: []
    })

    return {
      repoPath: rootPath,
      entries: [],
      totalCount: 0
    }
  }

  async getRecentEntries(repoPath: string, limit = DEFAULT_QUERY_LIMIT): Promise<ActivityLogEntry[]> {
    return (await this.getActivityLog({ repoPath, limit })).entries
  }

  private async readPersisted(repoPath: string): Promise<PersistedActivityLog> {
    try {
      const raw = await fs.readFile(this.filePath(repoPath), 'utf8')
      const parsed = JSON.parse(raw) as PersistedActivityLog

      if (parsed.version !== ACTIVITY_LOG_VERSION || parsed.repoPath !== repoPath || !Array.isArray(parsed.entries)) {
        return emptyLog(repoPath)
      }

      return {
        version: ACTIVITY_LOG_VERSION,
        repoPath,
        entries: parsed.entries.filter(isActivityLogEntry).slice(0, RETENTION_LIMIT)
      }
    } catch {
      return emptyLog(repoPath)
    }
  }

  private async writePersisted(log: PersistedActivityLog): Promise<void> {
    await fs.mkdir(this.directoryPath, { recursive: true })
    await fs.writeFile(this.filePath(log.repoPath), JSON.stringify(log, null, 2), 'utf8')
  }

  private filePath(repoPath: string): string {
    return path.join(this.directoryPath, `${repositoryId(repoPath)}.json`)
  }
}

function emptyLog(repoPath: string): PersistedActivityLog {
  return {
    version: ACTIVITY_LOG_VERSION,
    repoPath,
    entries: []
  }
}

function normalizeRepoPath(repoPath: string): string {
  const normalized = repoPath.trim()

  if (!normalized) {
    throw new BranchPilotUserError('invalid_repository_path', 'Repository path is required.')
  }

  return normalizeNativePath(normalized)
}

function normalizeLimit(limit: number | undefined): number {
  if (!limit || !Number.isFinite(limit)) {
    return DEFAULT_QUERY_LIMIT
  }

  return Math.min(MAX_QUERY_LIMIT, Math.max(1, Math.floor(limit)))
}

function sanitizeTitle(title: string): string {
  const normalized = redact(title).trim()
  return normalized.slice(0, 160) || 'BranchPilot activity'
}

export function sanitizeMetadata(metadata: ActivityLogMetadata): ActivityLogMetadata {
  const sanitized: ActivityLogMetadata = {}

  for (const [key, value] of Object.entries(metadata)) {
    if (value === undefined) {
      continue
    }

    sanitized[key] = sanitizeMetadataValue(value)
  }

  return sanitized
}

function sanitizeMetadataValue(value: ActivityLogMetadataValue): ActivityLogMetadataValue {
  if (typeof value !== 'string') {
    return value
  }

  const redacted = redact(value)
    .replace(/(authorization:\s*bearer\s+)[^\s]+/gi, '$1<redacted>')
    .replace(/(api[_-]?key=)[^\s]+/gi, '$1<redacted>')
    .replace(/(secret=)[^\s]+/gi, '$1<redacted>')

  return redacted.length > MAX_METADATA_STRING_LENGTH
    ? `${redacted.slice(0, MAX_METADATA_STRING_LENGTH)}...`
    : redacted
}

function isActivityLogEntry(entry: unknown): entry is ActivityLogEntry {
  const candidate = entry as Partial<ActivityLogEntry>
  return Boolean(
    candidate.id &&
    candidate.repoPath &&
    candidate.type &&
    candidate.actor &&
    candidate.status &&
    candidate.title &&
    candidate.createdAt &&
    candidate.metadata &&
    typeof candidate.metadata === 'object'
  )
}

function repositoryId(rootPath: string): string {
  return createHash('sha256').update(rootPath).digest('hex').slice(0, 16)
}
