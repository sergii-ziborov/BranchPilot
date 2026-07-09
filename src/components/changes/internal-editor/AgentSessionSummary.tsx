import { RefreshCw } from 'lucide-react'
import type { AgentRunStatus } from '../../../shared/branchPilot'
import type { AgentSessionSummary as AgentSessionSummaryData } from './agentSessionSummaryData'

interface AgentSessionSummaryProps {
  summary: AgentSessionSummaryData
  loading: boolean
  error: string | null
  onRefresh: () => void
}

const STATUS_LABEL: Record<AgentRunStatus, string> = {
  completed: 'Completed',
  cancelled: 'Stopped',
  failed: 'Failed'
}

function formatDuration(durationMs: number): string {
  const seconds = Math.max(0, Math.round(durationMs / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const remainder = seconds % 60
  return remainder === 0 ? `${minutes}m` : `${minutes}m ${remainder}s`
}

/** Compact client-side recap of this session's recorded agent runs. */
export function AgentSessionSummary({ summary, loading, error, onRefresh }: AgentSessionSummaryProps) {
  return (
    <section className="changes-editor-codex-summary" aria-label="Agent session summary">
      <div className="changes-editor-codex-summary-totals">
        <span className="changes-editor-codex-summary-count">{summary.runCount} run{summary.runCount === 1 ? '' : 's'} this session</span>
        {summary.completed > 0 && <span className="agent-run-status status-completed">{summary.completed} completed</span>}
        {summary.cancelled > 0 && <span className="agent-run-status status-cancelled">{summary.cancelled} stopped</span>}
        {summary.failed > 0 && <span className="agent-run-status status-failed">{summary.failed} failed</span>}
        {summary.runCount > 0 && <span className="agent-run-chip">{formatDuration(summary.totalDurationMs)} total</span>}
        <button
          type="button"
          className="changes-editor-codex-summary-refresh compact-icon"
          onClick={onRefresh}
          disabled={loading}
          title="Refresh session summary"
          aria-label="Refresh session summary"
        >
          <RefreshCw className={loading ? 'spin' : ''} size={13} />
        </button>
      </div>

      {error ? (
        <div className="changes-editor-codex-summary-status is-error" role="alert">{error}</div>
      ) : loading && summary.runCount === 0 ? (
        <div className="changes-editor-codex-summary-status" role="status">Loading session runs...</div>
      ) : summary.runCount === 0 ? (
        <div className="changes-editor-codex-summary-status">No agent runs recorded yet this session.</div>
      ) : (
        <ol className="changes-editor-codex-summary-list">
          {summary.runs.map((run) => (
            <li key={run.id} className="changes-editor-codex-summary-run">
              <div className="changes-editor-codex-summary-run-head">
                <span className={`agent-run-status status-${run.status}`}>{STATUS_LABEL[run.status]}</span>
                <span className="changes-editor-codex-summary-run-prompt" title={run.prompt}>{run.prompt || '(no prompt)'}</span>
                <span className="agent-run-chip">{formatDuration(run.durationMs)}</span>
              </div>
              {(run.verdict || run.filePath) && (
                <div className="changes-editor-codex-summary-run-meta">
                  {run.filePath && <span className="agent-run-chip agent-run-file" title={run.filePath}>{run.filePath}</span>}
                  {run.verdict && <span className="changes-editor-codex-summary-run-verdict">{run.verdict}</span>}
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
