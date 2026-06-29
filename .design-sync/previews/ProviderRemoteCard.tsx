import { ProviderRemoteCard } from 'branchpilot'

export const GitHubSupported = () => (
  <ProviderRemoteCard
    hasRepository
    remoteName="origin"
    remoteUrl="https://github.com/branchpilot/branchpilot.git"
    remote={{
      kind: 'github',
      label: 'GitHub',
      workflowLabel: 'pull request',
      host: 'github.com',
      owner: 'branchpilot',
      repository: 'branchpilot',
      supported: true,
      message: 'GitHub PR workflows are available when authentication and branch preconditions pass.',
    }}
  />
)

export const GitLabPlanned = () => (
  <ProviderRemoteCard
    hasRepository
    remoteName="origin"
    remoteUrl="git@gitlab.com:acme/web.git"
    remote={{
      kind: 'gitlab',
      label: 'GitLab',
      workflowLabel: 'merge request',
      host: 'gitlab.com',
      owner: 'acme',
      repository: 'web',
      supported: false,
      message: 'GitLab remote detected. Native merge request workflows remain planned.',
    }}
  />
)

export const NoRepository = () => (
  <ProviderRemoteCard
    hasRepository={false}
    remote={{
      kind: 'none',
      label: 'No remote',
      workflowLabel: 'provider workflow',
      supported: false,
      message: 'Add a Git remote before provider workflows are available.',
    }}
  />
)
