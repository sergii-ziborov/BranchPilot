import type { ConfirmationRequest, TextPromptRequest } from '../lib/prompts'

/** Modal for creating a new branch (GitHub-Desktop style: name + base branch). */
export function CreateBranchDialog({
  baseBranch,
  value,
  busy,
  onChange,
  onCancel,
  onCreate
}: {
  baseBranch: string | null
  value: string
  busy: boolean
  onChange: (value: string) => void
  onCancel: () => void
  onCreate: () => void
}) {
  return (
    <div className="confirmation-backdrop" role="presentation">
      <section className="confirmation-dialog" role="dialog" aria-modal="true" aria-labelledby="create-branch-title">
        <form
          onSubmit={(event) => {
            event.preventDefault()
            if (value.trim()) onCreate()
          }}
        >
          <div>
            <h2 id="create-branch-title">Create a branch</h2>
            <p>Your new branch will be based on <strong>{baseBranch ?? 'HEAD'}</strong>.</p>
            <input
              className="text-prompt-input"
              autoFocus
              value={value}
              placeholder="new-branch-name"
              onChange={(event) => onChange(event.target.value)}
              onFocus={(event) => event.target.select()}
            />
          </div>
          <div className="confirmation-actions">
            <button type="button" className="secondary" onClick={onCancel}>
              Cancel
            </button>
            <button type="submit" disabled={busy || !value.trim()}>
              Create branch
            </button>
          </div>
        </form>
      </section>
    </div>
  )
}

/** Modal confirmation dialog (with optional danger styling). */
export function ConfirmationDialog({
  request,
  onAnswer
}: {
  request: ConfirmationRequest
  onAnswer: (confirmed: boolean) => void
}) {
  return (
    <div className="confirmation-backdrop" role="presentation">
      <section
        className={`confirmation-dialog ${request.variant === 'danger' ? 'danger' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`confirmation-title-${request.id}`}
      >
        <div>
          <h2 id={`confirmation-title-${request.id}`}>{request.title}</h2>
          <p>{request.message}</p>
        </div>
        <div className="confirmation-actions">
          <button type="button" className="secondary" onClick={() => onAnswer(false)}>
            {request.cancelLabel}
          </button>
          <button
            type="button"
            className={request.variant === 'danger' ? 'danger-button' : ''}
            onClick={() => onAnswer(true)}
          >
            {request.confirmLabel}
          </button>
        </div>
      </section>
    </div>
  )
}

/** Modal single-line text prompt dialog. */
export function TextPromptDialog({
  request,
  value,
  onChange,
  onAnswer
}: {
  request: TextPromptRequest
  value: string
  onChange: (value: string) => void
  onAnswer: (submitted: boolean) => void
}) {
  return (
    <div className="confirmation-backdrop" role="presentation">
      <section
        className="confirmation-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`confirmation-title-${request.id}`}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault()
            onAnswer(true)
          }}
        >
          <div>
            <h2 id={`confirmation-title-${request.id}`}>{request.title}</h2>
            <p>{request.message}</p>
            <input
              className="text-prompt-input"
              autoFocus
              value={value}
              placeholder={request.placeholder}
              onChange={(event) => onChange(event.target.value)}
              onFocus={(event) => event.target.select()}
            />
          </div>
          <div className="confirmation-actions">
            <button type="button" className="secondary" onClick={() => onAnswer(false)}>
              {request.cancelLabel}
            </button>
            <button type="submit" disabled={!value.trim()}>
              {request.confirmLabel}
            </button>
          </div>
        </form>
      </section>
    </div>
  )
}
