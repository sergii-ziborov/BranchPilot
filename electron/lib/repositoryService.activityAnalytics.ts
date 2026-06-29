import { createHash } from 'node:crypto'
import type { CommandRunResult } from './commandRunner.js'
import type {
  CoAuthor,
  ContributionDay,
  ContributionGraph,
  ContributorIdentity,
  ContributorStat,
  ContributorStatsRequest,
  ContributorStatsWindow,
  RecentRepository,
  RepositoryScopeRequest,
  RepositoryRhythm
} from '../../src/shared/branchPilot.js'
import { computeRhythm, rhythmLogArgs } from './rhythmAnalytics.js'

interface ContributorAccumulator {
  stat: ContributorStat
  aliases: Map<string, ContributorIdentity>
  emails: Set<string>
}

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
    const repoPaths = await this.resolveScopePaths(normalizedRequest)
    const timeArgs = contributorStatsTimeArgs(normalizedRequest)

    const logs = await Promise.all(
      repoPaths.map(async (candidate) => {
        try {
          const args = ['log', '--format=%an\t%ae\t%ad', '--date=short', '-n', '8000']
          args.push(...timeArgs)
          const result = await this.kernel.git(candidate, args, {
            allowedExitCodes: [0, 128, 129]
          })
          return result.exitCode === 0 ? result.stdout : ''
        } catch {
          return ''
        }
      })
    )

    const contributors = new Map<string, ContributorAccumulator>()
    const emailToContributorKey = new Map<string, string>()
    const nameToContributorKey = new Map<string, string>()
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
        const emailKey = email.toLowerCase()
        const nameKey = contributorNameKey(name)
        const emailContributorKey = emailToContributorKey.get(emailKey)
        const nameContributorKey = nameToContributorKey.get(nameKey)
        const contributorKey = emailContributorKey && nameContributorKey && emailContributorKey !== nameContributorKey
          ? mergeContributorGroups(contributors, emailToContributorKey, nameToContributorKey, emailContributorKey, nameContributorKey)
          : emailContributorKey ?? nameContributorKey ?? `person:${nameKey || emailKey}`
        const contributor = contributors.get(contributorKey) ?? createContributorAccumulator(name, email, date)
        const aliasKey = `${nameKey}\t${emailKey}`
        const alias = contributor.aliases.get(aliasKey)

        if (alias) {
          alias.commits += 1
          if (date > alias.lastCommitAt) alias.lastCommitAt = date
        } else {
          contributor.aliases.set(aliasKey, { name, email, commits: 1, lastCommitAt: date })
        }

        contributor.stat.commits += 1
        contributor.emails.add(email)
        emailToContributorKey.set(emailKey, contributorKey)
        nameToContributorKey.set(nameKey, contributorKey)

        const profileFields = contributorProfileFields(name, email)
        if (profileFields.profileUrl || !contributor.stat.profileUrl) {
          Object.assign(contributor.stat, profileFields)
        }

        if (date > contributor.stat.lastCommitAt) {
          contributor.stat.lastCommitAt = date
          contributor.stat.name = name
          contributor.stat.email = email
        }

        contributors.set(contributorKey, contributor)
      }
    }

    return [...contributors.values()]
      .map((contributor) => ({
        ...contributor.stat,
        emails: [...contributor.emails],
        share: total > 0 ? contributor.stat.commits / total : 0,
        aliases: [...contributor.aliases.values()]
          .sort((first, second) => second.commits - first.commits || second.lastCommitAt.localeCompare(first.lastCommitAt))
      }))
      .sort((first, second) => second.commits - first.commits)
      .slice(0, 50)
  }

  /** Commit activity over the last ~53 weeks, aggregated for a GitHub-style heatmap. */
  async getContributionGraph(request?: string | RepositoryScopeRequest): Promise<ContributionGraph> {
    const repoPaths = await this.resolveScopePaths(normalizeRepositoryScopeRequest(request))

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

  private async resolveScopePaths(scope: RepositoryScopeRequest): Promise<string[]> {
    const explicitPaths = normalizeScopePathList([
      ...(scope.repoPaths ?? []),
      ...(scope.repoPath ? [scope.repoPath] : [])
    ])

    if (explicitPaths.length > 0) {
      const resolved = await Promise.all(explicitPaths.map((repoPath) => this.kernel.resolveRepositoryRoot(repoPath)))
      return normalizeScopePathList(resolved)
    }

    return (await this.kernel.getRecentRepositories()).slice(0, 24).map((repo) => repo.path)
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

function createContributorAccumulator(name: string, email: string, date: string): ContributorAccumulator {
  return {
    stat: {
      ...contributorProfileFields(name, email),
      name,
      email,
      emails: [email],
      commits: 0,
      share: 0,
      lastCommitAt: date
    },
    aliases: new Map(),
    emails: new Set([email])
  }
}

function mergeContributorGroups(
  contributors: Map<string, ContributorAccumulator>,
  emailToContributorKey: Map<string, string>,
  nameToContributorKey: Map<string, string>,
  targetKey: string,
  sourceKey: string
): string {
  const target = contributors.get(targetKey)
  const source = contributors.get(sourceKey)

  if (!target || !source) {
    return target ? targetKey : sourceKey
  }

  target.stat.commits += source.stat.commits
  if (source.stat.lastCommitAt > target.stat.lastCommitAt) {
    target.stat.name = source.stat.name
    target.stat.email = source.stat.email
    target.stat.lastCommitAt = source.stat.lastCommitAt
  }

  if (source.stat.profileUrl && !target.stat.profileUrl) {
    target.stat.login = source.stat.login
    target.stat.profileUrl = source.stat.profileUrl
    target.stat.avatarUrl = source.stat.avatarUrl
  }

  for (const [aliasKey, alias] of source.aliases) {
    target.aliases.set(aliasKey, alias)
  }

  for (const email of source.emails) {
    target.emails.add(email)
    emailToContributorKey.set(email.toLowerCase(), targetKey)
  }

  for (const alias of source.aliases.values()) {
    nameToContributorKey.set(contributorNameKey(alias.name), targetKey)
  }

  contributors.delete(sourceKey)
  contributors.set(targetKey, target)
  return targetKey
}

function normalizeContributorStatsRequest(request?: string | ContributorStatsRequest): RepositoryScopeRequest & { window: ContributorStatsWindow; date?: string } {
  if (typeof request === 'string') {
    return {
      repoPath: request,
      window: 'all'
    }
  }

  return {
    ...(request?.repoPath ? { repoPath: request.repoPath } : {}),
    ...(request?.repoPaths?.length ? { repoPaths: normalizeScopePathList(request.repoPaths) } : {}),
    window: normalizeContributorStatsWindow(request?.window),
    ...(normalizeIsoDate(request?.date) ? { date: normalizeIsoDate(request?.date) } : {})
  }
}

function normalizeRepositoryScopeRequest(request?: string | RepositoryScopeRequest): RepositoryScopeRequest {
  if (typeof request === 'string') {
    return { repoPath: request }
  }

  return {
    ...(request?.repoPath ? { repoPath: request.repoPath } : {}),
    ...(request?.repoPaths?.length ? { repoPaths: normalizeScopePathList(request.repoPaths) } : {})
  }
}

function normalizeScopePathList(paths: string[]): string[] {
  const seen = new Set<string>()
  const normalized: string[] = []

  for (const path of paths) {
    const trimmed = path.trim()
    if (!trimmed) continue
    const key = trimmed.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    normalized.push(trimmed)
  }

  return normalized
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

function contributorStatsTimeArgs(request: { window: ContributorStatsWindow; date?: string }): string[] {
  if (request.window === 'day' && request.date) {
    return [
      `--since=${request.date} 00:00:00`,
      `--before=${nextIsoDate(request.date)} 00:00:00`
    ]
  }

  const sinceArg = contributorStatsSinceArg(request.window)
  return sinceArg ? [sinceArg] : []
}

function normalizeIsoDate(value?: string): string | undefined {
  const trimmed = value?.trim()
  return trimmed && /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : undefined
}

function nextIsoDate(date: string): string {
  const [year = 0, month = 1, day = 1] = date.split('-').map((part) => Number(part))
  const next = new Date(Date.UTC(year, month - 1, day))
  next.setUTCDate(next.getUTCDate() + 1)
  return [
    next.getUTCFullYear(),
    String(next.getUTCMonth() + 1).padStart(2, '0'),
    String(next.getUTCDate()).padStart(2, '0')
  ].join('-')
}

function contributorNameKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ')
}

function contributorProfileFields(_name: string, email: string): Pick<ContributorStat, 'login' | 'avatarUrl' | 'profileUrl'> {
  const login = inferGitHubLogin(email)

  return {
    ...(login
      ? {
          login,
          avatarUrl: `https://github.com/${encodeURIComponent(login)}.png?size=96`,
          profileUrl: `https://github.com/${encodeURIComponent(login)}`
        }
      : {
          avatarUrl: gravatarIdenticonUrl(email)
        })
  }
}

function gravatarIdenticonUrl(email: string): string {
  const hash = createHash('md5').update(email.trim().toLowerCase()).digest('hex')
  return `https://www.gravatar.com/avatar/${hash}?s=96&d=identicon`
}

function inferGitHubLogin(email: string): string | undefined {
  const normalizedEmail = email.trim().toLowerCase()
  const noreplyMatch = normalizedEmail.match(/^(?:\d+\+)?([a-z0-9-]+)@users\.noreply\.github\.com$/)
  if (noreplyMatch?.[1]) return noreplyMatch[1]

  return undefined
}
