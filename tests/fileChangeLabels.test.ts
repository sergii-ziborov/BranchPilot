import { describe, expect, it } from 'vitest'
import { changeLabel, fileStatusToken, fileStatusTone, statusToken, statusTone } from '../src/lib/fileChangeLabels'
import type { FileChange } from '../src/shared/branchPilot'

function makeChange(overrides: Partial<FileChange> = {}): FileChange {
  return {
    path: 'src/file.ts',
    status: 'modified',
    staged: false,
    unstaged: false,
    untracked: false,
    conflicted: false,
    ...overrides
  }
}

describe('changeLabel', () => {
  it('joins active stage buckets with a separator', () => {
    expect(changeLabel(makeChange({ staged: true, unstaged: true }))).toBe('staged / unstaged')
  })

  it('reports a single bucket', () => {
    expect(changeLabel(makeChange({ untracked: true }))).toBe('untracked')
  })

  it('lists conflict last', () => {
    expect(changeLabel(makeChange({ staged: true, conflicted: true }))).toBe('staged / conflict')
  })

  it('falls back to the raw status when no bucket is active', () => {
    expect(changeLabel(makeChange({ status: 'deleted' }))).toBe('deleted')
  })
})

describe('fileStatusToken', () => {
  it('maps known statuses to single letters', () => {
    expect(fileStatusToken('renamed')).toBe('R')
    expect(fileStatusToken('copied')).toBe('C')
    expect(fileStatusToken('deleted')).toBe('D')
    expect(fileStatusToken('added')).toBe('A')
    expect(fileStatusToken('untracked')).toBe('A')
  })

  it('defaults unknown statuses to M (modified)', () => {
    expect(fileStatusToken('modified')).toBe('M')
    expect(fileStatusToken('whatever')).toBe('M')
  })
})

describe('statusToken', () => {
  it('prioritises conflict marker', () => {
    expect(statusToken(makeChange({ conflicted: true, status: 'added' }))).toBe('!')
  })

  it('shows untracked files as additions so the badge stays stable after staging', () => {
    expect(statusToken(makeChange({ untracked: true, status: 'untracked' }))).toBe('A')
    expect(statusTone(makeChange({ untracked: true, status: 'untracked' }))).toBe('added')
  })

  it('falls back to the file-status token', () => {
    expect(statusToken(makeChange({ status: 'renamed' }))).toBe('R')
  })
})

describe('fileStatusTone', () => {
  it('uses added styling for untracked additions', () => {
    expect(fileStatusTone('untracked')).toBe('added')
    expect(fileStatusTone('modified')).toBe('modified')
  })
})
