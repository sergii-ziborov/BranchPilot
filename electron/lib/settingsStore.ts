import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { RecentRepository } from '../../src/shared/branchPilot.js'

interface PersistedSettings {
  recentRepositories: RecentRepository[]
}

const DEFAULT_SETTINGS: PersistedSettings = {
  recentRepositories: []
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

  private async read(): Promise<PersistedSettings> {
    try {
      const raw = await fs.readFile(this.filePath, 'utf8')
      const parsed = JSON.parse(raw) as PersistedSettings

      return {
        recentRepositories: Array.isArray(parsed.recentRepositories) ? parsed.recentRepositories : []
      }
    } catch {
      return DEFAULT_SETTINGS
    }
  }

  private async write(settings: PersistedSettings): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true })
    await fs.writeFile(this.filePath, JSON.stringify(settings, null, 2), 'utf8')
  }
}
