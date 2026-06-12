import { describe, expect, it } from 'vitest'
import { formatBytes, formatDate, formatDateInputValue } from '../src/lib/format'

describe('formatBytes', () => {
  it('formats bytes under 1 KB', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(512)).toBe('512 B')
  })

  it('formats kilobytes with rounding', () => {
    expect(formatBytes(1024)).toBe('1 KB')
    expect(formatBytes(1536)).toBe('2 KB')
  })

  it('formats megabytes with one decimal', () => {
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB')
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB')
  })
})

describe('formatDateInputValue', () => {
  it('zero-pads month and day', () => {
    expect(formatDateInputValue(new Date(2026, 0, 5))).toBe('2026-01-05')
  })

  it('formats a two-digit month and day', () => {
    expect(formatDateInputValue(new Date(2026, 10, 23))).toBe('2026-11-23')
  })
})

describe('formatDate', () => {
  it('returns a stable placeholder for empty input', () => {
    expect(formatDate('')).toBe('Unknown date')
  })

  it('returns a non-empty localized string for a valid ISO date', () => {
    const result = formatDate('2026-06-12T10:30:00Z')
    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(0)
    expect(result).not.toBe('Unknown date')
  })
})
