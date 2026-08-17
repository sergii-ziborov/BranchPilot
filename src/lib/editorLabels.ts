import type { EditorPreference, GitBackendPreference, TerminalPreference } from '../shared/branchPilot'

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

/** Display label for a configured terminal preference. */
export function terminalPreferenceLabel(preference: TerminalPreference): string {
  if (preference === 'auto') return 'Auto'
  if (preference === 'windows-terminal') return 'Windows Terminal'
  if (preference === 'powershell') return 'PowerShell'
  if (preference === 'cmd') return 'Command Prompt'
  if (preference === 'git-bash') return 'Git Bash'
  if (preference === 'terminal') return 'macOS Terminal'
  if (preference === 'iterm') return 'iTerm2'
  if (preference === 'gnome-terminal') return 'GNOME Terminal'
  if (preference === 'konsole') return 'Konsole'
  if (preference === 'alacritty') return 'Alacritty'
  if (preference === 'wezterm') return 'WezTerm'
  return 'Custom command'
}

/** Display label for a Git read-backend preference. */
export function gitBackendPreferenceLabel(preference: GitBackendPreference): string {
  return preference === 'native' ? 'Native git' : 'Console git'
}

/** Short capability summary shown under each Git backend option. */
export function gitBackendPreferenceDescription(preference: GitBackendPreference): string {
  return preference === 'native'
    ? 'Fast. Default. Reads the repository in-process and falls back to console git when it cannot answer exactly.'
    : 'Accurate. Runs your installed git once per read.'
}

/** Human-readable command shape shown in Settings for built-in terminal presets. */
export function terminalPreferenceCommandHint(preference: TerminalPreference): string {
  if (preference === 'auto') return 'Auto-detect the best terminal for this platform'
  if (preference === 'windows-terminal') return 'wt.exe -d %TARGET_PATH%'
  if (preference === 'powershell') return 'powershell.exe -NoExit -Command Set-Location %TARGET_PATH%'
  if (preference === 'cmd') return 'cmd.exe /k cd /d %TARGET_PATH%'
  if (preference === 'git-bash') return 'git-bash.exe --cd=%TARGET_PATH%'
  if (preference === 'terminal') return 'open -a Terminal %TARGET_PATH%'
  if (preference === 'iterm') return 'open -a iTerm %TARGET_PATH%'
  if (preference === 'gnome-terminal') return 'gnome-terminal --working-directory=%TARGET_PATH%'
  if (preference === 'konsole') return 'konsole --workdir %TARGET_PATH%'
  if (preference === 'alacritty') return 'alacritty --working-directory %TARGET_PATH%'
  if (preference === 'wezterm') return 'wezterm start --cwd %TARGET_PATH%'
  return ''
}
