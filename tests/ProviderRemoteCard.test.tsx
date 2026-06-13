import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { PlannedProviderWorkflowPanel, ProviderRemoteCard } from '../src/components/ProviderRemoteCard'
import type { ProviderRemoteSummary } from '../src/shared/providerRemote'

function makeRemote(overrides: Partial<ProviderRemoteSummary> = {}): ProviderRemoteSummary {
  return {
    kind: 'github',
    label: 'GitHub',
    workflowLabel: 'pull request',
    supported: true,
    message: 'Connected to GitHub.',
    ...overrides
  }
}

describe('ProviderRemoteCard', () => {
  it('renders remote details when a repository is open', () => {
    const html = renderToStaticMarkup(
      <ProviderRemoteCard remote={makeRemote({ host: 'github.com', owner: 'octo', repository: 'repo' })}
        remoteName="origin" remoteUrl="https://github.com/octo/repo.git" hasRepository />
    )
    expect(html).toContain('provider-remote-card provider-github')
    expect(html).toContain('Workflow available')
    expect(html).toContain('<strong>GitHub</strong>')
    expect(html).toContain('origin')
    expect(html).toContain('https://github.com/octo/repo.git')
  })

  it('shows placeholders when no repository is selected', () => {
    const html = renderToStaticMarkup(
      <ProviderRemoteCard remote={makeRemote({ supported: false })} hasRepository={false} />
    )
    expect(html).toContain('No repository selected')
    expect(html).toContain('Planned / unavailable')
    expect(html).toContain('Open a repository to inspect provider compatibility.')
  })
})

describe('PlannedProviderWorkflowPanel', () => {
  it('renders the planned workflow notice', () => {
    const html = renderToStaticMarkup(<PlannedProviderWorkflowPanel remote={makeRemote({ label: 'GitLab', workflowLabel: 'merge request' })} />)
    expect(html).toContain('GitLab merge request')
    expect(html).toContain('Planned')
    expect(html).toContain('provider-native merge request creation')
  })
})
