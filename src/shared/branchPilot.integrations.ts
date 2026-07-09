export interface EditorOpenRequest {
  targetPath: string
  line?: number
  column?: number
  selectionText?: string
}

export type EditorPreference = 'auto' | 'vscode' | 'cursor' | 'webstorm' | 'rider' | 'sublime' | 'custom'

export interface EditorSettings {
  preference: EditorPreference
  customCommand?: string
  updatedAt?: string
}

export interface EditorSettingsUpdate {
  preference: EditorPreference
  customCommand?: string
}

export type TerminalPreference =
  | 'auto'
  | 'windows-terminal'
  | 'powershell'
  | 'cmd'
  | 'git-bash'
  | 'terminal'
  | 'iterm'
  | 'gnome-terminal'
  | 'konsole'
  | 'alacritty'
  | 'wezterm'
  | 'custom'

export interface TerminalSettings {
  preference: TerminalPreference
  customCommand?: string
  updatedAt?: string
}

export interface TerminalSettingsUpdate {
  preference: TerminalPreference
  customCommand?: string
}

export type GitBackendPreference = 'console' | 'builtin'

export interface GitBackendSettings {
  preference: GitBackendPreference
  updatedAt?: string
}

export interface GitBackendSettingsUpdate {
  preference: GitBackendPreference
}

export interface GitMonitorSettings {
  enabled: boolean
  intervalSeconds: number
  notifyMerged: boolean
  notifyChecks: boolean
  notifyReviews: boolean
  periodicFetch: boolean
  refreshRepoList: boolean
  prefetchReportsGraph: boolean
  refreshAccount: boolean
  syncMemory: boolean
  updatedAt?: string
}

export interface GitMonitorSettingsUpdate {
  enabled?: boolean
  intervalSeconds?: number
  notifyMerged?: boolean
  notifyChecks?: boolean
  notifyReviews?: boolean
  periodicFetch?: boolean
  refreshRepoList?: boolean
  prefetchReportsGraph?: boolean
  refreshAccount?: boolean
  syncMemory?: boolean
}

export type GitHubCliState = 'missing' | 'unauthenticated' | 'authenticated'
export type GitHubAuthProvider = 'none' | 'gh' | 'git-credential'

export interface GitHubCliStatus {
  state: GitHubCliState
  installed: boolean
  authenticated: boolean
  ghAuthenticated: boolean
  gitCredentialAuthenticated: boolean
  authProvider: GitHubAuthProvider
  executable?: string
  username?: string
  message: string
}

export interface CreatePullRequestRequest {
  repoPath: string
  title: string
  description: string
  baseBranch?: string
  headBranch?: string
}
