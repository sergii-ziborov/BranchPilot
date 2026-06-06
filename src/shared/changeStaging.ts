import type { FileChange, RepositoryCounts } from './branchPilot.js'

export type ChangeStageToggleAction = 'stage' | 'unstage' | 'none'
export type BulkStageToggleAction = 'stage_all' | 'unstage_all' | 'none'
export type ChangeDiffMode = 'unstaged' | 'staged'

export interface ChangeStageToggleState {
  checked: boolean
  mixed: boolean
  disabled: boolean
  action: ChangeStageToggleAction
  label: string
}

export interface BulkStageToggleState {
  checked: boolean
  mixed: boolean
  disabled: boolean
  action: BulkStageToggleAction
  label: string
  summary: string
}

export function getChangeStageToggleState(change: FileChange): ChangeStageToggleState {
  const mixed = change.staged && (change.unstaged || change.untracked)
  const checked = change.staged && !mixed
  const action = getChangeStageToggleAction(change)

  return {
    checked,
    mixed,
    disabled: action === 'none',
    action,
    label: `${action === 'unstage' ? 'Unstage' : 'Stage'} ${change.path}`
  }
}

export function getChangeStageToggleAction(change: FileChange): ChangeStageToggleAction {
  if (change.conflicted) return 'none'
  if (change.staged && !change.unstaged && !change.untracked) return 'unstage'
  if (change.unstaged || change.untracked) return 'stage'
  return 'none'
}

export function getBulkStageToggleState(counts: RepositoryCounts | null | undefined): BulkStageToggleState {
  const staged = counts?.staged ?? 0
  const unstaged = counts?.unstaged ?? 0
  const untracked = counts?.untracked ?? 0
  const conflicted = counts?.conflicted ?? 0
  const stageable = unstaged + untracked
  const changed = counts?.changed ?? 0
  const blockedByConflicts = conflicted > 0
  const checked = staged > 0 && stageable === 0 && !blockedByConflicts
  const mixed = staged > 0 && stageable > 0 && !blockedByConflicts
  const action = getBulkStageToggleAction(counts)

  return {
    checked,
    mixed,
    disabled: action === 'none',
    action,
    label: bulkStageLabel(action),
    summary: changed === 0
      ? 'No changes'
      : `${staged} staged / ${stageable} unstaged${conflicted ? ` / ${conflicted} conflicted` : ''}`
  }
}

export function getBulkStageToggleAction(counts: RepositoryCounts | null | undefined): BulkStageToggleAction {
  if (!counts || counts.changed === 0 || counts.conflicted > 0) return 'none'

  const stageable = counts.unstaged + counts.untracked

  if (counts.staged > 0 && stageable === 0) return 'unstage_all'
  if (stageable > 0) return 'stage_all'
  return 'none'
}

export function getAvailableChangeDiffMode(change: FileChange, preferredMode: ChangeDiffMode): ChangeDiffMode {
  if (hasChangeDiffMode(change, preferredMode)) return preferredMode
  if (hasChangeDiffMode(change, 'unstaged')) return 'unstaged'
  return 'staged'
}

export function getDefaultChangeDiffMode(change: FileChange): ChangeDiffMode {
  return getAvailableChangeDiffMode(change, 'unstaged')
}

function hasChangeDiffMode(change: FileChange, mode: ChangeDiffMode): boolean {
  return mode === 'staged'
    ? change.staged
    : change.unstaged || change.untracked
}

function bulkStageLabel(action: BulkStageToggleAction): string {
  if (action === 'unstage_all') return 'Unstage all files'
  if (action === 'stage_all') return 'Stage all files'
  return 'No bulk staging action available'
}
