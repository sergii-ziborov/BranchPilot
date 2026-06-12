import type { GitLfsFileStatus, SubmoduleSummary, WorktreeSummary } from '../shared/branchPilot'

/** Compact descriptor for a linked worktree (state flags + short HEAD). */
export function worktreeSummaryLabel(worktree: WorktreeSummary): string {
  const parts = [
    worktree.current ? 'current checkout' : undefined,
    worktree.detached ? 'detached' : undefined,
    worktree.bare ? 'bare' : undefined,
    worktree.locked ? 'locked' : undefined,
    worktree.prunable ? 'prunable' : undefined,
    worktree.head ? worktree.head.slice(0, 12) : undefined
  ].filter((value): value is string => Boolean(value))

  return parts.length > 0 ? parts.join(' · ') : 'linked worktree'
}

/** Compact descriptor for a submodule (status + short HEAD + description). */
export function submoduleStatusLabel(submodule: SubmoduleSummary): string {
  const status = submodule.status === 'initialized'
    ? 'initialized'
    : submodule.status === 'uninitialized'
      ? 'not initialized'
      : submodule.status
  const parts = [
    status,
    submodule.head ? submodule.head.slice(0, 12) : undefined,
    submodule.description
  ].filter((value): value is string => Boolean(value))

  return parts.join(' · ')
}

/** Label for a Git LFS file's storage status, with an optional short OID. */
export function gitLfsFileLabel(status: GitLfsFileStatus, oid?: string): string {
  const label = status === 'present'
    ? 'object present'
    : status === 'pointer'
      ? 'pointer only'
      : 'unknown'

  return oid ? `${label} · ${oid.slice(0, 12)}` : label
}
