import { describe, expect, it } from 'vitest'
import {
  activityCategoryLabel,
  activityEntryCategory,
  activityMetadataLabel,
  activityTypeLabel,
  completedWorkSource,
  completedWorkSourceLabel
} from '../src/lib/activityLabels'
import type { ActivityLogEntry } from '../src/shared/branchPilot'

function makeEntry(overrides: Partial<ActivityLogEntry> = {}): ActivityLogEntry {
  return {
    id: '1',
    repoPath: '/repo',
    type: 'commit_created',
    actor: 'user',
    status: 'success',
    title: 'Committed changes',
    createdAt: '2026-01-01',
    metadata: {},
    ...overrides
  }
}

describe('activityEntryCategory', () => {
  it('classifies by actor first', () => {
    expect(activityEntryCategory(makeEntry({ actor: 'assistant' }))).toBe('assistant')
    expect(activityEntryCategory(makeEntry({ actor: 'provider' }))).toBe('provider')
  })

  it('classifies assistant policy events', () => {
    expect(activityEntryCategory(makeEntry({ actor: 'user', type: 'assistant_policy_updated' }))).toBe('assistant')
  })

  it('classifies memory events', () => {
    expect(activityEntryCategory(makeEntry({ actor: 'user', type: 'repository_opened' }))).toBe('memory')
  })

  it('defaults to git', () => {
    expect(activityEntryCategory(makeEntry({ actor: 'user', type: 'commit_created' }))).toBe('git')
  })
})

describe('activityCategoryLabel', () => {
  it('labels each category', () => {
    expect(activityCategoryLabel('git')).toBe('Git')
    expect(activityCategoryLabel('assistant')).toBe('Assistant')
    expect(activityCategoryLabel('provider')).toBe('Provider')
    expect(activityCategoryLabel('memory')).toBe('Memory')
    expect(activityCategoryLabel('all')).toBe('All')
  })
})

describe('activityTypeLabel', () => {
  it('title-cases snake_case event types', () => {
    expect(activityTypeLabel('github_pr_created')).toBe('Github Pr Created')
    expect(activityTypeLabel('commit_created')).toBe('Commit Created')
  })
})

describe('completedWorkSource / completedWorkSourceLabel', () => {
  it('maps event types to a work source', () => {
    expect(completedWorkSource('github_pr_created')).toBe('provider')
    expect(completedWorkSource('daily_review_generated')).toBe('review')
    expect(completedWorkSource('assistant_linkedin_generated')).toBe('linkedin')
    expect(completedWorkSource('commit_created')).toBe('git')
  })

  it('labels each work source', () => {
    expect(completedWorkSourceLabel('commit')).toBe('Commit')
    expect(completedWorkSourceLabel('provider')).toBe('Provider')
    expect(completedWorkSourceLabel('review')).toBe('Review')
    expect(completedWorkSourceLabel('linkedin')).toBe('LinkedIn')
    expect(completedWorkSourceLabel('git')).toBe('Git')
  })
})

describe('activityMetadataLabel', () => {
  it('joins up to four non-empty metadata pairs', () => {
    const entry = makeEntry({ metadata: { branch: 'main', count: 3, blank: '', nothing: null } })
    expect(activityMetadataLabel(entry)).toBe('branch: main · count: 3')
  })

  it('falls back to the title when there is no usable metadata', () => {
    expect(activityMetadataLabel(makeEntry({ title: 'Fallback', metadata: {} }))).toBe('Fallback')
  })
})
