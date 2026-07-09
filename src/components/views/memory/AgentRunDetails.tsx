import type { AgentRunRecord, AgentRunStatus } from '../../../shared/branchPilot'

interface AgentRunDetailsProps {
  record: AgentRunRecord | null
  loading: boolean
  error: string | null
}

const STATUS_LABEL: Record<AgentRunStatus, string> = {
  completed: 'Completed',
  cancelled: 'Cancelled',
  failed: 'Failed'
}

/** Inline expanded view of a recorded local-agent run: output, trace, and run metadata. */
export function AgentRunDetails({ record, loading, error }: AgentRunDetailsProps) {
  if (loading) {
    return <div className="agent-run-details agent-run-details-status" role="status">Loading run details...</div>
  }

  if (error) {
    return <div className="agent-run-details agent-run-details-status is-error" role="alert">{error}</div>
  }

  if (!record) {
    return <div className="agent-run-details agent-run-details-status">No run details available.</div>
  }

  const durationSeconds = Math.max(1, Math.round(record.durationMs / 1000))

  return (
    <section className="agent-run-details" aria-label="Agent run details">
      <header className="agent-run-details-head">
        <span className={`agent-run-status status-${record.status}`}>{STATUS_LABEL[record.status]}</span>
        <span className="agent-run-chip">{record.modelLabel ? `${record.assistant} - ${record.modelLabel}` : record.assistant}</span>
        <span className="agent-run-chip">{durationSeconds}s</span>
        <span className="agent-run-chip">{record.sandbox}</span>
        <span className="agent-run-chip">{record.reasoning}</span>
        {record.filePath && <span className="agent-run-chip agent-run-file" title={record.filePath}>{record.filePath}</span>}
      </header>
      {record.verdict && <p className="agent-run-verdict">{record.verdict}</p>}
      <div className="agent-run-output">
        <pre>{record.output || '(no output captured)'}</pre>
      </div>
      {record.events.length > 0 && (
        <details className="changes-editor-codex-trace agent-run-trace">
          <summary>Trace - {record.events.length}</summary>
          <div>
            {record.events.map((event, index) => (
              <article key={`${event.type}-${index}`}>
                <strong>{event.type}</strong>
                <span>{event.text}</span>
              </article>
            ))}
          </div>
        </details>
      )}
    </section>
  )
}
