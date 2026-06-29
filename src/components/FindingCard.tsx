type FindingSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info'

/** A severity-tinted review finding card: tag+title heading, file:line code chip, details, and optional recommendation block. */
export function FindingCard(props: {
  severity: FindingSeverity
  title: string
  location?: string
  details: string
  recommendation?: string
  compact?: boolean
}) {
  const { severity, title, location, details, recommendation, compact = false } = props

  return (
    <article className={`finding-card${compact ? ' compact' : ''} severity-${severity}`}>
      <div className="finding-heading">
        <span>{severity}</span>
        <strong>{title}</strong>
      </div>
      {location && <code>{location}</code>}
      <p>{details}</p>
      {recommendation && <p className="finding-recommendation">{recommendation}</p>}
    </article>
  )
}
