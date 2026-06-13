/**
 * Turn a success/action label into an in-progress label, e.g.
 * "Pushed changes" -> "Pushed changes...". Empty input yields "Working...".
 */
export function progressLabelFromSuccess(label: string): string {
  const trimmed = label.trim()

  if (!trimmed) return 'Working...'
  if (trimmed.endsWith('...')) return trimmed

  return `${trimmed.replace(/[.!?]+$/, '')}...`
}
