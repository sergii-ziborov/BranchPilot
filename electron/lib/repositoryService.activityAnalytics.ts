import type { CommandRunResult } from './commandRunner.js'
import type {
  CoAuthor,
  ContributionDay,
  ContributionGraph,
  ContributorStat,
  RecentRepository,
  RepositoryRhythm
} from '../../src/shared/branchPilot.js'
import { computeRhythm, rhythmLogArgs } from './rhythmAnalytics.js'

/**
 * Narrow slice of the repository "kernel" that activity analytics needs. Injected
 * (composition) instead of inherited, so this reporting code is decoupled from the
 * rest of RepositoryService and independently testable.
 */
export interface ActivityAnalyticsKernel {
  resolveRepositoryRoot(selectedPath: string): Promise<string>
  getRecentRepositories(): Promise<RecentRepository[]>
  getConfig(rootPath: string, key: string, scope?: 'local' | 'global'): Promise<string | undefined>
  git(
    cwd: string,
    args: string[],
    options?: { allowedExitCodes?: number[]; input?: string; timeoutMs?: number; maxOutputBytes?: number }
  ): Promise<CommandRunResult>
}

/** Read-only contributor / activity reporting (contributors, leaderboard, heatmap, rhythm). */
export class RepositoryActivityAnalytics {
  constructor(private readonly kernel: ActivityAnalyticsKernel) {}

  /** Repository contributors (from commit history) for co-author suggestions. */
  async getContributors(repoPath: string): Promise<CoAuthor[]> {
    const rootPath = await this.kernel.resolveRepositoryRoot(repoPath)
    const result = await this.kernel.git(rootPath, ['log', '--format=%an\t%ae', '-n', '4000'], {
      allowedExitCodes: [0, 128, 129]
    })
    if (result.exitCode !== 0) return []

    const selfEmail = (await this.kernel.getConfig(rootPath, 'user.email'))?.trim().toLowerCase()
    const seen = new Map<string, CoAuthor>()

    for (const line of result.stdout.split('\n')) {
      const tab = line.indexOf('\t')
      if (tab < 0) continue
      const name = line.slice(0, tab).trim()
      const email = line.slice(tab + 1).trim()
      if (!name || !email) continue
      const key = email.toLowerCase()
      if (key === selfEmail || seen.has(key)) continue
      seen.set(key, { name, email })
    }

    return [...seen.values()].slice(0, 100)
  }

  /**
   * Commit counts per author, ranked for a contributor leaderboard. With a
   * `repoPath` it covers that repository; without one it aggregates across the
   * recent repositories (the "All repositories" report scope).
   */
  async getContributorStats(repoPath?: string): Promise<ContributorStat[]> {
    const repoPaths = repoPath
      ? [await this.kernel.resolveRepositoryRoot(repoPath)]
      : (await this.kernel.getRecentRepositories()).slice(0, 12).map((repo) => repo.path)

    const logs = await Promise.all(
      repoPaths.map(async (candidate) => {
        try {
          const result = await this.kernel.git(candidate, ['log', '--format=%an\t%ae\t%ad', '--date=short', '-n', '8000'], {
            allowedExitCodes: [0, 128, 129]
          })
          return result.exitCode === 0 ? result.stdout : ''
        } catch {
          return ''
        }
      })
    )

    const byEmail = new Map<string, ContributorStat>()
    let total = 0

    for (const stdout of logs) {
      for (const line of stdout.split('\n')) {
        const parts = line.split('\t')
        if (parts.length < 3) continue
        const name = parts[0].trim()
        const email = parts[1].trim()
        const date = parts[2].trim()
        if (!name || !email) continue
        total += 1
        const key = email.toLowerCase()
        const existing = byEmail.get(key)
        if (existing) {
          existing.commits += 1
          if (date > existing.lastCommitAt) {
            existing.lastCommitAt = date
            existing.name = name
          }
        } else {
          byEmail.set(key, { name, email, commits: 1, share: 0, lastCommitAt: date })
        }
      }
    }

    return [...byEmail.values()]
      .map((stat) => ({ ...stat, share: total > 0 ? stat.commits / total : 0 }))
      .sort((first, second) => second.commits - first.commits)
      .slice(0, 50)
  }

  /** Commit activity over the last ~53 weeks, aggregated for a GitHub-style heatmap. */
  async getContributionGraph(repoPath?: string): Promise<ContributionGraph> {
    const repoPaths = repoPath
      ? [repoPath]
      : (await this.kernel.getRecentRepositories()).slice(0, 12).map((repo) => repo.path)

    // Repositories are independent: run the git logs in parallel, then merge.
    const logs = await Promise.all(
      repoPaths.map(async (candidate) => {
        try {
          const result = await this.kernel.git(candidate, ['log', '--since=53 weeks ago', '--pretty=format:%ad', '--date=short'], {
            allowedExitCodes: [0, 128, 129]
          })
          return result.exitCode === 0 ? result.stdout : ''
        } catch {
          // Skip repositories that are unavailable or not valid git checkouts.
          return ''
        }
      })
    )

    const counts = new Map<string, number>()
    for (const stdout of logs) {
      for (const line of stdout.split('\n')) {
        const date = line.trim()
        if (/^\d{4}-\d{2}-\d{2}$/.test(date)) counts.set(date, (counts.get(date) ?? 0) + 1)
      }
    }

    const end = new Date()
    end.setHours(0, 0, 0, 0)
    const start = new Date(end)
    start.setDate(start.getDate() - 7 * 52)
    start.setDate(start.getDate() - start.getDay())

    const days: ContributionDay[] = []
    let total = 0
    for (const cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
      const iso = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`
      const count = counts.get(iso) ?? 0
      total += count
      days.push({ date: iso, count })
    }

    return { days, total }
  }

  /** Cadence / velocity / churn analytics from local git history ("Rhythm"). */
  async getRepositoryRhythm(repoPath?: string): Promise<RepositoryRhythm> {
    const windowDays = 120
    const repoPaths = repoPath
      ? [await this.kernel.resolveRepositoryRoot(repoPath)]
      : (await this.kernel.getRecentRepositories()).slice(0, 12).map((repo) => repo.path)

    const logs = await Promise.all(
      repoPaths.map(async (candidate) => {
        try {
          const result = await this.kernel.git(candidate, rhythmLogArgs(windowDays), { allowedExitCodes: [0, 128, 129] })
          return result.exitCode === 0 ? result.stdout : ''
        } catch {
          return ''
        }
      })
    )

    return computeRhythm(logs, new Date(), windowDays)
  }
}
