import type { TextPromptRequest } from '../../../../lib/prompts'

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
