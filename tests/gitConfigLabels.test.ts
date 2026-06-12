import { describe, expect, it } from 'vitest'
import { gitDefaultBranchLabel, gitSigningLabel } from '../src/lib/gitConfigLabels'
import type { GitConfigSnapshot } from '../src/shared/branchPilot'

function makeConfig(overrides: Partial<GitConfigSnapshot> = {}): GitConfigSnapshot {
  return {
    defaultBranchSource: 'remote',
    commitSigningSource: 'unset',
    remotes: [],
    ...overrides
  }
}

describe('gitDefaultBranchLabel', () => {
  it('returns Unset when no default branch is known', () => {
    expect(gitDefaultBranchLabel(null)).toBe('Unset')
    expect(gitDefaultBranchLabel(makeConfig({ defaultBranch: undefined }))).toBe('Unset')
  })

  it('annotates a remote-sourced default branch', () => {
    expect(gitDefaultBranchLabel(makeConfig({ defaultBranch: 'main', defaultBranchSource: 'remote', defaultBranchRemote: 'origin' })))
      .toBe('main (origin/HEAD)')
  })

  it('falls back to "remote" when the remote name is missing', () => {
    expect(gitDefaultBranchLabel(makeConfig({ defaultBranch: 'main', defaultBranchSource: 'remote' })))
      .toBe('main (remote/HEAD)')
  })

  it('annotates local and current fallbacks', () => {
    expect(gitDefaultBranchLabel(makeConfig({ defaultBranch: 'dev', defaultBranchSource: 'local' })))
      .toBe('dev (local branch fallback)')
    expect(gitDefaultBranchLabel(makeConfig({ defaultBranch: 'dev', defaultBranchSource: 'current' })))
      .toBe('dev (current branch fallback)')
  })
})

describe('gitSigningLabel', () => {
  it('returns Unset for null config or unset source', () => {
    expect(gitSigningLabel(null)).toBe('Unset')
    expect(gitSigningLabel(makeConfig({ commitSigningSource: 'unset' }))).toBe('Unset')
  })

  it('describes enabled/disabled state and source', () => {
    expect(gitSigningLabel(makeConfig({ commitSigningSource: 'local', commitSigningEnabled: true })))
      .toBe('Enabled (repository local, read-only)')
    expect(gitSigningLabel(makeConfig({ commitSigningSource: 'global', commitSigningEnabled: false })))
      .toBe('Disabled (global, read-only)')
  })
})
