import { promises as fs } from 'node:fs'
import path from 'node:path'
import type {
  AssistantPolicySettings,
  EditorPreference,
  EditorSettings,
  EditorSettingsUpdate,
  RecentRepository
} from '../../src/shared/branchPilot.js'

interface PersistedSettings {
  recentRepositories: RecentRepository[]
  pinnedRepositoryPaths: string[]
  assistantPolicies: Record<string, AssistantPolicySettings>
  editorSettings: EditorSettings
}

const DEFAULT_SETTINGS: PersistedSettings = {
  recentRepositories: [],
  pinnedRepositoryPaths: [],
  assistantPolicies: {},
  editorSettings: {
    preference: 'auto'
  }
}

export class SettingsStore {
  constructor(private readonly filePath: string) {}

  async getRecentRepositories(): Promise<RecentRepository[]> {
    return (await this.read()).recentRepositories
  }

  async rememberRepository(rootPath: string): Promise<RecentRepository[]> {
    const settings = await this.read()
    const recent: RecentRepository = {
      path: rootPath,
      name: path.basename(rootPath),
      lastOpenedAt: new Date().toISOString(),
      pinned: settings.pinnedRepositoryPaths.includes(rootPath)
    }

    settings.recentRepositories = normalizeRecentRepositories([
      recent,
      ...settings.recentRepositories.filter((repo) => repo.path !== rootPath)
    ], settings.pinnedRepositoryPaths)

    await this.write(settings)

    return settings.recentRepositories
  }

  async setRepositoryPinned(rootPath: string, pinned: boolean): Promise<RecentRepository[]> {
    const settings = await this.read()
    const pinnedPaths = new Set(settings.pinnedRepositoryPaths)

    if (pinned) {
      pinnedPaths.add(rootPath)
    } else {
      pinnedPaths.delete(rootPath)
    }

    settings.pinnedRepositoryPaths = [...pinnedPaths]

    if (!settings.recentRepositories.some((repo) => repo.path === rootPath)) {
      settings.recentRepositories = [
        {
          path: rootPath,
          name: path.basename(rootPath),
          lastOpenedAt: new Date().toISOString(),
          pinned
        },
        ...settings.recentRepositories
      ].slice(0, 12)
    }

    settings.recentRepositories = normalizeRecentRepositories(settings.recentRepositories, settings.pinnedRepositoryPaths)

    await this.write(settings)

    return settings.recentRepositories
  }

  async getAssistantPolicy(repoPath: string): Promise<AssistantPolicySettings | undefined> {
    return (await this.read()).assistantPolicies[repoPath]
  }

  async setAssistantPolicy(settings: AssistantPolicySettings): Promise<AssistantPolicySettings> {
    const persisted = await this.read()
    persisted.assistantPolicies[settings.repoPath] = settings
    await this.write(persisted)

    return settings
  }

  async getEditorSettings(): Promise<EditorSettings> {
    return (await this.read()).editorSettings
  }

  async setEditorSettings(update: EditorSettingsUpdate): Promise<EditorSettings> {
    const persisted = await this.read()
    const settings: EditorSettings = {
      preference: normalizeEditorPreference(update.preference),
      customCommand: normalizeOptionalString(update.customCommand),
      updatedAt: new Date().toISOString()
    }

    persisted.editorSettings = settings
    await this.write(persisted)

    return settings
  }

  private async read(): Promise<PersistedSettings> {
    try {
      const raw = await fs.readFile(this.filePath, 'utf8')
      const parsed = JSON.parse(raw) as PersistedSettings
      const pinnedRepositoryPaths = Array.isArray(parsed.pinnedRepositoryPaths)
        ? parsed.pinnedRepositoryPaths.filter(isString)
        : extractInlinePinnedRepositoryPaths(parsed.recentRepositories)

      return {
        recentRepositories: normalizeRecentRepositories(parsed.recentRepositories, pinnedRepositoryPaths),
        pinnedRepositoryPaths,
        assistantPolicies: isAssistantPolicyRecord(parsed.assistantPolicies) ? parsed.assistantPolicies : {},
        editorSettings: normalizeEditorSettings(parsed.editorSettings)
      }
    } catch {
      return {
        recentRepositories: [...DEFAULT_SETTINGS.recentRepositories],
        pinnedRepositoryPaths: [...DEFAULT_SETTINGS.pinnedRepositoryPaths],
        assistantPolicies: { ...DEFAULT_SETTINGS.assistantPolicies },
        editorSettings: { ...DEFAULT_SETTINGS.editorSettings }
      }
    }
  }

  private async write(settings: PersistedSettings): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true })
    await fs.writeFile(this.filePath, JSON.stringify(settings, null, 2), 'utf8')
  }
}

function normalizeRecentRepositories(value: unknown, pinnedRepositoryPaths: unknown): RecentRepository[] {
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

function extractInlinePinnedRepositoryPaths(value: unknown): string[] {
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

function normalizeOptionalString(value: unknown): string | undefined {
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

function normalizeEditorPreference(value: unknown): EditorPreference {
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
