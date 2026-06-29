import type { ReactNode } from 'react'

/** Semantic tints that map to BranchPilot's shipped pill classes. */
export type StatusPillTone = 'success' | 'warn' | 'danger' | 'info' | 'neutral' | 'planned'

/**
 * Per-tone class pairs. Each entry is a real, app-styled pill family so the rendered
 * border/foreground/background share one semantic tint without inventing new CSS.
 */
const TONE_CLASS: Record<StatusPillTone, string> = {
  success: 'check-bucket bucket-pass',
  warn: 'check-bucket bucket-pending',
  danger: 'check-bucket bucket-fail',
  info: 'github-status status-available',
  neutral: 'check-bucket bucket-other',
  planned: 'github-status status-planned'
}

/** Small bordered text pill whose border, text, and background share one semantic tint. */
export function StatusPill({
  label,
  tone = 'neutral',
  icon
}: {
  /** Text shown inside the pill (e.g. a working-tree state or check result). */
  label: string
  /** Semantic tint controlling the pill colors; defaults to `neutral`. */
  tone?: StatusPillTone
  /** Optional leading icon node, typically a small lucide-react glyph. */
  icon?: ReactNode
}) {
  return (
    <span className={`status-pill ${TONE_CLASS[tone]}`} style={icon ? { gap: 6 } : undefined}>
      {icon}
      {label}
    </span>
  )
}
