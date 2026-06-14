type StatTone = 'neutral' | 'info' | 'warn' | 'danger' | 'ok'

/** Small labelled statistic tile (label above a bold value). */
export function Stat({
  label,
  value,
  tone = 'neutral',
  hint
}: {
  label: string
  value: string | number
  tone?: StatTone
  hint?: string
}) {
  return (
    <div className={`stat-tile tone-${tone}`} title={hint}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

/** Labelled key/value row used in info panels. */
export function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="info-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}
