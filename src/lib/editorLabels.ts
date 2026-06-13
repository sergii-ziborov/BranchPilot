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
