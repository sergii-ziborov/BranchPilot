import { CommitRefChip } from 'branchpilot'

export const Tag = () => <CommitRefChip kind="tag" label="v1.2.0" />

export const Branch = () => <CommitRefChip kind="branch" label="main" />

export const RefRow = () => (
  <div className="commit-hover-refs" style={{ maxWidth: 320 }}>
    <CommitRefChip kind="tag" label="v1.2.0" />
    <CommitRefChip kind="tag" label="release" />
    <CommitRefChip kind="branch" label="main" />
    <CommitRefChip kind="branch" label="feature/heatmap-selector" />
  </div>
)

export const MixedTags = () => (
  <div className="commit-hover-refs" style={{ maxWidth: 320 }}>
    <CommitRefChip kind="tag" label="v2.0.0-rc.1" />
    <CommitRefChip kind="tag" label="latest" />
    <CommitRefChip kind="branch" label="develop" />
  </div>
)
