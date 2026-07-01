import type { ConfirmationRequest } from '../../../../lib/prompts'

/** Modal confirmation dialog with optional danger styling. */
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
