import type { CommandRunResult } from './commandRunner.js'
import { createHash } from 'node:crypto'
import type {
  CoAuthor,
  ContributionDay,
  ContributionGraph,
  ContributorIdentity,
  ContributorStat,
  ContributorStatsRequest,
  ContributorStatsWindow,
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
  async getContributorStats(request?: string | ContributorStatsRequest): Promise<ContributorStat[]> {
    const normalizedRequest = normalizeContributorStatsRequest(request)
    const repoPaths = normalizedRequest.repoPath
      ? [await this.kernel.resolveRepositoryRoot(normalizedRequest.repoPath)]
      : (await this.kernel.getRecentRepositories()).slice(0, 12).map((repo) => repo.path)
    const sinceArg = contributorStatsSinceArg(normalizedRequest.window)

    const logs = await Promise.all(
      repoPaths.map(async (candidate) => {
        try {
          const args = ['log', '--format=%an\t%ae\t%ad', '--date=short', '-n', '8000']
          if (sinceArg) args.push(sinceArg)
          const result = await this.kernel.git(candidate, args, {
            allowedExitCodes: [0, 128, 129]
          })
          return result.exitCode === 0 ? result.stdout : ''
        } catch {
          return ''
        }
      })
    )

    const byEmail = new Map<string, ContributorStat>()
    const aliasesByEmail = new Map<string, Map<string, ContributorIdentity>>()
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
        const aliases = aliasesByEmail.get(key) ?? new Map<string, ContributorIdentity>()
        const aliasKey = name.toLowerCase()
        const alias = aliases.get(aliasKey)

        if (alias) {
          alias.commits += 1
          if (date > alias.lastCommitAt) alias.lastCommitAt = date
        } else {
          aliases.set(aliasKey, { name, email, commits: 1, lastCommitAt: date })
        }
        aliasesByEmail.set(key, aliases)

        if (existing) {
          existing.commits += 1
          if (date > existing.lastCommitAt) {
            existing.lastCommitAt = date
            existing.name = name
            Object.assign(existing, contributorProfileFields(name, email))
          }
        } else {
          byEmail.set(key, { ...contributorProfileFields(name, email), name, email, commits: 1, share: 0, lastCommitAt: date })
        }
      }
    }

    return [...byEmail.values()]
      .map((stat) => ({
        ...stat,
        share: total > 0 ? stat.commits / total : 0,
        aliases: [...(aliasesByEmail.get(stat.email.toLowerCase())?.values() ?? [])]
          .sort((first, second) => second.commits - first.commits || second.lastCommitAt.localeCompare(first.lastCommitAt))
      }))
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

function normalizeContributorStatsRequest(request?: string | ContributorStatsRequest): { repoPath?: string; window: ContributorStatsWindow } {
  if (typeof request === 'string') {
    return {
      repoPath: request,
      window: 'all'
    }
  }

  return {
    ...(request?.repoPath ? { repoPath: request.repoPath } : {}),
    window: normalizeContributorStatsWindow(request?.window)
  }
}

function normalizeContributorStatsWindow(window?: ContributorStatsWindow): ContributorStatsWindow {
  return window === 'year' || window === 'month' || window === 'week' || window === 'day'
    ? window
    : 'all'
}

function contributorStatsSinceArg(window: ContributorStatsWindow): string | undefined {
  if (window === 'year') return '--since=1 year ago'
  if (window === 'month') return '--since=1 month ago'
  if (window === 'week') return '--since=1 week ago'
  if (window === 'day') return '--since=1 day ago'
  return undefined
}

function contributorProfileFields(name: string, email: string): Pick<ContributorStat, 'login' | 'avatarUrl' | 'profileUrl' | 'profileSearchUrl'> {
  const login = inferGitHubLogin(email)
  const normalizedEmail = email.trim().toLowerCase()

  return {
    ...(login
      ? {
          login,
          avatarUrl: `https://github.com/${encodeURIComponent(login)}.png?size=96`,
          profileUrl: `https://github.com/${encodeURIComponent(login)}`
        }
      : {
          avatarUrl: `https://www.gravatar.com/avatar/${md5(normalizedEmail)}?s=96&d=identicon`
        }),
    profileSearchUrl: `https://github.com/search?q=${encodeURIComponent(`${name} ${email}`)}&type=users`
  }
}

function inferGitHubLogin(email: string): string | undefined {
  const normalizedEmail = email.trim().toLowerCase()
  const noreplyMatch = normalizedEmail.match(/^(?:\d+\+)?([a-z0-9-]+)@users\.noreply\.github\.com$/)
  if (noreplyMatch?.[1]) return noreplyMatch[1]

  return undefined
}

function md5(value: string): string {
  return createHash('md5').update(value).digest('hex')
}
