import { DiffStatBadges } from 'branchpilot'

export const AdditionsOnly = () => (
  <div className="diff-heading-main" style={{ display: 'grid', gap: 4 }}>
    <p style={{ margin: 0 }}>src/components/DiffStatBadges.tsx</p>
    <DiffStatBadges additions={28} deletions={0} hideZero />
  </div>
)

export const DeletionsOnly = () => (
  <div className="diff-heading-main" style={{ display: 'grid', gap: 4 }}>
    <p style={{ margin: 0 }}>electron/lib/repositoryService.legacy.ts</p>
    <DiffStatBadges additions={0} deletions={143} hideZero />
  </div>
)

export const Both = () => (
  <div className="diff-heading-main" style={{ display: 'grid', gap: 4 }}>
    <p style={{ margin: 0 }}>src/hooks/useChanges.ts</p>
    <DiffStatBadges additions={64} deletions={19} />
  </div>
)

export const WithFilesChanged = () => (
  <div className="diff-heading-main" style={{ display: 'grid', gap: 4 }}>
    <p style={{ margin: 0 }}>feat: extract diff stat badges into design system</p>
    <DiffStatBadges additions={312} deletions={87} filesChanged={9} />
  </div>
)

export const SingleFileChanged = () => (
  <div className="diff-heading-main" style={{ display: 'grid', gap: 4 }}>
    <p style={{ margin: 0 }}>fix: correct churn label pluralization</p>
    <DiffStatBadges additions={3} deletions={1} filesChanged={1} />
  </div>
)
