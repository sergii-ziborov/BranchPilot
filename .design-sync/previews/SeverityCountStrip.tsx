import { SeverityCountStrip } from 'branchpilot'

export const FullReview = () => (
  <SeverityCountStrip
    counts={[
      { severity: 'critical', count: 2 },
      { severity: 'high', count: 5 },
      { severity: 'medium', count: 8 },
      { severity: 'low', count: 3 },
      { severity: 'info', count: 11 }
    ]}
  />
)

export const CleanReview = () => (
  <SeverityCountStrip
    counts={[
      { severity: 'critical', count: 0 },
      { severity: 'high', count: 0 },
      { severity: 'medium', count: 0 },
      { severity: 'low', count: 0 },
      { severity: 'info', count: 0 }
    ]}
  />
)

export const HighSeverityOnly = () => (
  <SeverityCountStrip
    counts={[
      { severity: 'critical', count: 4 },
      { severity: 'high', count: 7 }
    ]}
  />
)
