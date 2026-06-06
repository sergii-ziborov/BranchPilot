import type { FileChange } from './branchPilot.js'

export type ChangeStageToggleAction = 'stage' | 'unstage' | 'none'

export interface ChangeStageToggleState {
  checked: boolean
  mixed: boolean
  disabled: boolean
  action: ChangeStageToggleAction
  label: string
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
