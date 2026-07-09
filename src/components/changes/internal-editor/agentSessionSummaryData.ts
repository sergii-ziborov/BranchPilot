import type { AgentRunStatus, AgentRunSummary } from '../../../shared/branchPilot'

/** One compact recap line for a single recorded agent run. */
export interface AgentSessionRunLine {
  id: string
  assistant: string
  status: AgentRunStatus
  /** First line of the prompt, trimmed and length-capped for a one-liner. */
  prompt: string
  verdict?: string
  filePath?: string
  durationMs: number
  createdAt: string
}

/** Client-side rollup of this session's stored agent runs. */
export interface AgentSessionSummary {
  runCount: number
  completed: number
  cancelled: number
  failed: number
  totalDurationMs: number
  runs: AgentSessionRunLine[]
}

const PROMPT_PREVIEW_MAX_CHARS = 120

function toTimestamp(createdAt: string): number {
  const value = Date.parse(createdAt)
  return Number.isNaN(value) ? 0 : value
}

/** Collapse a prompt into a single trimmed, length-capped line. */
export function shortAgentPrompt(prompt: string, maxChars = PROMPT_PREVIEW_MAX_CHARS): string {
  const firstLine = prompt.split('\n').map((line) => line.trim()).find((line) => line.length > 0) ?? ''
  if (firstLine.length <= maxChars) return firstLine
  return `${firstLine.slice(0, maxChars - 1).trimEnd()}…`
}

/**
 * Pure rollup: keep runs recorded at or after `sinceTs` (this session), newest
 * first, and total up per-status counts and duration. When `sinceTs` excludes
 * everything (e.g. a run's clock skewed earlier) the result is simply empty —
 * callers can fall back to showing the most recent stored runs if desired.
 */
export function summarizeAgentSession(runs: AgentRunSummary[], sinceTs: number): AgentSessionSummary {
  const sessionRuns = runs
    .filter((run) => toTimestamp(run.createdAt) >= sinceTs)
    .sort((a, b) => toTimestamp(b.createdAt) - toTimestamp(a.createdAt))

  const summary: AgentSessionSummary = {
    runCount: sessionRuns.length,
    completed: 0,
    cancelled: 0,
    failed: 0,
    totalDurationMs: 0,
    runs: []
  }

  for (const run of sessionRuns) {
    if (run.status === 'completed') summary.completed += 1
    else if (run.status === 'cancelled') summary.cancelled += 1
    else if (run.status === 'failed') summary.failed += 1

    summary.totalDurationMs += Math.max(0, run.durationMs)
    summary.runs.push({
      id: run.id,
      assistant: run.assistant,
      status: run.status,
      prompt: shortAgentPrompt(run.prompt),
      verdict: run.verdict,
      filePath: run.filePath,
      durationMs: run.durationMs,
      createdAt: run.createdAt
    })
  }

  return summary
}
