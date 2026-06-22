import { describe, expect, it } from 'vitest'
import { editorPreferenceCommandHint, editorPreferenceLabel } from '../src/lib/editorLabels'

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

  it('shows a ready VS Code command hint for settings', () => {
    expect(editorPreferenceCommandHint('vscode')).toBe('code --goto %TARGET_PATH%')
    expect(editorPreferenceCommandHint('custom')).toBe('')
  })
})
