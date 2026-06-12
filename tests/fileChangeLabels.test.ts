import { describe, expect, it } from 'vitest'
import { changeLabel, fileStatusToken, statusToken } from '../src/lib/fileChangeLabels'
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

  it('prioritises untracked marker over status letter', () => {
    expect(statusToken(makeChange({ untracked: true, status: 'added' }))).toBe('?')
  })

  it('falls back to the file-status token', () => {
    expect(statusToken(makeChange({ status: 'renamed' }))).toBe('R')
  })
})
