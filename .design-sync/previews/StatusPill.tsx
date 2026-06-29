import { StatusPill } from 'branchpilot'
import { CheckCircle2, AlertTriangle, XCircle, GitBranch, CircleDot, Clock } from 'lucide-react'

export const AllTones = () => (
  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
    <StatusPill label="Clean" tone="success" />
    <StatusPill label="Dirty" tone="warn" />
    <StatusPill label="Conflicted" tone="danger" />
    <StatusPill label="Available" tone="info" />
    <StatusPill label="Unknown" tone="neutral" />
    <StatusPill label="Planned" tone="planned" />
  </div>
)

export const ChecksSummary = () => (
  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
    <StatusPill label="6 pass" tone="success" />
    <StatusPill label="1 fail" tone="danger" />
    <StatusPill label="2 pending" tone="warn" />
    <StatusPill label="9 total" tone="neutral" />
  </div>
)

export const WithIcons = () => (
  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
    <StatusPill label="Connected" tone="success" icon={<CheckCircle2 size={14} />} />
    <StatusPill label="Behind by 3" tone="warn" icon={<AlertTriangle size={14} />} />
    <StatusPill label="Merge conflict" tone="danger" icon={<XCircle size={14} />} />
    <StatusPill label="main → develop" tone="info" icon={<GitBranch size={14} />} />
    <StatusPill label="Workflow available" tone="neutral" icon={<CircleDot size={14} />} />
    <StatusPill label="Planned / unavailable" tone="planned" icon={<Clock size={14} />} />
  </div>
)

export const RepositoryStates = () => (
  <div style={{ display: 'grid', gap: 8, maxWidth: 420 }}>
    {[
      { name: 'branch-pilot', label: 'Clean', tone: 'success' as const },
      { name: 'controller-rest-api', label: 'Dirty · 12 changed', tone: 'warn' as const },
      { name: 'edge-analytics', label: 'Conflicted · rebase', tone: 'danger' as const },
      { name: 'design-system', label: 'Unavailable', tone: 'neutral' as const }
    ].map((repo) => (
      <span
        key={repo.name}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}
      >
        <strong className="file-name">{repo.name}</strong>
        <StatusPill label={repo.label} tone={repo.tone} />
      </span>
    ))}
  </div>
)
