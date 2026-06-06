import { describe, expect, it } from 'vitest'
import { getChangeStageToggleAction, getChangeStageToggleState } from '../src/shared/changeStaging'
import type { FileChange, FileChangeStatus } from '../src/shared/branchPilot'

describe('change staging toggle', () => {
  it('stages unstaged and untracked files', () => {
    expect(getChangeStageToggleAction(makeChange({ unstaged: true }))).toBe('stage')
    expect(getChangeStageToggleAction(makeChange({ untracked: true, status: 'untracked' }))).toBe('stage')
  })

  it('unstages fully staged files', () => {
    expect(getChangeStageToggleState(makeChange({ staged: true }))).toEqual({
      checked: true,
      mixed: false,
      disabled: false,
      action: 'unstage',
      label: 'Unstage src/app.ts'
    })
  })

  it('shows mixed staged files and stages remaining unstaged content on toggle', () => {
    expect(getChangeStageToggleState(makeChange({ staged: true, unstaged: true }))).toEqual({
      checked: false,
      mixed: true,
      disabled: false,
      action: 'stage',
      label: 'Stage src/app.ts'
    })
  })

  it('disables conflicted files', () => {
    expect(getChangeStageToggleState(makeChange({ conflicted: true, unstaged: true, status: 'conflicted' }))).toEqual({
      checked: false,
      mixed: false,
      disabled: true,
      action: 'none',
      label: 'Stage src/app.ts'
    })
  })
})

function makeChange(overrides: Partial<FileChange> = {}): FileChange {
  return {
    path: 'src/app.ts',
    status: overrides.status ?? statusFromFlags(overrides),
    staged: false,
    unstaged: false,
    untracked: false,
    conflicted: false,
    ...overrides
  }
}

function statusFromFlags(change: Partial<FileChange>): FileChangeStatus {
  if (change.untracked) return 'untracked'
  if (change.conflicted) return 'conflicted'
  return 'modified'
}
