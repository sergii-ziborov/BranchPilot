import path from 'node:path'
import type {
  BranchCompareRequest,
  BranchComparison,
  BranchSummary,
  CommitDetails,
  CommitDetailsRequest,
  CommitFileDiffRequest,
  CommitSummary,
  DiffRequest,
  DiffResult,
  GitLfsSummary,
  RecentRepository,
  RepositorySnapshot,
  RepositoryStatus,
  RepositorySummary,
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
  parseCommitSummary
} from './repositoryService.helpers.js'
import {
  MAX_BRANCH_COMPARE_SUMMARY_BYTES,
  MAX_DIFF_BYTES,
  MAX_DIFF_OUTPUT_BYTES
} from './repositoryService.base.js'
import { RepositoryServiceBase } from './repositoryService.base.js'

export abstract class RepositoryServiceQueries extends RepositoryServiceBase {
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
