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

/** Single-letter token for the file change kind (R/C/D/A/M). */
export function fileStatusToken(status: string): string {
  if (status === 'renamed') return 'R'
  if (status === 'copied') return 'C'
  if (status === 'deleted') return 'D'
  if (status === 'added' || status === 'untracked') return 'A'
  return 'M'
}

/**
 * Visual tone for the file change badge. Untracked files are still file additions;
 * staging state lives on the checkbox, so the badge does not jump from U to A.
 */
export function fileStatusTone(status: string): string {
  if (status === 'untracked') return 'added'
  return status
}

/**
 * Status token for a change, prioritising conflict (!) over the plain file-status
 * letter. Untracked files display as additions, because staging them turns the
 * same path into Git's staged added state.
 */
export function statusToken(change: FileChange): string {
  if (change.conflicted) return '!'
  return fileStatusToken(change.status)
}

export function statusTone(change: FileChange): string {
  if (change.conflicted) return 'conflicted'
  return fileStatusTone(change.status)
}
