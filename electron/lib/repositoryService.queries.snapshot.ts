import path from 'node:path'
import type {
  FileChange,
  RecentRepository,
  RepositorySnapshot,
  RepositoryStatus,
  RepositorySummary
} from '../../src/shared/branchPilot.js'
import { deriveConflicts, deriveCounts, parseGitStatus } from './gitStatusParser.js'
import type { ParsedGitStatus } from './gitStatusParser.js'
import { BuiltinGitReadBackend } from './gitReadBackend/index.js'
import type { GitReadBackend } from './gitReadBackend/index.js'
import {
  normalizeRelativePath,
  pathExists
} from './repositoryService.helpers.js'
import { RepositoryServiceBase } from './repositoryService.base.js'

export abstract class RepositoryServiceSnapshotQueries extends RepositoryServiceBase {
  private readonly builtinGitReadBackend: GitReadBackend = new BuiltinGitReadBackend()

  async getRecentRepositories(): Promise<RecentRepository[]> {
    return this.settings.getRecentRepositories()
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

  protected async getRepositoryStatusContext(rootPath: string, options: {
    includeGitIdentity?: boolean
  } = {}): Promise<{
    summary: RepositorySummary
    status: RepositoryStatus
  }> {
    let parsedStatus = await this.readWorkingTreeStatus(rootPath)

    if (await this.pruneMissingStagedAdds(rootPath, parsedStatus.changes)) {
      parsedStatus = await this.readWorkingTreeStatus(rootPath)
    }
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

  /**
   * Read the working-tree status, routing the change list through the selected
   * git read backend. The console path (`git status --porcelain=v2 --branch`)
   * always runs — it supplies branch metadata (branch, ahead/behind, upstream,
   * headOid) and is the fallback for the change list. When the user selected the
   * built-in backend, its faithful `FileChange[]` replaces the console changes
   * (with counts/conflicts re-derived to stay consistent); on
   * {@link BuiltinBackendUnsupported} or any error it silently keeps the console
   * changes. The default 'console' preference leaves behaviour untouched.
   */
  private async readWorkingTreeStatus(rootPath: string): Promise<ParsedGitStatus> {
    const statusOutput = await this.git(rootPath, ['status', '--porcelain=v2', '-z', '--branch', '--untracked-files=all'])
    const parsedStatus = parseGitStatus(statusOutput.stdout)

    const backend = await this.settings.getGitBackendSettings()
    if (backend.preference !== 'builtin') {
      return parsedStatus
    }

    try {
      const changes = await this.builtinGitReadBackend.readWorkingTreeStatus(rootPath)
      const conflicts = deriveConflicts(changes)
      return {
        ...parsedStatus,
        changes,
        conflicts,
        counts: deriveCounts(changes, conflicts)
      }
    } catch {
      // Built-in backend cannot faithfully represent this repo state (or errored);
      // fall back to the accurate console result.
      return parsedStatus
    }
  }

  private async pruneMissingStagedAdds(rootPath: string, changes: FileChange[]): Promise<boolean> {
    const missingStagedAdds: string[] = []

    for (const change of changes) {
      if (change.stagedStatus !== 'A' || change.unstagedStatus !== 'D') continue

      const relativePath = normalizeRelativePath(change.path)
      if (!await pathExists(path.join(rootPath, relativePath))) {
        missingStagedAdds.push(relativePath)
      }
    }

    if (missingStagedAdds.length === 0) return false

    await this.git(rootPath, ['restore', '--staged', '--', ...missingStagedAdds])
    return true
  }
}
