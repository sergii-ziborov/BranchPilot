import { describe, expect, it } from 'vitest'
import { getCreatePullRequestState, getPullRequestBrowseState } from '../src/shared/providerPreconditions'
import type { GitHubCliStatus, RepositorySnapshot } from '../src/shared/branchPilot'

describe('provider preconditions', () => {
  it('allows pull request creation through GitHub Desktop credentials', () => {
    expect(getCreatePullRequestState({
      snapshot: makeSnapshot(),
      githubStatus: makeGitHubStatus({ authProvider: 'git-credential' }),
      title: 'Add provider fallback',
      currentPullRequestExists: false
    })).toEqual({
      enabled: true,
      reasons: []
    })
  })

  it('explains every blocker for pull request creation', () => {
    expect(getCreatePullRequestState({
      snapshot: makeSnapshot({
        isDetached: true,
        upstream: undefined
      }),
      githubStatus: makeGitHubStatus({ authenticated: false, authProvider: 'none' }),
      title: ' ',
      currentPullRequestExists: true
    })).toEqual({
      enabled: false,
      reasons: [
        'Switch from detached HEAD to a branch.',
        'Publish the current branch.',
        'Add a pull request title.',
        'Authenticate GitHub with gh or GitHub Desktop.',
        'Current branch already has a pull request.'
      ]
    })
  })

  it('requires gh authentication for browsing pull requests', () => {
    expect(getPullRequestBrowseState(
      makeSnapshot(),
      makeGitHubStatus({ authProvider: 'git-credential' })
    )).toEqual({
      enabled: false,
      reasons: ['Run gh auth login to browse pull requests, checks, diffs, and checkout.']
    })

    expect(getPullRequestBrowseState(
      makeSnapshot(),
      makeGitHubStatus({ authProvider: 'gh' })
    )).toEqual({
      enabled: true,
      reasons: []
    })
  })

  it('blocks GitHub pull request actions for non-GitHub remotes', () => {
    expect(getCreatePullRequestState({
      snapshot: makeSnapshot({
        remoteUrl: 'https://gitlab.com/example/repo.git'
      }),
      githubStatus: makeGitHubStatus({ authProvider: 'gh' }),
      title: 'Create merge request',
      currentPullRequestExists: false
    })).toEqual({
      enabled: false,
      reasons: ['Current remote is GitLab; GitHub pull requests require a GitHub remote.']
    })

    expect(getPullRequestBrowseState(
      makeSnapshot({
        remoteUrl: 'git@bitbucket.org:workspace/repo.git'
      }),
      makeGitHubStatus({ authProvider: 'gh' })
    )).toEqual({
      enabled: false,
      reasons: ['Current remote is Bitbucket; GitHub pull requests require a GitHub remote.']
    })

    expect(getCreatePullRequestState({
      snapshot: makeSnapshot({
        remoteName: undefined,
        remoteUrl: undefined,
        upstream: undefined
      }),
      githubStatus: makeGitHubStatus({ authProvider: 'gh' }),
      title: 'Create pull request',
      currentPullRequestExists: false
    })).toMatchObject({
      enabled: false,
      reasons: expect.arrayContaining([
        'Publish the current branch.',
        'Add a GitHub remote.'
      ])
    })
  })
})

function makeSnapshot(overrides: Partial<RepositorySnapshot['summary']> = {}): RepositorySnapshot {
  return {
    summary: {
      rootPath: '/repo',
      name: 'repo',
      currentBranch: 'feature/work',
      ahead: 0,
      behind: 0,
      isDetached: false,
      upstream: 'origin/feature/work',
      remoteName: 'origin',
      remoteUrl: 'https://github.com/example/repo.git',
      ...overrides
    },
    status: {
      summary: {
        rootPath: '/repo',
        name: 'repo',
        currentBranch: 'feature/work',
        ahead: 0,
        behind: 0,
        isDetached: false,
        ...overrides
      },
      changes: [],
      counts: {
        changed: 0,
        staged: 0,
        unstaged: 0,
        untracked: 0,
        conflicted: 0
      },
      merge: {
        operation: 'none',
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

function makeGitHubStatus(overrides: Partial<GitHubCliStatus> = {}): GitHubCliStatus {
  const authProvider = overrides.authProvider ?? 'gh'
  const authenticated = overrides.authenticated ?? authProvider !== 'none'

  return {
    state: authenticated ? 'authenticated' : 'unauthenticated',
    installed: true,
    authenticated,
    ghAuthenticated: authProvider === 'gh',
    gitCredentialAuthenticated: authProvider === 'git-credential',
    authProvider,
    username: authenticated ? 'branchpilot-user' : undefined,
    message: authenticated ? 'Authenticated.' : 'Authentication required.',
    ...overrides
  }
}
