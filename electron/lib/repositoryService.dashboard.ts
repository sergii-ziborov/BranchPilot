import path from 'node:path'
import type {
  BranchSummary,
  DashboardRepositorySummary,
  DashboardStaleBranch,
  RecentRepository,
  RepositoryDashboardSnapshot,
  RepositoryStatus,
  RepositorySummary
} from '../../src/shared/branchPilot.js'
import { staleBranchesForRepository } from './repositoryService.helpers.js'
import { STALE_BRANCH_THRESHOLD_DAYS } from './repositoryService.constants.js'

/**
 * Narrow slice of the repository kernel the dashboard scan needs. Injected
 * (composition) so the multi-repo portfolio reporting is decoupled from the rest
 * of RepositoryService.
 */
export interface DashboardKernel {
  resolveRepositoryRoot(selectedPath: string): Promise<string>
  getRecentRepositories(): Promise<RecentRepository[]>
  getRepositoryStatusContext(
    rootPath: string,
    options?: { includeGitIdentity?: boolean }
  ): Promise<{ summary: RepositorySummary; status: RepositoryStatus }>
  listBranches(rootPath: string, options?: { includeDescriptions?: boolean }): Promise<BranchSummary[]>
}

/** Cross-repository "portfolio" scan: working-tree state, sync, conflicts, stale branches. */
export class RepositoryDashboardService {
  constructor(private readonly kernel: DashboardKernel) {}

  async getRepositoryDashboard(repoPath?: string): Promise<RepositoryDashboardSnapshot> {
    const recentRepositories = await this.kernel.getRecentRepositories()
    const activeRootPath = repoPath ? await this.kernel.resolveRepositoryRoot(repoPath) : undefined
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

  private async getDashboardRepository(repo: RecentRepository, activeRootPath?: string): Promise<{
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

  private async getDashboardRepositoryContext(repoPath: string): Promise<{
    summary: RepositorySummary
    status: RepositoryStatus
    branches: BranchSummary[]
  }> {
    const rootPath = await this.kernel.resolveRepositoryRoot(repoPath)
    const [context, branches] = await Promise.all([
      this.kernel.getRepositoryStatusContext(rootPath),
      this.kernel.listBranches(rootPath, { includeDescriptions: false })
    ])

    return {
      ...context,
      branches
    }
  }
}
