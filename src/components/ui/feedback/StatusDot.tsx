/** Availability/health state a dot can represent, ordered from healthy to broken. */
export type StatusDotState = 'ready' | 'detected' | 'limited' | 'unavailable' | 'missing'

/**
 * Which shipped dot family to render. `model` mirrors ReviewView's assistant
 * model dots (7px); `choice` mirrors ConfigView's assistant choice dots (8px).
 */
export type StatusDotVariant = 'model' | 'choice'

const DOT_CLASS: Record<StatusDotVariant, string> = {
  model: 'assistant-model-dot',
  choice: 'assistant-choice-dot'
}

/** Small colored status circle, optionally followed by an inline text label. */
export function StatusDot({
  state,
  label,
  variant = 'model'
}: {
  /** Health/availability state controlling the dot color. */
  state: StatusDotState
  /** Optional text rendered inline after the dot. */
  label?: string
  /** Dot family to reuse; defaults to `model`. */
  variant?: StatusDotVariant
}) {
  const dot = <span className={`${DOT_CLASS[variant]} state-${state}`} />
  if (label == null) return dot
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      {dot}
      <span>{label}</span>
    </span>
  )
}
