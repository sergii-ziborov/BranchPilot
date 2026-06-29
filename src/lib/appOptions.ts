import type { AssistantPolicyMode, EditorPreference, TerminalPreference } from '../shared/branchPilot'

export const assistantPolicyModes: AssistantPolicyMode[] = [
  'disabled',
  'review-only',
  'suggest-only',
  'allow-local-commands',
  'allow-file-edits'
]

export const editorPreferences: EditorPreference[] = ['vscode', 'auto', 'cursor', 'webstorm', 'rider', 'sublime', 'custom']

export const terminalPreferences: TerminalPreference[] = [
  'auto',
  'windows-terminal',
  'powershell',
  'cmd',
  'git-bash',
  'terminal',
  'iterm',
  'gnome-terminal',
  'konsole',
  'alacritty',
  'wezterm',
  'custom'
]
