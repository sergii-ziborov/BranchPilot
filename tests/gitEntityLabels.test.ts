import { describe, expect, it } from 'vitest'
import { gitLfsFileLabel, submoduleStatusLabel, worktreeSummaryLabel } from '../src/lib/gitEntityLabels'
import type { SubmoduleSummary, WorktreeSummary } from '../src/shared/branchPilot'

function makeWorktree(overrides: Partial<WorktreeSummary> = {}): WorktreeSummary {
  return {
    path: '/repo/wt',
    detached: false,
    bare: false,
    locked: false,
    prunable: false,
    current: false,
    ...overrides
  }
}

function makeSubmodule(overrides: Partial<SubmoduleSummary> = {}): SubmoduleSummary {
  return {
    path: 'libs/dep',
    absolutePath: '/repo/libs/dep',
    status: 'initialized',
    ...overrides
  }
}

describe('worktreeSummaryLabel', () => {
  it('joins active flags and truncates HEAD to 12 chars', () => {
    expect(worktreeSummaryLabel(makeWorktree({ current: true, locked: true, head: '0123456789abcdef' })))
      .toBe('current checkout · locked · 0123456789ab')
  })

  it('falls back to a generic label when nothing notable is set', () => {
    expect(worktreeSummaryLabel(makeWorktree())).toBe('linked worktree')
  })
})

describe('submoduleStatusLabel', () => {
  it('humanises the uninitialized status', () => {
    expect(submoduleStatusLabel(makeSubmodule({ status: 'uninitialized' }))).toBe('not initialized')
  })

  it('combines status, short HEAD and description', () => {
    expect(submoduleStatusLabel(makeSubmodule({ status: 'initialized', head: 'abcdef0123456789', description: 'dep lib' })))
      .toBe('initialized · abcdef012345 · dep lib')
  })

  it('passes through other statuses verbatim', () => {
    expect(submoduleStatusLabel(makeSubmodule({ status: 'modified' }))).toBe('modified')
  })
})

describe('gitLfsFileLabel', () => {
  it('labels each status', () => {
    expect(gitLfsFileLabel('present')).toBe('object present')
    expect(gitLfsFileLabel('pointer')).toBe('pointer only')
    expect(gitLfsFileLabel('unknown')).toBe('unknown')
  })

  it('appends a short OID when provided', () => {
    expect(gitLfsFileLabel('present', '0123456789abcdef')).toBe('object present · 0123456789ab')
  })
})
