import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type {
  AgentRunRecord,
  AgentRunSummary,
  CodexAgentEvent
} from '../../src/shared/branchPilot.js'
import { redact } from './commandRunner.js'
import { BranchPilotUserError } from './errors.js'
import { normalizeNativePath } from './platformExecutables.js'

const AGENT_RUN_STORE_VERSION = 1
const RETENTION_LIMIT = 200
const DEFAULT_LIST_LIMIT = 50
const MAX_LIST_LIMIT = 200
const MAX_EVENTS_PER_RUN = 200
const MAX_EVENT_TEXT_LENGTH = 4_000
const MAX_OUTPUT_LENGTH = 120_000
const MAX_PROMPT_LENGTH = 20_000
const MAX_VERDICT_LENGTH = 2_000
const SUMMARY_PREVIEW_LENGTH = 200

interface PersistedAgentRuns {
  version: 1
  repoPath: string
  runs: AgentRunRecord[]
}

export class AgentRunStore {
  constructor(private readonly directoryPath: string) {}

  async append(record: AgentRunRecord): Promise<AgentRunRecord> {
    const repoPath = normalizeRepoPath(record.repoPath)
    const store = await this.readPersisted(repoPath)
    const sanitized = sanitizeRecord({ ...record, repoPath })

    store.runs = [sanitized, ...store.runs.filter((run) => run.id !== sanitized.id)].slice(0, RETENTION_LIMIT)

    await this.writePersisted(store)

    return sanitized
  }

  async getRuns(repoPath: string, limit?: number): Promise<AgentRunRecord[]> {
    const rootPath = normalizeRepoPath(repoPath)
    const store = await this.readPersisted(rootPath)

    return store.runs.slice(0, normalizeLimit(limit))
  }

  async getRun(repoPath: string, id: string): Promise<AgentRunRecord | null> {
    const rootPath = normalizeRepoPath(repoPath)
    const store = await this.readPersisted(rootPath)

    return store.runs.find((run) => run.id === id) ?? null
  }

  async getRecentSummaries(repoPath: string, limit: number): Promise<AgentRunSummary[]> {
    const runs = await this.getRuns(repoPath, limit)

    return runs.map(toSummary)
  }

  private async readPersisted(repoPath: string): Promise<PersistedAgentRuns> {
    try {
      const raw = await fs.readFile(this.filePath(repoPath), 'utf8')
      const parsed = JSON.parse(raw) as PersistedAgentRuns

      if (parsed.version !== AGENT_RUN_STORE_VERSION || parsed.repoPath !== repoPath || !Array.isArray(parsed.runs)) {
        return emptyStore(repoPath)
      }

      return {
        version: AGENT_RUN_STORE_VERSION,
        repoPath,
        runs: parsed.runs.filter(isAgentRunRecord).slice(0, RETENTION_LIMIT)
      }
    } catch {
      return emptyStore(repoPath)
    }
  }

  private async writePersisted(store: PersistedAgentRuns): Promise<void> {
    await fs.mkdir(this.directoryPath, { recursive: true })
    await fs.writeFile(this.filePath(store.repoPath), JSON.stringify(store, null, 2), 'utf8')
  }

  private filePath(repoPath: string): string {
    return path.join(this.directoryPath, `${repositoryId(repoPath)}.json`)
  }
}

function emptyStore(repoPath: string): PersistedAgentRuns {
  return {
    version: AGENT_RUN_STORE_VERSION,
    repoPath,
    runs: []
  }
}

function sanitizeRecord(record: AgentRunRecord): AgentRunRecord {
  return {
    ...record,
    prompt: capText(record.prompt, MAX_PROMPT_LENGTH),
    output: capText(record.output, MAX_OUTPUT_LENGTH),
    verdict: record.verdict === undefined ? undefined : capText(record.verdict, MAX_VERDICT_LENGTH),
    events: sanitizeEvents(record.events)
  }
}

function sanitizeEvents(events: CodexAgentEvent[]): CodexAgentEvent[] {
  if (!Array.isArray(events)) {
    return []
  }

  return events.slice(-MAX_EVENTS_PER_RUN).map((event) => ({
    type: typeof event.type === 'string' ? event.type : 'unknown',
    text: capText(event.text ?? '', MAX_EVENT_TEXT_LENGTH)
  }))
}

function capText(text: string, maxLength: number): string {
  const redacted = redact(typeof text === 'string' ? text : String(text ?? ''))

  return redacted.length > maxLength ? `${redacted.slice(0, maxLength)}...` : redacted
}

function toSummary(record: AgentRunRecord): AgentRunSummary {
  return {
    id: record.id,
    assistant: record.assistant,
    status: record.status,
    prompt: preview(record.prompt),
    verdict: record.verdict === undefined ? undefined : preview(record.verdict),
    filePath: record.filePath,
    durationMs: record.durationMs,
    createdAt: record.createdAt
  }
}

function preview(text: string): string {
  const normalized = (text ?? '').replace(/\s+/g, ' ').trim()

  return normalized.length > SUMMARY_PREVIEW_LENGTH
    ? `${normalized.slice(0, SUMMARY_PREVIEW_LENGTH)}...`
    : normalized
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
    return DEFAULT_LIST_LIMIT
  }

  return Math.min(MAX_LIST_LIMIT, Math.max(1, Math.floor(limit)))
}

function isAgentRunRecord(record: unknown): record is AgentRunRecord {
  const candidate = record as Partial<AgentRunRecord>

  return Boolean(
    candidate.id &&
    candidate.repoPath &&
    candidate.assistant &&
    candidate.status &&
    typeof candidate.prompt === 'string' &&
    typeof candidate.output === 'string' &&
    Array.isArray(candidate.events) &&
    candidate.createdAt
  )
}

function repositoryId(rootPath: string): string {
  return createHash('sha256').update(rootPath).digest('hex').slice(0, 16)
}
