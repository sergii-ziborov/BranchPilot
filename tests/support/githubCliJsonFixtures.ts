import type {
  CoAuthor,
  GitHubAccountSummary,
  GitHubPullRequest,
  GitHubPullRequestCheck,
  GitHubPullRequestDetails,
  GitHubRepositorySummary
} from '../../src/shared/branchPilot'

export function toGhCoAuthorJson(coAuthor: CoAuthor) {
  const login = coAuthor.login ?? coAuthor.name
  const id = Number(coAuthor.email.match(/^(\d+)\+/)?.[1] ?? 1000)

  return {
    login,
    id,
    name: coAuthor.name,
    avatar_url: coAuthor.avatarUrl,
    html_url: coAuthor.profileUrl ?? `https://github.com/${login}`,
    type: 'User'
  }
}

export function toGhPullRequestJson(pullRequest: GitHubPullRequest) {
  return {
    number: pullRequest.number,
    title: pullRequest.title,
    url: pullRequest.url,
    state: pullRequest.state,
    headRefName: pullRequest.headBranch,
    baseRefName: pullRequest.baseBranch,
    isDraft: pullRequest.draft
  }
}

export function toGhAccountJson(account: GitHubAccountSummary) {
  return {
    login: account.login,
    name: account.label,
    description: account.label,
    type: account.type === 'organization' ? 'Organization' : 'User',
    html_url: account.url
  }
}

export function toGhEmailJson(email: string, index: number) {
  return {
    email,
    primary: index === 0,
    verified: true,
    visibility: index === 0 ? 'public' : null
  }
}

export function toGhRepositoryJson(repository: GitHubRepositorySummary) {
  return {
    name: repository.name,
    nameWithOwner: repository.nameWithOwner,
    owner: {
      login: repository.owner
    },
    description: repository.description,
    visibility: repository.visibility,
    isPrivate: repository.isPrivate,
    isFork: repository.isFork,
    isArchived: repository.isArchived,
    url: repository.url,
    sshUrl: repository.sshUrl,
    defaultBranchRef: {
      name: repository.defaultBranch
    },
    updatedAt: repository.updatedAt,
    pushedAt: repository.pushedAt
  }
}

export function toGhPullRequestDetailsJson(pullRequest: GitHubPullRequestDetails) {
  return {
    ...toGhPullRequestJson(pullRequest),
    body: pullRequest.body,
    author: pullRequest.author,
    createdAt: pullRequest.createdAt,
    updatedAt: pullRequest.updatedAt,
    additions: pullRequest.additions,
    deletions: pullRequest.deletions,
    changedFiles: pullRequest.changedFiles
  }
}

export function toGhPullRequestCheckJson(check: GitHubPullRequestCheck) {
  return {
    name: check.name,
    state: check.state,
    bucket: check.bucket,
    workflow: check.workflow,
    description: check.description,
    link: check.link,
    startedAt: check.startedAt,
    completedAt: check.completedAt
  }
}
