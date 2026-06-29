import type { TerminalPreference } from '../../src/shared/branchPilot.js'
import { envValue, uniqueCommands, winJoin } from './editorCommandUtils.js'

export interface TerminalCommand {
  command: string
  args: string[]
  label: string
}

export function buildTerminalCommands(
  preference: TerminalPreference,
  targetPath: string,
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv
): TerminalCommand[] {
  if (preference === 'auto') {
    if (platform === 'win32') {
      return [
        ...buildTerminalCommands('windows-terminal', targetPath, platform, env),
        ...buildTerminalCommands('powershell', targetPath, platform, env),
        ...buildTerminalCommands('git-bash', targetPath, platform, env),
        ...buildTerminalCommands('cmd', targetPath, platform, env)
      ]
    }

    if (platform === 'darwin') {
      return [
        ...buildTerminalCommands('terminal', targetPath, platform, env),
        ...buildTerminalCommands('iterm', targetPath, platform, env)
      ]
    }

    return [
      ...buildTerminalCommands('gnome-terminal', targetPath, platform, env),
      ...buildTerminalCommands('konsole', targetPath, platform, env),
      ...buildTerminalCommands('alacritty', targetPath, platform, env),
      ...buildTerminalCommands('wezterm', targetPath, platform, env)
    ]
  }

  if (preference === 'windows-terminal') {
    return platform === 'win32' ? [
      { command: 'wt.exe', args: ['-d', targetPath], label: 'Windows Terminal' }
    ] : []
  }

  if (preference === 'powershell') {
    return platform === 'win32' ? [
      {
        command: 'cmd.exe',
        args: ['/d', '/c', 'start', '', 'powershell.exe', '-NoExit', '-Command', `Set-Location -LiteralPath ${quotePowerShellString(targetPath)}`],
        label: 'PowerShell'
      },
      {
        command: 'cmd.exe',
        args: ['/d', '/c', 'start', '', 'pwsh.exe', '-NoExit', '-Command', `Set-Location -LiteralPath ${quotePowerShellString(targetPath)}`],
        label: 'PowerShell'
      }
    ] : []
  }

  if (preference === 'cmd') {
    return platform === 'win32' ? [
      {
        command: 'cmd.exe',
        args: ['/d', '/c', 'start', '', 'cmd.exe', '/k', `cd /d ${quoteWindowsCmdString(targetPath)}`],
        label: 'Command Prompt'
      }
    ] : []
  }

  if (preference === 'git-bash') {
    return platform === 'win32'
      ? getWindowsGitBashCommands(env).map((command) => ({
        command,
        args: [`--cd=${targetPath}`],
        label: 'Git Bash'
      }))
      : []
  }

  if (preference === 'terminal') {
    return platform === 'darwin' ? [
      { command: '/usr/bin/open', args: ['-a', 'Terminal', targetPath], label: 'Terminal' }
    ] : []
  }

  if (preference === 'iterm') {
    return platform === 'darwin' ? [
      { command: '/usr/bin/open', args: ['-a', 'iTerm', targetPath], label: 'iTerm2' },
      { command: '/usr/bin/open', args: ['-a', 'iTerm2', targetPath], label: 'iTerm2' }
    ] : []
  }

  if (preference === 'gnome-terminal') {
    return platform === 'linux' ? [
      { command: 'x-terminal-emulator', args: ['--working-directory', targetPath], label: 'terminal' },
      { command: 'gnome-terminal', args: [`--working-directory=${targetPath}`], label: 'GNOME Terminal' }
    ] : []
  }

  if (preference === 'konsole') {
    return platform === 'linux' ? [
      { command: 'konsole', args: ['--workdir', targetPath], label: 'Konsole' }
    ] : []
  }

  if (preference === 'alacritty') {
    return platform === 'linux' || platform === 'win32' || platform === 'darwin'
      ? [{ command: 'alacritty', args: ['--working-directory', targetPath], label: 'Alacritty' }]
      : []
  }

  if (preference === 'wezterm') {
    return platform === 'linux' || platform === 'win32' || platform === 'darwin'
      ? [{ command: 'wezterm', args: ['start', '--cwd', targetPath], label: 'WezTerm' }]
      : []
  }

  return []
}

export function terminalFailureMessage(preference: TerminalPreference): string {
  if (preference === 'auto') return 'Could not open any supported terminal.'
  if (preference === 'windows-terminal') return 'Could not open Windows Terminal.'
  if (preference === 'powershell') return 'Could not open PowerShell.'
  if (preference === 'cmd') return 'Could not open Command Prompt.'
  if (preference === 'git-bash') return 'Could not open Git Bash.'
  if (preference === 'terminal') return 'Could not open Terminal.'
  if (preference === 'iterm') return 'Could not open iTerm2.'
  if (preference === 'gnome-terminal') return 'Could not open GNOME Terminal.'
  if (preference === 'konsole') return 'Could not open Konsole.'
  if (preference === 'alacritty') return 'Could not open Alacritty.'
  if (preference === 'wezterm') return 'Could not open WezTerm.'
  return 'Could not open the configured terminal.'
}

function getWindowsGitBashCommands(env: NodeJS.ProcessEnv): string[] {
  const localAppData = envValue(env, 'LOCALAPPDATA')
  const userProfile = envValue(env, 'USERPROFILE')
  const programRoots = uniqueCommands([
    envValue(env, 'ProgramFiles'),
    envValue(env, 'ProgramW6432'),
    envValue(env, 'ProgramFiles(x86)')
  ], 'win32')

  return uniqueCommands([
    'git-bash.exe',
    localAppData && winJoin(localAppData, 'Programs', 'Git', 'git-bash.exe'),
    userProfile && winJoin(userProfile, 'scoop', 'apps', 'git', 'current', 'git-bash.exe'),
    ...programRoots.map((root) => winJoin(root, 'Git', 'git-bash.exe'))
  ], 'win32')
}

function quotePowerShellString(value: string): string {
  return `'${value.replaceAll('\'', '\'\'')}'`
}

function quoteWindowsCmdString(value: string): string {
  return `"${value.replaceAll('%', '%%').replaceAll('"', '""')}"`
}
