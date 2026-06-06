import { describe, expect, it } from 'vitest'
import { getBranchComposerSummary, getBranchDraftActionState, getCreateBranchActionState } from '../src/shared/branchPreconditions'
import type { InProgressOperation, RepositorySnapshot } from '../src/shared/branchPilot'

describe('branch preconditions', () => {
  it('requires a repository and assistant permission before generating a branch draft', () => {
    expect(getBranchDraftActionState({
      snapshot: null,
      intent: '',
      assistantAllowed: false
    })).toEqual({
      enabled: false,
      reasons: ['Open a repository.', 'Enable branch draft generation in Assistant Policy.']
    })
  })

  it('requires branch draft context from intent or local changes', () => {
    expect(getBranchDraftActionState({
      snapshot: makeSnapshot({ changed: 0 }),
      intent: '',
      assistantAllowed: true
    })).toEqual({
      enabled: false,
      reasons: ['Add an intent or create local changes for assistant context.']
    })
  })

  it('allows branch draft generation with only an intent', () => {
    expect(getBranchDraftActionState({
      snapshot: makeSnapshot({ changed: 0 }),
      intent: 'Build policy UI',
      assistantAllowed: true
    })).toEqual({
      enabled: true,
      reasons: []
    })
  })

  it('requires a valid branch name before creating a branch', () => {
    expect(getCreateBranchActionState({
      snapshot: makeSnapshot(),
      branchName: 'bad branch name'
    })).toEqual({
      enabled: false,
      reasons: ['Use a safe Git branch name without spaces or special ref characters.']
    })
  })

  it('blocks duplicate branch names', () => {
    expect(getCreateBranchActionState({
      snapshot: makeSnapshot({ branches: ['main', 'feature/work'] }),
      branchName: 'feature/work'
    })).toEqual({
      enabled: false,
      reasons: ['Choose a branch name that does not already exist.']
    })
  })

  it('blocks branch creation during merge workflow', () => {
    expect(getCreateBranchActionState({
      snapshot: makeSnapshot({ mergeOperation: 'rebase' }),
      branchName: 'feature/policy-ui'
    })).toEqual({
      enabled: false,
      reasons: ['Finish or abort the rebase before creating a branch.']
    })
  })

  it('allows branch creation from detached HEAD when the name is safe and unique', () => {
    expect(getCreateBranchActionState({
      snapshot: makeSnapshot({ isDetached: true }),
      branchName: 'feature/recover-work'
    })).toEqual({
      enabled: true,
      reasons: []
    })
  })

  it('summarizes a ready branch composer draft', () => {
    expect(getBranchComposerSummary({
      snapshot: makeSnapshot({ changed: 2 }),
      intent: '',
      assistantAllowed: true,
      branchName: 'feature/policy-ui',
      description: 'Adds policy controls.'
    })).toEqual([
      { label: 'Context', value: '2 local changes available', tone: 'ready' },
      { label: 'Name', value: 'feature/policy-ui', tone: 'ready' },
      { label: 'Description', value: 'Will be saved locally', tone: 'ready' },
      { label: 'AI policy', value: 'Draft generation allowed', tone: 'ready' }
    ])
  })

  it('summarizes blocked branch composer inputs', () => {
    expect(getBranchComposerSummary({
      snapshot: makeSnapshot({ changed: 0, branches: ['main', 'feature/existing'] }),
      intent: '',
      assistantAllowed: false,
      branchName: 'feature/existing',
      description: ''
    })).toEqual([
      { label: 'Context', value: 'Add intent or local changes', tone: 'blocked' },
      { label: 'Name', value: 'Already exists', tone: 'blocked' },
      { label: 'Description', value: 'Optional local metadata', tone: 'neutral' },
      { label: 'AI policy', value: 'Draft generation blocked', tone: 'blocked' }
    ])
  })

  it('summarizes missing repository and unsafe branch names', () => {
    expect(getBranchComposerSummary({
      snapshot: null,
      intent: 'Prepare work',
      assistantAllowed: true,
      branchName: 'bad branch',
      description: ''
    })).toEqual([
      { label: 'Context', value: 'Open a repository', tone: 'blocked' },
      { label: 'Name', value: 'Open a repository', tone: 'blocked' },
      { label: 'Description', value: 'Optional local metadata', tone: 'neutral' },
      { label: 'AI policy', value: 'Draft generation allowed', tone: 'ready' }
    ])

    expect(getBranchComposerSummary({
      snapshot: makeSnapshot(),
      intent: 'Prepare work',
      assistantAllowed: true,
      branchName: 'bad branch',
      description: ''
    })[1]).toEqual({ label: 'Name', value: 'Unsafe Git ref', tone: 'blocked' })
  })
})

function makeSnapshot(overrides: {
  changed?: number
  branches?: string[]
  mergeOperation?: InProgressOperation
  isDetached?: boolean
} = {}): RepositorySnapshot {
  const changed = overrides.changed ?? 1
  const branchNames = overrides.branches ?? ['main']

  return {
    summary: {
      rootPath: '/repo',
      name: 'repo',
      currentBranch: overrides.isDetached ? 'HEAD' : 'main',
      ahead: 0,
      behind: 0,
      isDetached: overrides.isDetached ?? false
    },
    status: {
      summary: {
        rootPath: '/repo',
        name: 'repo',
        currentBranch: overrides.isDetached ? 'HEAD' : 'main',
        ahead: 0,
        behind: 0,
        isDetached: overrides.isDetached ?? false
      },
      changes: [],
      counts: {
        changed,
        staged: changed,
        unstaged: 0,
        untracked: 0,
        conflicted: 0
      },
      merge: {
        operation: overrides.mergeOperation ?? 'none',
        files: []
      }
    },
    branches: branchNames.map((name) => ({
      name,
      current: name === 'main'
    })),
    tags: [],
    worktrees: [],
    submodules: [],
    lfs: {
      installed: false,
      trackedPatterns: [],
      files: [],
      fileCount: 0,
      message: 'Git LFS is not installed.'
    },
    recentRepositories: []
  }
}
