import { describe, expect, it } from 'vitest'
import { progressLabelFromSuccess } from '../src/lib/progressLabels'

describe('progressLabelFromSuccess', () => {
  it('returns a default for empty/whitespace input', () => {
    expect(progressLabelFromSuccess('')).toBe('Working...')
    expect(progressLabelFromSuccess('   ')).toBe('Working...')
  })

  it('keeps an existing ellipsis', () => {
    expect(progressLabelFromSuccess('Loading...')).toBe('Loading...')
  })

  it('strips trailing punctuation before adding an ellipsis', () => {
    expect(progressLabelFromSuccess('Pushed changes')).toBe('Pushed changes...')
    expect(progressLabelFromSuccess('Done!')).toBe('Done...')
    expect(progressLabelFromSuccess('Saved.')).toBe('Saved...')
  })
})
