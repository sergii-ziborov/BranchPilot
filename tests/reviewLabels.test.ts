import { describe, expect, it } from 'vitest'
import { groupFindingsBySeverity, reviewModeLabel, reviewScopeLabel } from '../src/lib/reviewLabels'
import type { ReviewFinding, ReviewSeverity } from '../src/shared/branchPilot'

describe('reviewModeLabel', () => {
  it('labels each mode', () => {
    expect(reviewModeLabel('security')).toBe('Security')
    expect(reviewModeLabel('quality')).toBe('Quality')
    expect(reviewModeLabel('consistency')).toBe('Consistency')
  })
})

describe('reviewScopeLabel', () => {
  it('labels each scope', () => {
    expect(reviewScopeLabel('unstaged')).toBe('Unstaged')
    expect(reviewScopeLabel('branch')).toBe('Branch')
    expect(reviewScopeLabel('staged')).toBe('Staged')
  })
})

describe('groupFindingsBySeverity', () => {
  const finding = (severity: ReviewSeverity, title: string): ReviewFinding => ({
    severity,
    title,
    details: ''
  })

  it('buckets findings by severity', () => {
    const grouped = groupFindingsBySeverity([
      finding('critical', 'a'),
      finding('low', 'b'),
      finding('critical', 'c'),
      finding('info', 'd')
    ])
    expect(grouped.critical.map((f) => f.title)).toEqual(['a', 'c'])
    expect(grouped.low.map((f) => f.title)).toEqual(['b'])
    expect(grouped.info.map((f) => f.title)).toEqual(['d'])
    expect(grouped.high).toEqual([])
    expect(grouped.medium).toEqual([])
  })

  it('returns all five buckets even when empty', () => {
    const grouped = groupFindingsBySeverity([])
    expect(Object.keys(grouped).sort()).toEqual(['critical', 'high', 'info', 'low', 'medium'])
  })
})
