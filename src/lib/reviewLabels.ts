import type { ReviewFinding, ReviewMode, ReviewScope, ReviewSeverity } from '../shared/branchPilot'

/** The review modes offered in the UI, in display order. */
export const reviewModes: ReviewMode[] = ['consistency', 'security', 'quality', 'knip', 'depcheck', 'osv', 'gitleaks']

/** Lightweight default set for automatic pre-commit review. */
export const defaultPreCommitReviewModes: ReviewMode[] = ['consistency', 'security', 'quality']

/** Severity buckets in display order (highest first). */
export const reviewSeverities: ReviewSeverity[] = ['critical', 'high', 'medium', 'low', 'info']

/** Display label for a review mode. */
export function reviewModeLabel(mode: ReviewMode): string {
  if (mode === 'security') return 'Security'
  if (mode === 'quality') return 'Quality'
  if (mode === 'knip') return 'Knip'
  if (mode === 'depcheck') return 'Depcheck'
  if (mode === 'osv') return 'OSV'
  if (mode === 'gitleaks') return 'Gitleaks'
  return 'Consistency'
}

/** Short helper text for empty-state copy and tooltips. */
export function reviewModeDescription(mode: ReviewMode): string {
  if (mode === 'knip') return 'Unused files, exports, and dependency hints from changed code.'
  if (mode === 'depcheck') return 'Dependency usage issues implied by selected changes.'
  if (mode === 'osv') return 'Changed dependency manifests and lockfiles for vulnerable packages.'
  if (mode === 'gitleaks') return 'Secret-like tokens, keys, credentials, and accidental leaks in the diff.'
  if (mode === 'security') return 'Auth, shell/process, destructive operations, secrets, and permissions.'
  if (mode === 'quality') return 'Bugs, edge cases, regressions, compatibility, and validation.'
  return 'Architecture boundaries, duplication, tests, unrelated changes, and risky refactors.'
}

/** Display label for a review scope. */
export function reviewScopeLabel(scope: ReviewScope): string {
  if (scope === 'selected') return 'Selected file'
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
