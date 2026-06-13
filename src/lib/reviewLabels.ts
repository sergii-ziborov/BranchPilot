import type { ReviewFinding, ReviewMode, ReviewScope, ReviewSeverity } from '../shared/branchPilot'

/** The review modes offered in the UI, in display order. */
export const reviewModes: ReviewMode[] = ['consistency', 'security', 'quality']

/** Display label for a review mode. */
export function reviewModeLabel(mode: ReviewMode): string {
  if (mode === 'security') return 'Security'
  if (mode === 'quality') return 'Quality'
  return 'Consistency'
}

/** Display label for a review scope. */
export function reviewScopeLabel(scope: ReviewScope): string {
  if (scope === 'unstaged') return 'Unstaged'
  if (scope === 'branch') return 'Branch'
  return 'Staged'
}

/** Bucket review findings by severity, preserving order within each bucket. */
export function groupFindingsBySeverity(findings: ReviewFinding[]): Record<ReviewSeverity, ReviewFinding[]> {
  return {
    critical: findings.filter((finding) => finding.severity === 'critical'),
    high: findings.filter((finding) => finding.severity === 'high'),
    medium: findings.filter((finding) => finding.severity === 'medium'),
    low: findings.filter((finding) => finding.severity === 'low'),
    info: findings.filter((finding) => finding.severity === 'info')
  }
}
