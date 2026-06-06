import { describe, expect, it } from 'vitest'
import {
  getAvailableChangeDiffMode,
  getBulkStageToggleAction,
  getBulkStageToggleState,
  getChangeStageToggleAction,
  getChangeStageToggleState,
  getDefaultChangeDiffMode
} from '../src/shared/changeStaging'
import type { FileChange, FileChangeStatus, RepositoryCounts } from '../src/shared/branchPilot'

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

  it('stages all when unstaged or untracked files exist', () => {
    expect(getBulkStageToggleState(makeCounts({ changed: 3, staged: 0, unstaged: 2, untracked: 1 }))).toEqual({
      checked: false,
      mixed: false,
      disabled: false,
      action: 'stage_all',
      label: 'Stage all files',
      summary: '0 staged / 3 unstaged'
    })
  })

  it('shows mixed bulk state when staged and unstaged files coexist', () => {
    expect(getBulkStageToggleState(makeCounts({ changed: 3, staged: 1, unstaged: 2 }))).toEqual({
      checked: false,
      mixed: true,
      disabled: false,
      action: 'stage_all',
      label: 'Stage all files',
      summary: '1 staged / 2 unstaged'
    })
  })

  it('unstages all when every changed file is staged', () => {
    expect(getBulkStageToggleAction(makeCounts({ changed: 2, staged: 2 }))).toBe('unstage_all')
    expect(getBulkStageToggleState(makeCounts({ changed: 2, staged: 2 }))).toMatchObject({
      checked: true,
      mixed: false,
      action: 'unstage_all',
      label: 'Unstage all files'
    })
  })

  it('disables bulk staging for clean or conflicted states', () => {
    expect(getBulkStageToggleState(makeCounts())).toMatchObject({
      disabled: true,
      action: 'none',
      summary: 'No changes'
    })
    expect(getBulkStageToggleState(makeCounts({ changed: 2, unstaged: 1, conflicted: 1 }))).toEqual({
      checked: false,
      mixed: false,
      disabled: true,
      action: 'none',
      label: 'No bulk staging action available',
      summary: '0 staged / 1 unstaged / 1 conflicted'
    })
  })

  it('keeps the diff on the available side after staging changes', () => {
    expect(getAvailableChangeDiffMode(makeChange({ staged: true }), 'unstaged')).toBe('staged')
    expect(getDefaultChangeDiffMode(makeChange({ staged: true }))).toBe('staged')
  })

  it('keeps the diff on the available side after unstaging changes', () => {
    expect(getAvailableChangeDiffMode(makeChange({ unstaged: true }), 'staged')).toBe('unstaged')
    expect(getDefaultChangeDiffMode(makeChange({ unstaged: true }))).toBe('unstaged')
  })

  it('prefers unstaged diff for mixed files because the next checkbox action stages remaining changes', () => {
    const change = makeChange({ staged: true, unstaged: true })

    expect(getAvailableChangeDiffMode(change, 'staged')).toBe('staged')
    expect(getDefaultChangeDiffMode(change)).toBe('unstaged')
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

function makeCounts(overrides: Partial<RepositoryCounts> = {}): RepositoryCounts {
  return {
    changed: 0,
    staged: 0,
    unstaged: 0,
    untracked: 0,
    conflicted: 0,
    ...overrides
  }
}
