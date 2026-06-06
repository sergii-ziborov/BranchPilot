import { describe, expect, it } from 'vitest'
import { getAmendCommitActionState, getCommitActionState, getCommitAndPushActionState } from '../src/shared/commitPreconditions'
import type { InProgressOperation, RepositorySnapshot } from '../src/shared/branchPilot'

describe('commit preconditions', () => {
  it('explains blockers when no repository is open', () => {
    expect(getCommitActionState({ snapshot: null, title: '' })).toEqual({
      enabled: false,
      reasons: ['Open a repository.', 'Add a commit title.']
    })
  })

  it('requires staged changes and a title for commit', () => {
    expect(getCommitActionState({ snapshot: makeSnapshot({ staged: 0 }), title: ' ' })).toEqual({
      enabled: false,
      reasons: ['Stage at least one change.', 'Add a commit title.']
    })
  })

  it('allows commit when staged changes and title are ready', () => {
    expect(getCommitActionState({ snapshot: makeSnapshot(), title: 'Update branch flow' })).toEqual({
      enabled: true,
      reasons: []
    })
  })

  it('blocks regular commits while merge workflow is active', () => {
    expect(getCommitActionState({
      snapshot: makeSnapshot({ mergeOperation: 'merge' }),
      title: 'Resolve merge'
    })).toEqual({
      enabled: false,
      reasons: ['Finish or abort the merge in Merge view.']
    })
  })

  it('blocks regular commits when conflicts are detected outside an operation', () => {
    expect(getCommitActionState({
      snapshot: makeSnapshot({ conflicted: 2 }),
      title: 'Fix conflicts'
    })).toEqual({
      enabled: false,
      reasons: ['Resolve conflicted files before committing.']
    })
  })

  it('requires a branch upstream for commit and push', () => {
    expect(getCommitAndPushActionState({
      snapshot: makeSnapshot({ upstream: undefined }),
      title: 'Add provider UI'
    })).toEqual({
      enabled: false,
      reasons: ['Publish the current branch.']
    })
  })

  it('requires a remote before commit and push when no upstream is possible', () => {
    expect(getCommitAndPushActionState({
      snapshot: makeSnapshot({ remoteName: undefined, upstream: undefined }),
      title: 'Add provider UI'
    })).toEqual({
      enabled: false,
      reasons: ['Add a Git remote before pushing.']
    })
  })

  it('requires a named branch for commit and push', () => {
    expect(getCommitAndPushActionState({
      snapshot: makeSnapshot({ isDetached: true }),
      title: 'Detached commit'
    })).toEqual({
      enabled: false,
      reasons: ['Switch from detached HEAD to a branch before pushing.']
    })
  })

  it('allows amend without staged changes when title and repository are ready', () => {
    expect(getAmendCommitActionState({
      snapshot: makeSnapshot({ staged: 0 }),
      title: 'Amend message only'
    })).toEqual({
      enabled: true,
      reasons: []
    })
  })

  it('blocks amend during merge workflows and when title is missing', () => {
    expect(getAmendCommitActionState({
      snapshot: makeSnapshot({ mergeOperation: 'cherry-pick' }),
      title: ' '
    })).toEqual({
      enabled: false,
      reasons: ['Finish or abort the cherry-pick in Merge view.', 'Add a commit title.']
    })
  })
})

function makeSnapshot(overrides: {
  staged?: number
  conflicted?: number
  mergeOperation?: InProgressOperation
  isDetached?: boolean
  remoteName?: string
  upstream?: string
} = {}): RepositorySnapshot {
  const staged = overrides.staged ?? 1
  const conflicted = overrides.conflicted ?? 0
  const remoteName = hasOwn(overrides, 'remoteName') ? overrides.remoteName : 'origin'
  const upstream = hasOwn(overrides, 'upstream') ? overrides.upstream : 'origin/feature/work'

  return {
    summary: {
      rootPath: '/repo',
      name: 'repo',
      currentBranch: overrides.isDetached ? 'HEAD' : 'feature/work',
      ahead: 0,
      behind: 0,
      isDetached: overrides.isDetached ?? false,
      remoteName,
      upstream
    },
    status: {
      summary: {
        rootPath: '/repo',
        name: 'repo',
        currentBranch: overrides.isDetached ? 'HEAD' : 'feature/work',
        ahead: 0,
        behind: 0,
        isDetached: overrides.isDetached ?? false,
        remoteName,
        upstream
      },
      changes: [],
      counts: {
        changed: staged + conflicted,
        staged,
        unstaged: 0,
        untracked: 0,
        conflicted
      },
      merge: {
        operation: overrides.mergeOperation ?? 'none',
        files: []
      }
    },
    branches: [],
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

function hasOwn<T extends object>(value: T, key: keyof T): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}
