import { Stat } from 'branchpilot'

export const Default = () => <Stat label="Commits ahead" value={12} />

export const Tones = () => (
  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
    <Stat label="Tracked files" value={482} tone="neutral" />
    <Stat label="Staged" value={8} tone="info" />
    <Stat label="Untracked" value={3} tone="warn" />
    <Stat label="Conflicts" value={2} tone="danger" />
    <Stat label="Working tree" value="Clean" tone="ok" />
  </div>
)

export const WithHint = () => (
  <Stat label="Behind origin" value={5} tone="warn" hint="Pull to update your local branch." />
)
