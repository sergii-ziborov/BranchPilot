import { Meter } from 'branchpilot'

export const ContributorShare = () => (
  <div style={{ display: 'grid', gap: 12, maxWidth: 320 }}>
    <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 10, alignItems: 'center' }}>
      <Meter value={90} max={100} minPercent={6} />
      <span style={{ color: 'var(--muted)', fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>142</span>
    </div>
    <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 10, alignItems: 'center' }}>
      <Meter value={55} max={100} minPercent={6} />
      <span style={{ color: 'var(--muted)', fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>87</span>
    </div>
    <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 10, alignItems: 'center' }}>
      <Meter value={20} max={100} minPercent={6} />
      <span style={{ color: 'var(--muted)', fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>31</span>
    </div>
    <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 10, alignItems: 'center' }}>
      <Meter value={2} max={100} minPercent={6} />
      <span style={{ color: 'var(--muted)', fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>3</span>
    </div>
  </div>
)

export const Tones = () => (
  <div style={{ display: 'grid', gap: 12, maxWidth: 320 }}>
    <Meter value={72} tone="accent" label="Coverage 72%" />
    <Meter value={48} tone="info" label="Staged 48%" />
    <Meter value={66} tone="warn" label="Behind origin 66%" />
    <Meter value={88} tone="danger" label="Conflicting files 88%" />
  </div>
)

export const Indeterminate = () => (
  <div style={{ display: 'grid', gap: 14, maxWidth: 420 }}>
    <div style={{ display: 'grid', gap: 6 }}>
      <strong style={{ fontSize: 13 }}>Running staged review</strong>
      <Meter indeterminate label="Sending diff context to Claude" />
    </div>
    <div style={{ display: 'grid', gap: 6 }}>
      <strong style={{ fontSize: 13 }}>Fetching origin/main</strong>
      <Meter indeterminate tone="info" label="Fetching origin" />
    </div>
  </div>
)

export const RelativeToMax = () => (
  <div style={{ display: 'grid', gap: 12, maxWidth: 320 }}>
    <Meter value={142} max={142} minPercent={6} label="Top contributor: 142 commits" />
    <Meter value={87} max={142} minPercent={6} label="87 of 142 commits" />
    <Meter value={31} max={142} minPercent={6} label="31 of 142 commits" />
  </div>
)
