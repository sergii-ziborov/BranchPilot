import type { FileChange } from '../shared/branchPilot'

/**
 * Human-readable summary of which stage buckets a file change belongs to,
 * e.g. "staged / unstaged". Falls back to the raw status when no bucket applies.
 */
export function changeLabel(change: FileChange): string {
  const parts: string[] = []
  if (change.staged) parts.push('staged')
  if (change.unstaged) parts.push('unstaged')
  if (change.untracked) parts.push('untracked')
  if (change.conflicted) parts.push('conflict')
  return parts.join(' / ') || change.status
}

/** Single-letter token for a porcelain file status (R/C/D/A/M). */
export function fileStatusToken(status: string): string {
  if (status === 'renamed') return 'R'
  if (status === 'copied') return 'C'
  if (status === 'deleted') return 'D'
  if (status === 'added') return 'A'
  return 'M'
}

/**
 * Status token for a change, prioritising conflict (!) and untracked (?)
 * markers over the plain file-status letter.
 */
export function statusToken(change: FileChange): string {
  if (change.conflicted) return '!'
  if (change.untracked) return '?'
  return fileStatusToken(change.status)
}
