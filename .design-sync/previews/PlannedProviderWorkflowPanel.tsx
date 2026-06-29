import { PlannedProviderWorkflowPanel } from 'branchpilot'

export const GitLab = () => (
  <PlannedProviderWorkflowPanel
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

export const Bitbucket = () => (
  <PlannedProviderWorkflowPanel
    remote={{
      kind: 'bitbucket',
      label: 'Bitbucket',
      workflowLabel: 'pull request',
      host: 'bitbucket.org',
      owner: 'acme',
      repository: 'api',
      supported: false,
      message: 'Bitbucket remote detected. Native pull request workflows remain planned.',
    }}
  />
)
