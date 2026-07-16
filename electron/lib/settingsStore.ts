import { promises as fs } from 'node:fs'
import path from 'node:path'
import type {
  AssistantPolicySettings,
  EditorSettings,
  EditorSettingsUpdate,
  GitBackendSettings,
  GitBackendSettingsUpdate,
  GitMonitorSettings,
  GitMonitorSettingsUpdate,
  TerminalSettings,
  TerminalSettingsUpdate,
  RecentRepository
} from '../../src/shared/branchPilot.js'
import {
  cloneSettings,
  defaultSettings,
  normalizeEditorPreference,
  normalizeGitBackendPreference,
  normalizeGitMonitorSettings,
  normalizeOptionalString,
  normalizeRecentRepositories,
  normalizeSettings,
  normalizeTerminalPreference,
  type PersistedSettings
} from './settingsStore.normalizers.js'

// A momentarily-locked settings file (antivirus scan, indexer, another write in
// flight) surfaces as one of these. It means "try again", NOT "the data is gone",
// so we retry the read/rename instead of treating the file as empty or corrupt.
const TRANSIENT_FS_CODES = new Set(['EBUSY', 'EPERM', 'EACCES', 'EMFILE', 'ENFILE', 'EAGAIN'])
const FS_RETRY_ATTEMPTS = 4
const FS_RETRY_DELAY_MS = 40

export class SettingsStore {
  // Serialization tail: every read-modify-write chains onto this so two mutations
  // can never interleave (one reading the file the other is mid-write on) and
  // clobber each other — the root cause of "recent repositories keep vanishing".
  private tail: Promise<void> = Promise.resolve()
  // Last settings we successfully read or wrote. Used only as a fallback when the
  // file is momentarily unreadable, so a transient lock can't blank the UI.
  private cache: PersistedSettings | null = null

  constructor(private readonly filePath: string) {}

  async getRecentRepositories(): Promise<RecentRepository[]> {
    return (await this.load()).recentRepositories
  }

  async rememberRepository(rootPath: string): Promise<RecentRepository[]> {
    return this.update((settings) => {
      const recent: RecentRepository = {
        path: rootPath,
        name: path.basename(rootPath),
        lastOpenedAt: new Date().toISOString(),
        pinned: settings.pinnedRepositoryPaths.includes(rootPath)
      }

      settings.recentRepositories = normalizeRecentRepositories(
        [recent, ...settings.recentRepositories.filter((repo) => repo.path !== rootPath)],
        settings.pinnedRepositoryPaths
      )

      return settings.recentRepositories
    })
  }

  async setRepositoryPinned(rootPath: string, pinned: boolean): Promise<RecentRepository[]> {
    return this.update((settings) => {
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

      return settings.recentRepositories
    })
  }

  async getAssistantPolicy(repoPath: string): Promise<AssistantPolicySettings | undefined> {
    return (await this.load()).assistantPolicies[repoPath]
  }

  async setAssistantPolicy(policy: AssistantPolicySettings): Promise<AssistantPolicySettings> {
    return this.update((settings) => {
      settings.assistantPolicies[policy.repoPath] = policy
      return policy
    })
  }

  async getEditorSettings(): Promise<EditorSettings> {
    return (await this.load()).editorSettings
  }

  async setEditorSettings(update: EditorSettingsUpdate): Promise<EditorSettings> {
    return this.update((settings) => {
      settings.editorSettings = {
        preference: normalizeEditorPreference(update.preference),
        customCommand: normalizeOptionalString(update.customCommand),
        updatedAt: new Date().toISOString()
      }

      return settings.editorSettings
    })
  }

  async getTerminalSettings(): Promise<TerminalSettings> {
    return (await this.load()).terminalSettings
  }

  async setTerminalSettings(update: TerminalSettingsUpdate): Promise<TerminalSettings> {
    return this.update((settings) => {
      settings.terminalSettings = {
        preference: normalizeTerminalPreference(update.preference),
        customCommand: normalizeOptionalString(update.customCommand),
        updatedAt: new Date().toISOString()
      }

      return settings.terminalSettings
    })
  }

  async getGitBackendSettings(): Promise<GitBackendSettings> {
    return (await this.load()).gitBackendSettings
  }

  async setGitBackendSettings(update: GitBackendSettingsUpdate): Promise<GitBackendSettings> {
    return this.update((settings) => {
      settings.gitBackendSettings = {
        preference: normalizeGitBackendPreference(update.preference),
        updatedAt: new Date().toISOString()
      }

      return settings.gitBackendSettings
    })
  }

  async getGitMonitorSettings(): Promise<GitMonitorSettings> {
    return (await this.load()).gitMonitorSettings
  }

  async setGitMonitorSettings(update: GitMonitorSettingsUpdate): Promise<GitMonitorSettings> {
    return this.update((settings) => {
      const current = settings.gitMonitorSettings

      settings.gitMonitorSettings = normalizeGitMonitorSettings({
        enabled: update.enabled ?? current.enabled,
        intervalSeconds: update.intervalSeconds ?? current.intervalSeconds,
        notifyMerged: update.notifyMerged ?? current.notifyMerged,
        notifyChecks: update.notifyChecks ?? current.notifyChecks,
        notifyReviews: update.notifyReviews ?? current.notifyReviews,
        periodicFetch: update.periodicFetch ?? current.periodicFetch,
        refreshRepoList: update.refreshRepoList ?? current.refreshRepoList,
        prefetchReportsGraph: update.prefetchReportsGraph ?? current.prefetchReportsGraph,
        refreshAccount: update.refreshAccount ?? current.refreshAccount,
        syncMemory: update.syncMemory ?? current.syncMemory,
        updatedAt: new Date().toISOString()
      })

      return settings.gitMonitorSettings
    })
  }

  /**
   * Runs a read-modify-write as a single serialized step. Every mutator goes
   * through here so concurrent settings changes queue instead of racing. If the
   * read fails because the file is locked (not missing/corrupt), the mutation is
   * aborted rather than persisting defaults over real data.
   */
  private update<T>(mutator: (settings: PersistedSettings) => T): Promise<T> {
    const run = this.tail.then(async () => {
      const settings = await this.readForMutation()
      const result = mutator(settings)
      await this.write(settings)
      this.cache = settings
      return result
    })

    // Keep the chain alive after any individual failure so one aborted mutation
    // doesn't wedge every later one.
    this.tail = run.then(noop, noop)

    return run
  }

  /** Read for display. Never throws and never persists: on a transient failure it
   * falls back to the last good snapshot (then defaults) so the UI never blanks. */
  private async load(): Promise<PersistedSettings> {
    try {
      const settings = await this.readForMutation()
      this.cache = settings
      return settings
    } catch {
      return this.cache ? cloneSettings(this.cache) : defaultSettings()
    }
  }

  /**
   * Reads and normalizes the settings document for a mutation.
   * - missing file (first run) -> defaults
   * - valid file -> its normalized contents
   * - corrupt JSON -> back it up, then recover from the in-memory snapshot if we
   *   have one (self-healing) or fall back to defaults
   * - exists but unreadable after retries (a lock) -> throws, so the caller
   *   aborts instead of overwriting real data with defaults
   */
  private async readForMutation(): Promise<PersistedSettings> {
    const raw = await this.readRaw()

    if (raw === null) {
      return this.cache ? cloneSettings(this.cache) : defaultSettings()
    }

    try {
      return normalizeSettings(JSON.parse(raw))
    } catch {
      await this.backupCorruptFile(raw)
      return this.cache ? cloneSettings(this.cache) : defaultSettings()
    }
  }

  /** Reads the raw file. Returns `null` if it does not exist yet; throws (after
   * retrying transient locks) if it exists but cannot be read. */
  private async readRaw(): Promise<string | null> {
    let lastError: unknown

    for (let attempt = 0; attempt < FS_RETRY_ATTEMPTS; attempt += 1) {
      try {
        return await fs.readFile(this.filePath, 'utf8')
      } catch (error) {
        if (isErrno(error, 'ENOENT')) return null
        lastError = error
        if (!isTransientFsError(error) || attempt === FS_RETRY_ATTEMPTS - 1) break
        await delay(FS_RETRY_DELAY_MS * (attempt + 1))
      }
    }

    throw lastError
  }

  /** Atomic write: serialize to a temp file, then rename over the target. A reader
   * therefore only ever sees a complete document — never a half-written one. */
  private async write(settings: PersistedSettings): Promise<void> {
    const directory = path.dirname(this.filePath)
    await fs.mkdir(directory, { recursive: true })

    const tempPath = `${this.filePath}.${process.pid}.tmp`
    await fs.writeFile(tempPath, JSON.stringify(settings, null, 2), 'utf8')

    try {
      await this.renameWithRetry(tempPath, this.filePath)
    } catch (error) {
      await fs.rm(tempPath, { force: true }).catch(() => {})
      throw error
    }
  }

  private async renameWithRetry(from: string, to: string): Promise<void> {
    let lastError: unknown

    for (let attempt = 0; attempt < FS_RETRY_ATTEMPTS; attempt += 1) {
      try {
        await fs.rename(from, to)
        return
      } catch (error) {
        lastError = error
        if (!isTransientFsError(error) || attempt === FS_RETRY_ATTEMPTS - 1) break
        await delay(FS_RETRY_DELAY_MS * (attempt + 1))
      }
    }

    throw lastError
  }

  /** Preserves an unparseable file so nothing is silently lost before we reset it. */
  private async backupCorruptFile(raw: string): Promise<void> {
    try {
      await fs.writeFile(`${this.filePath}.corrupt-${Date.now()}`, raw, 'utf8')
    } catch {
      // Best effort only — a failed backup must not block recovery.
    }
  }
}

function isErrno(error: unknown, code: string): boolean {
  return Boolean(error) && typeof error === 'object' && (error as NodeJS.ErrnoException).code === code
}

function isTransientFsError(error: unknown): boolean {
  const code = error && typeof error === 'object' ? (error as NodeJS.ErrnoException).code : undefined
  return typeof code === 'string' && TRANSIENT_FS_CODES.has(code)
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function noop(): void {
  // Intentionally empty: swallows a settled mutation so the serialization tail
  // keeps flowing regardless of success or failure.
}
