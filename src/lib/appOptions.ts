import type { AssistantPolicyMode, EditorPreference, GitBackendPreference, TerminalPreference } from '../shared/branchPilot'

export const assistantPolicyModes: AssistantPolicyMode[] = [
  'disabled',
  'review-only',
  'suggest-only',
  'allow-local-commands',
  'allow-file-edits'
]

export const editorPreferences: EditorPreference[] = ['vscode', 'auto', 'cursor', 'webstorm', 'rider', 'sublime', 'custom']

// Console git shells out to the installed git CLI (accurate default); built-in
// git uses isomorphic-git and falls back to console for anything it can't
// represent faithfully. Console stays first so it reads as the recommended option.
export const gitBackendPreferences: GitBackendPreference[] = ['native', 'console']

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
