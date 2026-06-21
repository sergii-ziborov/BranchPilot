import path from 'node:path'
import type {
  BranchCompareRequest,
  BranchComparison,
  BranchSummary,
  CommitDetails,
  CommitDetailsRequest,
  CommitFileDiffRequest,
  CoAuthor,
  CommitSummary,
  ContributionGraph,
  ContributionDay,
  ContributorStat,
  RepositoryRhythm,
  RhythmHotFile,
  RhythmWeek,
  DashboardRepositorySummary,
  DashboardStaleBranch,
  DiffRequest,
  DiffResult,
  GitConfigSnapshot,
  GitLfsSummary,
  RecentRepository,
  RepositoryDashboardSnapshot,
  RepositorySnapshot,
  RepositoryStatus,
  RepositorySummary,
  StashEntry,
  SubmoduleSummary,
  WorktreeSummary
} from '../../src/shared/branchPilot.js'
import { parseUnifiedDiff } from './diffParser.js'
import { BranchPilotUserError } from './errors.js'
import { parseGitStatus } from './gitStatusParser.js'
import {
  normalizeBranchName,
  normalizeCommitSha,
  normalizeRelativePath,
  parseBranchCompareCommitCounts,
  parseCommitSummary,
  parseStashEntry,
  staleBranchesForRepository
} from './repositoryService.helpers.js'
import {
  MAX_BRANCH_COMPARE_SUMMARY_BYTES,
  MAX_DIFF_BYTES,
  MAX_DIFF_OUTPUT_BYTES
} from './repositoryService.base.js'
import { STALE_BRANCH_THRESHOLD_DAYS } from './repositoryService.constants.js'
import { RepositoryServiceBase } from './repositoryService.base.js'

export abstract class RepositoryServiceQueries extends RepositoryServiceBase {
  async getRecentRepositories(): Promise<RecentRepository[]> {
    return this.settings.getRecentRepositories()
  }

  /** Repository contributors (from commit history) for co-author suggestions. */
  async getContributors(repoPath: string): Promise<CoAuthor[]> {
    const rootPath = await this.resolveRepositoryRoot(repoPath)
    const result = await this.git(rootPath, ['log', '--format=%an\t%ae', '-n', '4000'], {
      allowedExitCodes: [0, 128, 129]
    })
    if (result.exitCode !== 0) return []

    const selfEmail = (await this.getConfig(rootPath, 'user.email'))?.trim().toLowerCase()
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
      ? [await this.resolveRepositoryRoot(repoPath)]
      : (await this.settings.getRecentRepositories()).slice(0, 12).map((repo) => repo.path)

    const logs = await Promise.all(
      repoPaths.map(async (candidate) => {
        try {
          const result = await this.git(candidate, ['log', '--format=%an\t%ae\t%ad', '--date=short', '-n', '8000'], {
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
      : (await this.settings.getRecentRepositories()).slice(0, 12).map((repo) => repo.path)

    // Repositories are independent: run the git logs in parallel, then merge.
    const logs = await Promise.all(
      repoPaths.map(async (candidate) => {
        try {
          const result = await this.git(candidate, ['log', '--since=53 weeks ago', '--pretty=format:%ad', '--date=short'], {
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
      ? [await this.resolveRepositoryRoot(repoPath)]
      : (await this.settings.getRecentRepositories()).slice(0, 12).map((repo) => repo.path)

    const MARK = ''
    const logs = await Promise.all(
      repoPaths.map(async (candidate) => {
        try {
          const result = await this.git(
            candidate,
            ['log', `--since=${windowDays} days ago`, `--pretty=format:${MARK}%ad`, '--date=short', '--numstat'],
            { allowedExitCodes: [0, 128, 129] }
          )
          return result.exitCode === 0 ? result.stdout : ''
        } catch {
          return ''
        }
      })
    )

    const dayMs = 86_400_000
    const dayNumber = (iso: string) => {
      const [y, m, d] = iso.split('-').map(Number)
      return Math.floor(Date.UTC(y, m - 1, d) / dayMs)
    }
    const isoOf = (num: number) => new Date(num * dayMs).toISOString().slice(0, 10)
    const weekStartOf = (iso: string) => {
      const dt = new Date(`${iso}T00:00:00Z`)
      dt.setUTCDate(dt.getUTCDate() - dt.getUTCDay())
      return dt.toISOString().slice(0, 10)
    }

    const todayNum = Math.floor(Date.now() / dayMs)
    const todayISO = isoOf(todayNum)

    const activeDayNums = new Set<number>()
    const commitDates: string[] = []
    const weekCounts = new Map<string, number>()
    const fileStats = new Map<string, RhythmHotFile>()
    let linesAdded30 = 0
    let linesRemoved30 = 0

    for (const stdout of logs) {
      let currentDate = ''
      let currentNum = 0
      for (const rawLine of stdout.split('\n')) {
        const line = rawLine.replace(/\r$/, '')
        if (line.startsWith(MARK)) {
          currentDate = line.slice(1).trim()
          if (!/^\d{4}-\d{2}-\d{2}$/.test(currentDate)) { currentDate = ''; continue }
          currentNum = dayNumber(currentDate)
          activeDayNums.add(currentNum)
          commitDates.push(currentDate)
          const ws = weekStartOf(currentDate)
          weekCounts.set(ws, (weekCounts.get(ws) ?? 0) + 1)
          continue
        }
        if (!currentDate) continue
        const parts = line.split('\t')
        if (parts.length < 3) continue
        const within30 = todayNum - currentNum <= 29
        if (!within30) continue
        const added = parts[0] === '-' ? 0 : Number(parts[0])
        const removed = parts[1] === '-' ? 0 : Number(parts[1])
        const file = parts.slice(2).join('\t').trim()
        if (!file) continue
        linesAdded30 += Number.isFinite(added) ? added : 0
        linesRemoved30 += Number.isFinite(removed) ? removed : 0
        const existing = fileStats.get(file)
        if (existing) {
          existing.commits += 1
          existing.added += Number.isFinite(added) ? added : 0
          existing.removed += Number.isFinite(removed) ? removed : 0
        } else {
          fileStats.set(file, { path: file, commits: 1, added: Number.isFinite(added) ? added : 0, removed: Number.isFinite(removed) ? removed : 0 })
        }
      }
    }

    // Cadence: current streak (counts back from today, or yesterday if today is idle).
    let currentStreakDays = 0
    let probe = activeDayNums.has(todayNum) ? todayNum : todayNum - 1
    while (activeDayNums.has(probe)) {
      currentStreakDays += 1
      probe -= 1
    }

    // Longest streak inside the window.
    const sortedDays = [...activeDayNums].sort((a, b) => a - b)
    let longestStreakDays = sortedDays.length > 0 ? 1 : 0
    let run = sortedDays.length > 0 ? 1 : 0
    for (let i = 1; i < sortedDays.length; i += 1) {
      run = sortedDays[i] - sortedDays[i - 1] === 1 ? run + 1 : 1
      if (run > longestStreakDays) longestStreakDays = run
    }

    const activeDaysLast30 = [...activeDayNums].filter((num) => todayNum - num <= 29 && todayNum - num >= 0).length
    const commits30 = commitDates.filter((iso) => todayNum - dayNumber(iso) <= 29).length
    const avgCommitsPerActiveDay = activeDaysLast30 > 0 ? commits30 / activeDaysLast30 : 0

    // Velocity: this week vs last week + last 8 weeks for a sparkline.
    const currentWeekStart = weekStartOf(todayISO)
    const lastWeekStart = isoOf(dayNumber(currentWeekStart) - 7)
    const commitsThisWeek = weekCounts.get(currentWeekStart) ?? 0
    const commitsLastWeek = weekCounts.get(lastWeekStart) ?? 0

    const weeklyCommits: RhythmWeek[] = []
    for (let i = 7; i >= 0; i -= 1) {
      const ws = isoOf(dayNumber(currentWeekStart) - i * 7)
      weeklyCommits.push({ weekStart: ws, commits: weekCounts.get(ws) ?? 0 })
    }

    const hotFiles = [...fileStats.values()]
      .sort((a, b) => b.commits - a.commits || b.added + b.removed - (a.added + a.removed))
      .slice(0, 5)

    return {
      generatedAt: new Date().toISOString(),
      windowDays,
      currentStreakDays,
      longestStreakDays,
      activeDaysLast30,
      commitsThisWeek,
      commitsLastWeek,
      avgCommitsPerActiveDay,
      weeklyCommits,
      linesAdded30,
      linesRemoved30,
      hotFiles
    }
  }

  async getRepositoryDashboard(repoPath?: string): Promise<RepositoryDashboardSnapshot> {
    const recentRepositories = await this.settings.getRecentRepositories()
    const activeRootPath = repoPath ? await this.resolveRepositoryRoot(repoPath) : undefined
    const activeRecent = activeRootPath
      ? recentRepositories.find((repo) => repo.path === activeRootPath)
      : undefined
    const repositories = activeRootPath && !activeRecent
      ? [
          {
            path: activeRootPath,
            name: path.basename(activeRootPath),
            lastOpenedAt: new Date().toISOString(),
            pinned: false
          },
          ...recentRepositories
        ]
      : recentRepositories

    const entries = await Promise.all(
      repositories.map((repo) => this.getDashboardRepository(repo, activeRootPath))
    )
    const staleBranches = entries.flatMap((entry) => entry.staleBranches)
    const dashboardRepositories = entries.map((entry) => entry.repository)

    return {
      generatedAt: new Date().toISOString(),
      staleBranchThresholdDays: STALE_BRANCH_THRESHOLD_DAYS,
      repositories: dashboardRepositories,
      staleBranches,
      totals: {
        repositories: dashboardRepositories.length,
        dirty: dashboardRepositories.filter((repo) => repo.state === 'dirty').length,
        conflicted: dashboardRepositories.filter((repo) => repo.state === 'conflicted').length,
        unavailable: dashboardRepositories.filter((repo) => repo.state === 'unavailable').length,
        ahead: dashboardRepositories.reduce((sum, repo) => sum + repo.ahead, 0),
        behind: dashboardRepositories.reduce((sum, repo) => sum + repo.behind, 0),
        staleBranches: staleBranches.length
      }
    }
  }

  async getSnapshot(repoPath: string): Promise<RepositorySnapshot> {
    const rootPath = await this.resolveRepositoryRoot(repoPath)
    const { summary, status } = await this.getRepositoryStatusContext(rootPath, { includeGitIdentity: true })
    const [branches, remoteBranches, tags, worktrees, submodules, lfs, recentRepositories] = await Promise.all([
      this.listBranches(rootPath),
      this.listRemoteBranches(rootPath),
      this.listTags(rootPath),
      this.listRepositoryWorktrees(rootPath),
      this.listRepositorySubmodules(rootPath),
      this.getRepositoryGitLfsSummary(rootPath),
      this.settings.getRecentRepositories()
    ])

    return this.cacheSnapshot({
      summary,
      status,
      branches,
      remoteBranches,
      tags,
      worktrees,
      submodules,
      lfs,
      recentRepositories
    })
  }

  protected async getStatusOnlySnapshot(rootPath: string): Promise<RepositorySnapshot> {
    const cachedSnapshot = this.snapshotCache.get(rootPath)

    if (!cachedSnapshot) {
      return this.getSnapshot(rootPath)
    }

    const { summary, status } = await this.getRepositoryStatusContext(rootPath, { includeGitIdentity: true })
    const recentRepositories = await this.settings.getRecentRepositories()

    return this.cacheSnapshot({
      ...cachedSnapshot,
      summary,
      status,
      recentRepositories
    })
  }

  protected async getDashboardRepository(repo: RecentRepository, activeRootPath?: string): Promise<{
    repository: DashboardRepositorySummary
    staleBranches: DashboardStaleBranch[]
  }> {
    try {
      const context = await this.getDashboardRepositoryContext(repo.path)
      const state = context.status.counts.conflicted > 0 || context.status.merge.operation !== 'none'
        ? 'conflicted'
        : context.status.counts.changed > 0
          ? 'dirty'
          : 'clean'

      return {
        repository: {
          path: context.summary.rootPath,
          name: context.summary.name,
          pinned: repo.pinned,
          active: context.summary.rootPath === activeRootPath,
          state,
          currentBranch: context.summary.currentBranch,
          upstream: context.summary.upstream,
          remoteName: context.summary.remoteName,
          ahead: context.summary.ahead,
          behind: context.summary.behind,
          changed: context.status.counts.changed,
          staged: context.status.counts.staged,
          unstaged: context.status.counts.unstaged,
          untracked: context.status.counts.untracked,
          conflicted: context.status.counts.conflicted,
          mergeOperation: context.status.merge.operation,
          lastOpenedAt: repo.lastOpenedAt
        },
        staleBranches: staleBranchesForRepository(context.summary.rootPath, context.summary.name, context.branches)
      }
    } catch (error) {
      return {
        repository: {
          path: repo.path,
          name: repo.name,
          pinned: repo.pinned,
          active: repo.path === activeRootPath,
          state: 'unavailable',
          ahead: 0,
          behind: 0,
          changed: 0,
          staged: 0,
          unstaged: 0,
          untracked: 0,
          conflicted: 0,
          mergeOperation: 'none',
          lastOpenedAt: repo.lastOpenedAt,
          error: error instanceof Error ? error.message : 'Repository is unavailable.'
        },
        staleBranches: []
      }
    }
  }

  protected async getDashboardRepositoryContext(repoPath: string): Promise<{
    summary: RepositorySummary
    status: RepositoryStatus
    branches: BranchSummary[]
  }> {
    const rootPath = await this.resolveRepositoryRoot(repoPath)
    const [context, branches] = await Promise.all([
      this.getRepositoryStatusContext(rootPath),
      this.listBranches(rootPath, { includeDescriptions: false })
    ])

    return {
      ...context,
      branches
    }
  }

  protected async getRepositoryStatusContext(rootPath: string, options: {
    includeGitIdentity?: boolean
  } = {}): Promise<{
    summary: RepositorySummary
    status: RepositoryStatus
  }> {
    const statusOutput = await this.git(rootPath, ['status', '--porcelain=v2', '-z', '--branch'])
    const parsedStatus = parseGitStatus(statusOutput.stdout)
    const gitUserName = options.includeGitIdentity ? this.getConfig(rootPath, 'user.name') : Promise.resolve(undefined)
    const gitUserEmail = options.includeGitIdentity ? this.getConfig(rootPath, 'user.email') : Promise.resolve(undefined)
    const [remote, resolvedUserName, resolvedUserEmail, merge] = await Promise.all([
      this.getPrimaryRemote(rootPath),
      gitUserName,
      gitUserEmail,
      this.getMergeState(rootPath, parsedStatus.conflicts)
    ])

    const summary: RepositorySummary = {
      rootPath,
      name: path.basename(rootPath),
      currentBranch: parsedStatus.branch || 'Unknown',
      headOid: parsedStatus.headOid,
      upstream: parsedStatus.upstream,
      ahead: parsedStatus.ahead,
      behind: parsedStatus.behind,
      remoteName: remote?.name,
      remoteUrl: remote?.url,
      isDetached: parsedStatus.isDetached,
      gitUserName: resolvedUserName,
      gitUserEmail: resolvedUserEmail
    }

    return {
      summary,
      status: {
        summary,
        changes: parsedStatus.changes,
        counts: parsedStatus.counts,
        merge
      }
    }
  }

  async getDiff(request: DiffRequest): Promise<DiffResult> {
    const rootPath = await this.resolveRepositoryRoot(request.repoPath)
    const relativePath = normalizeRelativePath(request.filePath)

    if (!request.staged && await this.isUntracked(rootPath, relativePath)) {
      return this.getUntrackedFilePreview(rootPath, relativePath)
    }

    const context = Number.isFinite(request.contextLines) ? Math.max(0, Math.min(100000, Math.trunc(request.contextLines as number))) : 3
    const args = ['diff', '--no-ext-diff', `--unified=${context}`]

    if (request.staged) {
      args.push('--cached')
    }

    if (request.ignoreWhitespace) {
      args.push('--ignore-all-space')
    }

    args.push('--', relativePath)

    const result = await this.git(rootPath, args, {
      allowedExitCodes: [0, 1],
      maxOutputBytes: MAX_DIFF_OUTPUT_BYTES
    })
    const binary = result.stdout.includes('Binary files') || result.stdout.includes('GIT binary patch')
    const tooLarge = Boolean(result.stdoutTruncated) || result.stdout.length > MAX_DIFF_BYTES

    const text = tooLarge ? result.stdout.slice(0, MAX_DIFF_BYTES) : result.stdout

    return {
      filePath: relativePath,
      staged: request.staged,
      text,
      binary,
      tooLarge,
      files: binary || tooLarge ? [] : parseUnifiedDiff(text)
    }
  }

  async getHistory(repoPath: string): Promise<CommitSummary[]> {
    const rootPath = await this.resolveRepositoryRoot(repoPath)
    const result = await this.git(rootPath, [
      'log',
      '--max-count=200',
      '--date=iso-strict',
      '--pretty=format:%H%x00%h%x00%s%x00%an%x00%ae%x00%ad'
    ], {
      allowedExitCodes: [0, 128]
    })

    if (result.exitCode !== 0 || !result.stdout.trim()) {
      return []
    }

    return result.stdout
      .split('\n')
      .filter(Boolean)
      .map(parseCommitSummary)
  }

  async getCommitDetails(request: CommitDetailsRequest): Promise<CommitDetails> {
    const rootPath = await this.resolveRepositoryRoot(request.repoPath)
    const commitSha = normalizeCommitSha(request.commitSha)
    const metadata = await this.git(rootPath, [
      'show',
      '-s',
      '--date=iso-strict',
      '--format=%H%x00%h%x00%s%x00%b%x00%an%x00%ae%x00%ad',
      commitSha
    ])
    const [sha, shortSha, subject, body, authorName, authorEmail, authoredAt] = metadata.stdout.split('\0')

    return {
      sha,
      shortSha,
      subject,
      body: body.trim(),
      authorName,
      authorEmail,
      authoredAt: authoredAt.trim(),
      files: await this.getCommitFiles(rootPath, commitSha),
      containingBranches: await this.getCommitContainingBranches(rootPath, commitSha)
    }
  }

  async getCommitFileDiff(request: CommitFileDiffRequest): Promise<DiffResult> {
    const rootPath = await this.resolveRepositoryRoot(request.repoPath)
    const commitSha = normalizeCommitSha(request.commitSha)
    const filePath = normalizeRelativePath(request.filePath)
    const result = await this.git(rootPath, ['show', '--format=', '--no-ext-diff', commitSha, '--', filePath], {
      allowedExitCodes: [0, 1],
      maxOutputBytes: MAX_DIFF_OUTPUT_BYTES
    })
    const binary = result.stdout.includes('Binary files') || result.stdout.includes('GIT binary patch')
    const tooLarge = Boolean(result.stdoutTruncated) || result.stdout.length > MAX_DIFF_BYTES

    const text = tooLarge ? result.stdout.slice(0, MAX_DIFF_BYTES) : result.stdout

    return {
      filePath,
      staged: false,
      text,
      binary,
      tooLarge,
      files: binary || tooLarge ? [] : parseUnifiedDiff(text)
    }
  }

  async getGitConfig(repoPath: string): Promise<GitConfigSnapshot> {
    const rootPath = await this.resolveRepositoryRoot(repoPath)
    const localUserName = await this.getConfig(rootPath, 'user.name', 'local')
    const localUserEmail = await this.getConfig(rootPath, 'user.email', 'local')
    const globalUserName = await this.getConfig(rootPath, 'user.name', 'global')
    const globalUserEmail = await this.getConfig(rootPath, 'user.email', 'global')
    const localSigning = await this.getConfig(rootPath, 'commit.gpgsign', 'local')
    const globalSigning = await this.getConfig(rootPath, 'commit.gpgsign', 'global')
    const signingValue = localSigning ?? globalSigning
    const remotes = await this.listRemotes(rootPath)
    const defaultBranch = await this.getDefaultBranch(rootPath, remotes)

    return {
      localUserName,
      localUserEmail,
      globalUserName,
      globalUserEmail,
      effectiveUserName: localUserName ?? globalUserName,
      effectiveUserEmail: localUserEmail ?? globalUserEmail,
      defaultBranch: defaultBranch.name,
      defaultBranchSource: defaultBranch.source,
      defaultBranchRemote: defaultBranch.remote,
      commitSigningEnabled: signingValue ? signingValue === 'true' : undefined,
      commitSigningSource: localSigning ? 'local' : globalSigning ? 'global' : 'unset',
      remotes
    }
  }

  async listStashes(repoPath: string): Promise<StashEntry[]> {
    const rootPath = await this.resolveRepositoryRoot(repoPath)
    const result = await this.git(rootPath, ['stash', 'list', '--format=%gd%x00%H%x00%cr%x00%gs'], {
      allowedExitCodes: [0]
    })

    return result.stdout
      .split('\n')
      .filter(Boolean)
      .map(parseStashEntry)
  }

  async compareBranch(request: BranchCompareRequest): Promise<BranchComparison> {
    const rootPath = await this.resolveRepositoryRoot(request.repoPath)
    const baseBranch = normalizeBranchName(request.baseBranch ?? await this.assertCurrentBranch(rootPath, 'compare branches'))
    const targetBranch = normalizeBranchName(request.targetBranch)

    await this.assertLocalBranchExists(rootPath, baseBranch)
    await this.assertLocalBranchExists(rootPath, targetBranch)

    if (baseBranch === targetBranch) {
      throw new BranchPilotUserError('same_branch', 'Choose a different branch to compare.')
    }

    const range = `${baseBranch}...${targetBranch}`
    const commitCounts = await this.git(rootPath, ['rev-list', '--left-right', '--count', range])
    const [baseOnlyCommits, targetOnlyCommits] = parseBranchCompareCommitCounts(commitCounts.stdout)
    const files = await this.getBranchComparisonFiles(rootPath, range)
    const summary = await this.git(rootPath, [
      'diff',
      '--stat',
      '--compact-summary',
      '--find-renames',
      range
    ], {
      maxOutputBytes: MAX_BRANCH_COMPARE_SUMMARY_BYTES
    })

    return {
      baseBranch,
      targetBranch,
      baseOnlyCommits,
      targetOnlyCommits,
      files,
      summaryText: summary.stdout.trim(),
      tooLarge: Boolean(summary.stdoutTruncated)
    }
  }

  async listWorktrees(repoPath: string): Promise<WorktreeSummary[]> {
    const rootPath = await this.resolveRepositoryRoot(repoPath)
    return this.listRepositoryWorktrees(rootPath)
  }

  async listSubmodules(repoPath: string): Promise<SubmoduleSummary[]> {
    const rootPath = await this.resolveRepositoryRoot(repoPath)
    return this.listRepositorySubmodules(rootPath)
  }

  async getGitLfsSummary(repoPath: string): Promise<GitLfsSummary> {
    const rootPath = await this.resolveRepositoryRoot(repoPath)
    return this.getRepositoryGitLfsSummary(rootPath)
  }

}
