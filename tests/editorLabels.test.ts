import { describe, expect, it } from 'vitest'
import { editorPreferenceLabel } from '../src/lib/editorLabels'

describe('editorPreferenceLabel', () => {
  it('labels each known editor preference', () => {
    expect(editorPreferenceLabel('auto')).toBe('Auto')
    expect(editorPreferenceLabel('vscode')).toBe('Visual Studio Code')
    expect(editorPreferenceLabel('cursor')).toBe('Cursor')
    expect(editorPreferenceLabel('webstorm')).toBe('WebStorm')
    expect(editorPreferenceLabel('rider')).toBe('Rider')
    expect(editorPreferenceLabel('sublime')).toBe('Sublime Text')
  })

  it('falls back to a custom-command label', () => {
    expect(editorPreferenceLabel('custom')).toBe('Custom command')
  })
})
