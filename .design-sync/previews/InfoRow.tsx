import { InfoRow } from 'branchpilot'

export const Default = () => <InfoRow label="Branch" value="main" />

export const Group = () => (
  <div style={{ display: 'grid', gap: 2, maxWidth: 360 }}>
    <InfoRow label="Branch" value="feature/design-sync" />
    <InfoRow label="Upstream" value="origin/main" />
    <InfoRow label="Ahead / behind" value="3 / 0" />
    <InfoRow label="Last commit" value="2 hours ago" />
  </div>
)
