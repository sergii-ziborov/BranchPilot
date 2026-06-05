import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { AssistantPolicySettings, RecentRepository } from '../../src/shared/branchPilot.js'

interface PersistedSettings {
  recentRepositories: RecentRepository[]
  assistantPolicies: Record<string, AssistantPolicySettings>
}

const DEFAULT_SETTINGS: PersistedSettings = {
  recentRepositories: [],
  assistantPolicies: {}
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
      lastOpenedAt: new Date().toISOString()
    }

    settings.recentRepositories = [
      recent,
      ...settings.recentRepositories.filter((repo) => repo.path !== rootPath)
    ].slice(0, 12)

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

  private async read(): Promise<PersistedSettings> {
    try {
      const raw = await fs.readFile(this.filePath, 'utf8')
      const parsed = JSON.parse(raw) as PersistedSettings

      return {
        recentRepositories: Array.isArray(parsed.recentRepositories) ? parsed.recentRepositories : [],
        assistantPolicies: isAssistantPolicyRecord(parsed.assistantPolicies) ? parsed.assistantPolicies : {}
      }
    } catch {
      return {
        recentRepositories: [...DEFAULT_SETTINGS.recentRepositories],
        assistantPolicies: { ...DEFAULT_SETTINGS.assistantPolicies }
      }
    }
  }

  private async write(settings: PersistedSettings): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true })
    await fs.writeFile(this.filePath, JSON.stringify(settings, null, 2), 'utf8')
  }
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
