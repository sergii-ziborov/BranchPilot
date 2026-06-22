import { describe, expect, it } from 'vitest'
import {
  assistantActionLabel,
  assistantLabel,
  assistantPolicyAllows,
  assistantPolicyBlockedLabel,
  assistantPolicyModeLabel,
  assistantReadinessSummary,
  assistantStatusLabel
} from '../src/lib/assistantLabels'
import type { AssistantPolicyStatus, AssistantStatus } from '../src/shared/branchPilot'

function makeStatus(overrides: Partial<AssistantStatus> = {}): AssistantStatus {
  return {
    id: 'claude',
    label: 'Claude Code',
    detected: false,
    state: 'missing',
    message: '',
    ...overrides
  }
}

function makePolicy(mode: AssistantPolicyStatus['settings']['mode'], allowed: AssistantPolicyStatus['allowedActions'] = []): AssistantPolicyStatus {
  return {
    settings: { repoPath: '/repo', mode, updatedAt: '2026-01-01' },
    allowedActions: allowed,
    lockedModes: []
  }
}

describe('assistantLabel', () => {
  it('names each assistant', () => {
    expect(assistantLabel('claude')).toBe('Claude Code')
    expect(assistantLabel('codex')).toBe('Codex')
  })
})

describe('assistantStatusLabel', () => {
  it('maps explicit states', () => {
    expect(assistantStatusLabel(makeStatus({ state: 'ready' }))).toBe('ready')
    expect(assistantStatusLabel(makeStatus({ state: 'unavailable' }))).toBe('unavailable')
    expect(assistantStatusLabel(makeStatus({ state: 'missing' }))).toBe('not found')
  })

  it('labels assistant session limits as limited', () => {
    expect(assistantStatusLabel(makeStatus({
      state: 'unavailable',
      message: "You've hit your session limit · resets 2:40pm"
    }))).toBe('limited')
  })

  it('uses detected flag for the detected state', () => {
    expect(assistantStatusLabel(makeStatus({ state: 'detected', detected: true }))).toBe('detected')
    expect(assistantStatusLabel(makeStatus({ state: 'detected', detected: false }))).toBe('not found')
  })
})

describe('assistantPolicyAllows', () => {
  it('allows everything when policy is unset', () => {
    expect(assistantPolicyAllows(null, 'commit_message')).toBe(true)
  })

  it('checks the allowed-actions list', () => {
    const policy = makePolicy('suggest-only', ['commit_message'])
    expect(assistantPolicyAllows(policy, 'commit_message')).toBe(true)
    expect(assistantPolicyAllows(policy, 'review_report')).toBe(false)
  })
})

describe('assistantPolicyModeLabel', () => {
  it('labels each mode', () => {
    expect(assistantPolicyModeLabel('disabled')).toBe('Disabled')
    expect(assistantPolicyModeLabel('review-only')).toBe('Review only')
    expect(assistantPolicyModeLabel('allow-local-commands')).toBe('Allow local commands')
    expect(assistantPolicyModeLabel('allow-file-edits')).toBe('Allow file edits')
    expect(assistantPolicyModeLabel('suggest-only')).toBe('Suggest only')
  })
})

describe('assistantActionLabel', () => {
  it('labels each action kind', () => {
    expect(assistantActionLabel('branch_draft')).toBe('Branch draft generation')
    expect(assistantActionLabel('commit_message')).toBe('Commit text generation')
    expect(assistantActionLabel('linkedin_project')).toBe('LinkedIn project generation')
    expect(assistantActionLabel('pull_request_text')).toBe('PR text generation')
    expect(assistantActionLabel('review_report')).toBe('Assistant reviews')
  })
})

describe('assistantReadinessSummary', () => {
  it('reports unknown when no assistants are loaded', () => {
    expect(assistantReadinessSummary([], 'auto').state).toBe('unknown')
  })

  it('reports a specific selected assistant that is not configured', () => {
    const summary = assistantReadinessSummary([makeStatus({ id: 'codex' })], 'claude')
    expect(summary.state).toBe('missing')
    expect(summary.title).toContain('Claude Code is not configured')
  })

  it('reflects a configured selected assistant state', () => {
    const summary = assistantReadinessSummary([makeStatus({ id: 'claude', label: 'Claude Code', state: 'ready', message: 'OK' })], 'claude')
    expect(summary.state).toBe('ready')
    expect(summary.title).toBe('Claude Code: ready')
  })

  it('auto prefers a ready assistant', () => {
    const summary = assistantReadinessSummary([
      makeStatus({ id: 'codex', label: 'Codex', state: 'detected' }),
      makeStatus({ id: 'claude', label: 'Claude Code', state: 'ready', message: 'go' })
    ], 'auto')
    expect(summary.state).toBe('ready')
    expect(summary.title).toBe('Auto will use Claude Code')
  })

  it('auto falls back to missing when nothing is usable', () => {
    expect(assistantReadinessSummary([makeStatus({ id: 'claude', state: 'missing' })], 'auto').state).toBe('missing')
  })
})

describe('assistantPolicyBlockedLabel', () => {
  it('explains a disabled policy', () => {
    expect(assistantPolicyBlockedLabel('commit_message', makePolicy('disabled')))
      .toBe('Commit text generation is blocked because assistant policy is Disabled.')
  })

  it('explains a review-only policy', () => {
    expect(assistantPolicyBlockedLabel('review_report', makePolicy('review-only')))
      .toBe('Assistant reviews is blocked because assistant policy is Review only.')
  })

  it('falls back to a generic message and defaults to suggest-only when policy is null', () => {
    expect(assistantPolicyBlockedLabel('branch_draft', null))
      .toBe('Branch draft generation is not available under the current assistant policy.')
  })
})
