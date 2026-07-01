type SignalStatusTone = 'info' | 'warning' | 'busy' | 'error'

export function SignalStatus({
  label,
  detail,
  tone = 'busy',
  className = '',
  compact = false
}: {
  label: string
  detail?: string | null
  tone?: SignalStatusTone
  className?: string
  compact?: boolean
}) {
  const classes = [
    'signal-status',
    `signal-status-${tone}`,
    compact ? 'signal-status-compact' : '',
    className
  ].filter(Boolean).join(' ')

  return (
    <div className={classes} role="status" aria-live="polite">
      <div className="signal-status-copy">
        <strong>{label}</strong>
        {detail && <span>{detail}</span>}
      </div>
    </div>
  )
}
