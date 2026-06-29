import { CountBadge } from 'branchpilot'

export const Tones = () => (
  <div className="dashboard-section-heading" style={{ display: 'flex', gap: 12 }}>
    <CountBadge count={4} />
    <CountBadge count={9} tone="info" />
    <CountBadge count={3} tone="warn" />
    <CountBadge count={2} tone="danger" />
    <CountBadge count={6} tone="muted" />
    <CountBadge count={5} tone="accent" />
  </div>
)

export const SectionHeadings = () => (
  <div style={{ display: 'grid', gap: 10 }}>
    {[
      { title: 'Contributors', desc: 'Top committers by share of commit history.', count: 8, tone: 'info' as const },
      { title: 'Repository attention', desc: 'Dirty, conflicted, ahead, and behind repositories.', count: 3, tone: 'warn' as const },
      { title: 'Conflicts', desc: 'Merge, rebase, and conflicted-file signals.', count: 2, tone: 'danger' as const },
      { title: 'Stale branches', desc: 'Local branches older than 30 days.', count: 11, tone: 'muted' as const }
    ].map((row) => (
      <div key={row.title} className="dashboard-section-heading">
        <div>
          <h3>{row.title}</h3>
          <p>{row.desc}</p>
        </div>
        <CountBadge count={row.count} tone={row.tone} />
      </div>
    ))}
  </div>
)

export const DoubleAndHighCounts = () => (
  <div className="dashboard-section-heading" style={{ display: 'flex', gap: 12 }}>
    <CountBadge count={7} tone="info" />
    <CountBadge count={42} tone="warn" />
    <CountBadge count={128} tone="danger" />
    <CountBadge count={1024} tone="muted" />
  </div>
)
