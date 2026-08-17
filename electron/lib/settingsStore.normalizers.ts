import type {
  AssistantPolicySettings,
  EditorPreference,
  EditorSettings,
  GitBackendPreference,
  GitBackendSettings,
  GitMonitorSettings,
  TerminalPreference,
  TerminalSettings,
  RecentRepository
} from '../../src/shared/branchPilot.js'

/** Shape of the on-disk settings document. */
export interface PersistedSettings {
  recentRepositories: RecentRepository[]
  pinnedRepositoryPaths: string[]
  assistantPolicies: Record<string, AssistantPolicySettings>
  editorSettings: EditorSettings
  terminalSettings: TerminalSettings
  gitBackendSettings: GitBackendSettings
  gitMonitorSettings: GitMonitorSettings
}

export const DEFAULT_SETTINGS: PersistedSettings = {
  recentRepositories: [],
  pinnedRepositoryPaths: [],
  assistantPolicies: {},
  editorSettings: {
    preference: 'vscode'
  },
  terminalSettings: {
    preference: 'auto'
  },
  gitBackendSettings: {
    // The native core answers reads without spawning Git and falls back to the
    // console path whenever it cannot prove a result, so it is the default.
    preference: 'native'
  },
  gitMonitorSettings: {
    enabled: false,
    intervalSeconds: 60,
    notifyMerged: true,
    notifyChecks: true,
    notifyReviews: true,
    periodicFetch: true,
    refreshRepoList: true,
    prefetchReportsGraph: true,
    refreshAccount: true,
    syncMemory: false
  }
}

/** A fresh, fully-owned copy of the defaults (safe to mutate). */
export function defaultSettings(): PersistedSettings {
  return cloneSettings(DEFAULT_SETTINGS)
}

/** Deep copy of a settings document. The document is plain JSON, so a
 * serialize round-trip is both correct and dependency-free. */
export function cloneSettings(settings: PersistedSettings): PersistedSettings {
  return JSON.parse(JSON.stringify(settings)) as PersistedSettings
}

/**
 * Coerces an arbitrary parsed value (anything `JSON.parse` produced) into a
 * fully-populated, valid settings document. Unknown/invalid fields fall back to
 * their defaults rather than throwing, so a partially-corrupt document still
 * yields a usable result instead of blowing away the whole file.
 */
export function normalizeSettings(parsed: unknown): PersistedSettings {
  const candidate = (parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? parsed
    : {}) as Partial<PersistedSettings>

  const pinnedRepositoryPaths = Array.isArray(candidate.pinnedRepositoryPaths)
    ? candidate.pinnedRepositoryPaths.filter(isString)
    : extractInlinePinnedRepositoryPaths(candidate.recentRepositories)

  return {
    recentRepositories: normalizeRecentRepositories(candidate.recentRepositories, pinnedRepositoryPaths),
    pinnedRepositoryPaths,
    assistantPolicies: isAssistantPolicyRecord(candidate.assistantPolicies) ? candidate.assistantPolicies : {},
    editorSettings: normalizeEditorSettings(candidate.editorSettings),
    terminalSettings: normalizeTerminalSettings(candidate.terminalSettings),
    gitBackendSettings: normalizeGitBackendSettings(candidate.gitBackendSettings),
    gitMonitorSettings: normalizeGitMonitorSettings(candidate.gitMonitorSettings)
  }
}

export function normalizeRecentRepositories(value: unknown, pinnedRepositoryPaths: unknown): RecentRepository[] {
  if (!Array.isArray(value)) return []

  const pinnedPaths = new Set(Array.isArray(pinnedRepositoryPaths) ? pinnedRepositoryPaths.filter(isString) : [])

  return value
    .filter((repo): repo is Partial<RecentRepository> =>
      Boolean(repo) &&
      typeof repo === 'object' &&
      typeof repo.path === 'string' &&
      typeof repo.name === 'string' &&
      typeof repo.lastOpenedAt === 'string'
    )
    .map((repo) => ({
      path: repo.path!,
      name: repo.name!,
      lastOpenedAt: repo.lastOpenedAt!,
      pinned: pinnedPaths.has(repo.path!)
    }))
    .sort((first, second) => {
      if (first.pinned !== second.pinned) return first.pinned ? -1 : 1

      return Date.parse(second.lastOpenedAt) - Date.parse(first.lastOpenedAt)
    })
    .slice(0, 12)
}

export function extractInlinePinnedRepositoryPaths(value: unknown): string[] {
  if (!Array.isArray(value)) return []

  return value
    .filter((repo): repo is Partial<RecentRepository> =>
      Boolean(repo) &&
      typeof repo === 'object' &&
      typeof repo.path === 'string' &&
      repo.pinned === true
    )
    .map((repo) => repo.path!)
}

function isString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

export function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

function normalizeEditorSettings(value: unknown): EditorSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ...DEFAULT_SETTINGS.editorSettings }
  }

  const candidate = value as Partial<EditorSettings>

  return {
    preference: normalizeEditorPreference(candidate.preference),
    customCommand: normalizeOptionalString(candidate.customCommand),
    updatedAt: normalizeOptionalString(candidate.updatedAt)
  }
}

export function normalizeEditorPreference(value: unknown): EditorPreference {
  return isEditorPreference(value) ? value : DEFAULT_SETTINGS.editorSettings.preference
}

function isEditorPreference(value: unknown): value is EditorPreference {
  return value === 'auto' ||
    value === 'vscode' ||
    value === 'cursor' ||
    value === 'webstorm' ||
    value === 'rider' ||
    value === 'sublime' ||
    value === 'custom'
}

function normalizeTerminalSettings(value: unknown): TerminalSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ...DEFAULT_SETTINGS.terminalSettings }
  }

  const candidate = value as Partial<TerminalSettings>

  return {
    preference: normalizeTerminalPreference(candidate.preference),
    customCommand: normalizeOptionalString(candidate.customCommand),
    updatedAt: normalizeOptionalString(candidate.updatedAt)
  }
}

export function normalizeTerminalPreference(value: unknown): TerminalPreference {
  return isTerminalPreference(value) ? value : DEFAULT_SETTINGS.terminalSettings.preference
}

function isTerminalPreference(value: unknown): value is TerminalPreference {
  return value === 'auto' ||
    value === 'windows-terminal' ||
    value === 'powershell' ||
    value === 'cmd' ||
    value === 'git-bash' ||
    value === 'terminal' ||
    value === 'iterm' ||
    value === 'gnome-terminal' ||
    value === 'konsole' ||
    value === 'alacritty' ||
    value === 'wezterm' ||
    value === 'custom'
}

function normalizeGitBackendSettings(value: unknown): GitBackendSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ...DEFAULT_SETTINGS.gitBackendSettings }
  }

  const candidate = value as Partial<GitBackendSettings>

  return {
    preference: normalizeGitBackendPreference(candidate.preference),
    updatedAt: normalizeOptionalString(candidate.updatedAt)
  }
}

export function normalizeGitBackendPreference(value: unknown): GitBackendPreference {
  return isGitBackendPreference(value) ? value : DEFAULT_SETTINGS.gitBackendSettings.preference
}

function isGitBackendPreference(value: unknown): value is GitBackendPreference {
  return value === 'console' || value === 'builtin' || value === 'native'
}

const GIT_MONITOR_MIN_INTERVAL_SECONDS = 20
const GIT_MONITOR_MAX_INTERVAL_SECONDS = 600

export function normalizeGitMonitorSettings(value: unknown): GitMonitorSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ...DEFAULT_SETTINGS.gitMonitorSettings }
  }

  const candidate = value as Partial<GitMonitorSettings>
  const defaults = DEFAULT_SETTINGS.gitMonitorSettings

  return {
    enabled: normalizeBoolean(candidate.enabled, defaults.enabled),
    intervalSeconds: normalizeIntervalSeconds(candidate.intervalSeconds),
    notifyMerged: normalizeBoolean(candidate.notifyMerged, defaults.notifyMerged),
    notifyChecks: normalizeBoolean(candidate.notifyChecks, defaults.notifyChecks),
    notifyReviews: normalizeBoolean(candidate.notifyReviews, defaults.notifyReviews),
    periodicFetch: normalizeBoolean(candidate.periodicFetch, defaults.periodicFetch),
    refreshRepoList: normalizeBoolean(candidate.refreshRepoList, defaults.refreshRepoList),
    prefetchReportsGraph: normalizeBoolean(candidate.prefetchReportsGraph, defaults.prefetchReportsGraph),
    refreshAccount: normalizeBoolean(candidate.refreshAccount, defaults.refreshAccount),
    syncMemory: normalizeBoolean(candidate.syncMemory, defaults.syncMemory),
    updatedAt: normalizeOptionalString(candidate.updatedAt)
  }
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function normalizeIntervalSeconds(value: unknown): number {
  const fallback = DEFAULT_SETTINGS.gitMonitorSettings.intervalSeconds
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  const rounded = Math.round(value)
  return Math.min(GIT_MONITOR_MAX_INTERVAL_SECONDS, Math.max(GIT_MONITOR_MIN_INTERVAL_SECONDS, rounded))
}

function isAssistantPolicyRecord(value: unknown): value is Record<string, AssistantPolicySettings> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }

  return Object.values(value).every((entry) => {
    const candidate = entry as Partial<AssistantPolicySettings>

    return typeof candidate.repoPath === 'string' &&
      typeof candidate.mode === 'string' &&
      typeof candidate.updatedAt === 'string'
  })
}
