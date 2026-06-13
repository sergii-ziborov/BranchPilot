import type { ProviderRemoteSummary } from '../shared/providerRemote'
import { InfoRow } from './primitives'

/** Summary card for the repository's current provider remote. */
export function ProviderRemoteCard({
  remote,
  remoteName,
  remoteUrl,
  hasRepository
}: {
  remote: ProviderRemoteSummary
  remoteName?: string
  remoteUrl?: string
  hasRepository: boolean
}) {
  return (
    <section className={`provider-remote-card provider-${remote.kind}`}>
      <div className="provider-remote-heading">
        <div>
          <span>Current remote</span>
          <strong>{hasRepository ? remote.label : 'No repository selected'}</strong>
        </div>
        <span className={remote.supported ? 'remote-support-chip supported' : 'remote-support-chip planned'}>
          {remote.supported ? 'Workflow available' : 'Planned / unavailable'}
        </span>
      </div>
      <p>{hasRepository ? remote.message : 'Open a repository to inspect provider compatibility.'}</p>
      <div className="provider-remote-grid">
        <InfoRow label="Remote" value={remoteName ?? 'None'} />
        <InfoRow label="Host" value={remote.host ?? 'None'} />
        <InfoRow label="Owner" value={remote.owner ?? 'Unknown'} />
        <InfoRow label="Repository" value={remote.repository ?? 'Unknown'} />
      </div>
      {remoteUrl && <code>{remoteUrl}</code>}
    </section>
  )
}

/** Notice panel for providers whose native workflows are not yet implemented. */
export function PlannedProviderWorkflowPanel({ remote }: { remote: ProviderRemoteSummary }) {
  return (
    <section className="planned-provider-panel">
      <div className="panel-heading compact-heading">
        <div>
          <h3>{remote.label} {remote.workflowLabel}</h3>
          <p>Native {remote.workflowLabel} workflows for this provider are planned.</p>
        </div>
        <span className="remote-support-chip planned">Planned</span>
      </div>
      <div className="quiet-box">
        BranchPilot detected this repository on {remote.label}. Local Git, review, commit text, Project Memory, and Project Wiki workflows are available now; provider-native {remote.workflowLabel} creation will come after the adapter is implemented.
      </div>
    </section>
  )
}
