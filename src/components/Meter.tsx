import type { CSSProperties } from 'react'

/** Track+fill progress meter; determinate width or an indeterminate sweep, in accent/info/warn/danger tones. */
export function Meter(props: {
  value: number
  max?: number
  minPercent?: number
  indeterminate?: boolean
  tone?: 'accent' | 'info' | 'warn' | 'danger'
  className?: string
  label?: string
}) {
  const { value, max = 100, minPercent = 0, indeterminate = false, tone = 'accent', className, label } = props

  if (indeterminate) {
    return (
      <div
        className={['review-progress-track', className].filter(Boolean).join(' ')}
        role="progressbar"
        aria-label={label}
        aria-hidden={label ? undefined : true}
        style={toneVar(tone)}
      >
        <span />
      </div>
    )
  }

  const safeMax = max > 0 ? max : 1
  const ratio = Math.min(1, Math.max(0, value / safeMax))
  const raw = Math.round(ratio * 100)
  const percent = value > 0 ? Math.max(minPercent, raw) : 0

  return (
    <div
      className={['contributor-meter', className].filter(Boolean).join(' ')}
      role="progressbar"
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={safeMax}
    >
      <div className="contributor-bar" style={{ width: `${percent}%`, ...toneFill(tone) }} />
    </div>
  )
}

/** Tone-to-fill mapping for the determinate bar; accent keeps the stylesheet's default gradient. */
function toneFill(tone: 'accent' | 'info' | 'warn' | 'danger'): { background?: string } {
  switch (tone) {
    case 'info':
      return { background: 'linear-gradient(90deg, var(--info, #38bdf8), var(--accent, #6366f1))' }
    case 'warn':
      return { background: 'linear-gradient(90deg, var(--warn, #f59e0b), #fb923c)' }
    case 'danger':
      return { background: 'linear-gradient(90deg, var(--danger, #ef4444), #f87171)' }
    default:
      return {}
  }
}

/** Drives the indeterminate sweep accent color via the --accent custom property. */
function toneVar(tone: 'accent' | 'info' | 'warn' | 'danger'): CSSProperties {
  switch (tone) {
    case 'info':
      return { ['--accent' as string]: 'var(--info, #38bdf8)' } as CSSProperties
    case 'warn':
      return { ['--accent' as string]: 'var(--warn, #f59e0b)' } as CSSProperties
    case 'danger':
      return { ['--accent' as string]: 'var(--danger, #ef4444)' } as CSSProperties
    default:
      return {}
  }
}
