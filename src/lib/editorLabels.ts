import type { EditorPreference } from '../shared/branchPilot'

/** Display label for a configured external-editor preference. */
export function editorPreferenceLabel(preference: EditorPreference): string {
  if (preference === 'auto') return 'Auto'
  if (preference === 'vscode') return 'Visual Studio Code'
  if (preference === 'cursor') return 'Cursor'
  if (preference === 'webstorm') return 'WebStorm'
  if (preference === 'rider') return 'Rider'
  if (preference === 'sublime') return 'Sublime Text'
  return 'Custom command'
}

/** Human-readable command shape shown in Settings for built-in editor presets. */
export function editorPreferenceCommandHint(preference: EditorPreference): string {
  if (preference === 'auto') return 'Auto-detect VS Code, Cursor, WebStorm, Rider, or Sublime Text'
  if (preference === 'vscode') return 'code --goto %TARGET_PATH%'
  if (preference === 'cursor') return 'cursor --goto %TARGET_PATH%'
  if (preference === 'webstorm') return 'webstorm --line <line> %TARGET_PATH%'
  if (preference === 'rider') return 'rider --line <line> %TARGET_PATH%'
  if (preference === 'sublime') return 'subl %TARGET_PATH%'
  return ''
}
