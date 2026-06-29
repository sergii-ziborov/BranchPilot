import type {
  CoAuthor,
  GitHubAccountSummary,
  GitHubPullRequest,
  GitHubPullRequestCheck,
  GitHubPullRequestDetails,
  GitHubPullRequestDiff,
  GitHubRepositorySummary
} from '../../src/shared/branchPilot'

export function makePullRequest(overrides: Partial<GitHubPullRequest> = {}): GitHubPullRequest {
  return {
    number: 42,
    title: 'Add provider bridge',
    url: `https://github.com/example/project/pull/${overrides.number ?? 42}`,
    state: 'OPEN',
    headBranch: 'feature/test',
    baseBranch: 'main',
    draft: false,
    ...overrides
  }
}

export function makePullRequestDetails(overrides: Partial<GitHubPullRequestDetails> = {}): GitHubPullRequestDetails {
  return {
    ...makePullRequest(overrides),
    body: 'Adds provider bridge details.',
    author: {
      login: 'branchpilot-user',
      name: 'Branch Pilot',
      url: 'https://github.com/branchpilot-user'
    },
    createdAt: '2026-06-01T10:00:00Z',
    updatedAt: '2026-06-02T10:00:00Z',
    additions: 10,
    deletions: 2,
    changedFiles: 3,
    ...overrides
  }
}

export function makePullRequestCheck(overrides: Partial<GitHubPullRequestCheck> = {}): GitHubPullRequestCheck {
  return {
    name: 'build',
    state: 'SUCCESS',
    bucket: 'pass',
    workflow: 'CI',
    description: 'Build completed',
    link: 'https://github.com/example/project/actions/runs/1',
    startedAt: '2026-06-02T10:00:00Z',
    completedAt: '2026-06-02T10:01:00Z',
    ...overrides
  }
}

export function makePullRequestDiff(overrides: Partial<GitHubPullRequestDiff> = {}): GitHubPullRequestDiff {
  return {
    prNumber: 7,
    text: [
      'diff --git a/src/App.tsx b/src/App.tsx',
      '--- a/src/App.tsx',
      '+++ b/src/App.tsx',
      '@@ -1,3 +1,3 @@',
      ' import React from "react"',
      '-const title = "Old"',
      '+const title = "New"',
      ' export default title',
      ''
    ].join('\n'),
    files: [
      {
        oldPath: 'src/App.tsx',
        newPath: 'src/App.tsx',
        path: 'src/App.tsx',
        text: [
          'diff --git a/src/App.tsx b/src/App.tsx',
          '--- a/src/App.tsx',
          '+++ b/src/App.tsx',
          '@@ -1,3 +1,3 @@',
          ' import React from "react"',
          '-const title = "Old"',
          '+const title = "New"',
          ' export default title',
          ''
        ].join('\n'),
        status: 'modified',
        additions: 1,
        deletions: 1,
        hunks: [
          {
            header: '@@ -1,3 +1,3 @@',
            oldStart: 1,
            oldLines: 3,
            newStart: 1,
            newLines: 3,
            patch: '',
            lines: [
              { type: 'context', content: 'import React from "react"', oldLineNumber: 1, newLineNumber: 1 },
              { type: 'remove', content: 'const title = "Old"', oldLineNumber: 2 },
              { type: 'add', content: 'const title = "New"', newLineNumber: 2 },
              { type: 'context', content: 'export default title', oldLineNumber: 3, newLineNumber: 3 }
            ]
          }
        ]
      }
    ],
    ...overrides
  }
}

export function makeRepository(overrides: Partial<GitHubRepositorySummary> = {}): GitHubRepositorySummary {
  const nameWithOwner = overrides.nameWithOwner ?? 'example/project'
  const [owner, name] = nameWithOwner.split('/')

  return {
    name: overrides.name ?? name,
    nameWithOwner,
    owner: overrides.owner ?? owner,
    description: '',
    visibility: 'PRIVATE',
    isPrivate: true,
    isFork: false,
    isArchived: false,
    url: `https://github.com/${nameWithOwner}`,
    sshUrl: `git@github.com:${nameWithOwner}.git`,
    defaultBranch: 'main',
    updatedAt: '2026-06-02T10:00:00Z',
    pushedAt: '2026-06-02T09:00:00Z',
    ...overrides
  }
}

export function makeAccount(overrides: Partial<GitHubAccountSummary> = {}): GitHubAccountSummary {
  const login = overrides.login ?? 'branchpilot-user'

  return {
    login,
    label: overrides.label ?? login,
    type: overrides.type ?? 'user',
    url: `https://github.com/${login}`,
    ...overrides
  }
}

export function makeCoAuthor(overrides: Partial<CoAuthor> = {}): CoAuthor {
  const login = overrides.login ?? 'branchpilot-user'

  return {
    name: overrides.name ?? login,
    email: overrides.email ?? `1000+${login}@users.noreply.github.com`,
    login,
    avatarUrl: overrides.avatarUrl ?? `https://avatars.githubusercontent.com/${login}`,
    profileUrl: overrides.profileUrl ?? `https://github.com/${login}`,
    ...overrides
  }
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json'
    }
  })
}
