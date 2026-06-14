import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type {
  BranchCompareRequest,
  BranchComparison,
  BranchSummary,
  CloneRepositoryRequest,
  CommitDetails,
  CommitDetailsRequest,
  CommitFileChange,
  CommitFileDiffRequest,
  ConfirmedCommitReferenceRequest,
  ConfirmedCommitRequest,
  ConfirmedStashActionRequest,
  CommitRequest,
  ApplyPatchRequest,
  CreateStashRequest,
  CreateTagRequest,
  CreateWorktreeRequest,
  DashboardRepositorySummary,
  DashboardStaleBranch,
  DeleteTagRequest,
  RemoveWorktreeRequest,
  CommitSummary,
  DiffRequest,
  DiffResult,
  ExportedPatch,
  ExportPatchRequest,
  FileActionRequest,
  GitLfsFile,
  GitLfsFileStatus,
  GitLfsPattern,
  GitLfsSummary,
  GitConfigSnapshot,
  GitDefaultBranchSource,
  GitIdentityUpdate,
  HunkActionRequest,
  MergeBranchRequest,
  MergeState,
  PublishBranchRequest,
  RecentRepository,
  RepositoryPinRequest,
  RepositoryDashboardSnapshot,
  RemoteBranchSummary,
  RemoteRemoveRequest,
  RemoteSummary,
  RemoteUpsertRequest,
  RepositorySnapshot,
  RepositoryStatus,
  RepositorySummary,
  StashActionRequest,
  StashEntry,
  SubmoduleStatus,
  SubmoduleSummary,
  TagSummary,
  WorktreeSummary,
  UpdateSubmoduleRequest
} from '../../src/shared/branchPilot.js'
import { CommandExecutionError, CommandRunner } from './commandRunner.js'
import { parseUnifiedDiff } from './diffParser.js'
import { BranchPilotUserError } from './errors.js'
import { parseGitStatus } from './gitStatusParser.js'
import { SettingsStore } from './settingsStore.js'
import {
  assertPatchFileExists,
  assertWorktreeTargetAvailable,
  buildCommitMessage,
  cloneNameFromRemoteUrl,
  gitLfsMessage,
  isConflictOutput,
  normalizeBranchName,
  normalizeCloneParentPath,
  normalizeCloneRemoteUrl,
  normalizeCloneTargetName,
  normalizeCommitSha,
  normalizeConfigValue,
  normalizeExistingWorktreePath,
  normalizeGitRef,
  normalizeHunkPatch,
  normalizePatchInputPath,
  normalizePatchOutputPath,
  normalizePatchScope,
  normalizeRelativePath,
  normalizeRemoteName,
  normalizeRemoteUrl,
  normalizeStashMessage,
  normalizeStashRef,
  normalizeTagName,
  normalizeWorktreePath,
  parseBranchCompareCommitCounts,
  parseCommitSummary,
  parseGitLfsFiles,
  parseGitLfsPatterns,
  parseGitLfsVersion,
  parseGitmodulesConfig,
  parseNameStatusRecords,
  parseStashEntry,
  parseSubmoduleStatus,
  parseTagSummary,
  parseWorktreeList,
  pathExists,
  readFilePrefix,
  resolveRepositoryPath,
  staleBranchesForRepository
} from './repositoryService.helpers.js'

const MAX_DIFF_BYTES = 350_000
const MAX_DIFF_OUTPUT_BYTES = MAX_DIFF_BYTES + 1
const MAX_BRANCH_COMPARE_SUMMARY_BYTES = 80_000
const DEFAULT_REMOTE = 'origin'
const STALE_BRANCH_THRESHOLD_DAYS = 30

interface GitDefaultBranchResult {
  name?: string
  source: GitDefaultBranchSource
  remote?: string
}

export class RepositoryService {
  private readonly snapshotCache = new Map<string, RepositorySnapshot>()

  constructor(
    private readonly runner: CommandRunner,
    private readonly settings: SettingsStore
  ) {}

  async openRepository(selectedPath: string): Promise<RepositorySnapshot> {
    const rootPath = await this.resolveRepositoryRoot(selectedPath)
    await this.ensureSupportedRepository(rootPath)
    await this.settings.rememberRepository(rootPath)

    return this.getSnapshot(rootPath)
  }

  async cloneRepository(request: CloneRepositoryRequest): Promise<RepositorySnapshot> {
    const remoteUrl = normalizeCloneRemoteUrl(request.remoteUrl)
    const targetParentPath = normalizeCloneParentPath(request.targetParentPath)
    const targetName = normalizeCloneTargetName(request.targetName ?? cloneNameFromRemoteUrl(remoteUrl))
    const targetPath = path.join(targetParentPath, targetName)
    const parentStats = await fs.stat(targetParentPath).catch(() => undefined)

    if (!parentStats?.isDirectory()) {
      throw new BranchPilotUserError('invalid_clone_target', 'Clone parent folder is not available.')
    }

    if (await pathExists(targetPath)) {
      throw new BranchPilotUserError('clone_target_exists', 'Clone target already exists.')
    }

    await this.runner.run('/usr/bin/git', ['clone', '--', remoteUrl, targetPath], {
      cwd: targetParentPath,
      timeoutMs: 120_000
    })

    return this.openRepository(targetPath)
  }

  async getRecentRepositories(): Promise<RecentRepository[]> {
    return this.settings.getRecentRepositories()
  }

  async setRepositoryPinned(request: RepositoryPinRequest): Promise<RecentRepository[]> {
    const rootPath = await this.resolveRepositoryRoot(request.repoPath)

    return this.settings.setRepositoryPinned(rootPath, request.pinned)
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

  private async getStatusOnlySnapshot(rootPath: string): Promise<RepositorySnapshot> {
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

  private cacheSnapshot(snapshot: RepositorySnapshot): RepositorySnapshot {
    this.snapshotCache.set(snapshot.summary.rootPath, snapshot)
    return snapshot
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

  private async getRepositoryStatusContext(rootPath: string, options: {
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

    const args = ['diff', '--no-ext-diff', '--unified=3']

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

  async setLocalGitIdentity(request: GitIdentityUpdate): Promise<GitConfigSnapshot> {
    const rootPath = await this.resolveRepositoryRoot(request.repoPath)
    const name = normalizeConfigValue(request.name, 'Name')
    const email = normalizeConfigValue(request.email, 'Email')

    await this.git(rootPath, ['config', '--local', 'user.name', name])
    await this.git(rootPath, ['config', '--local', 'user.email', email])

    return this.getGitConfig(rootPath)
  }

  async addRemote(request: RemoteUpsertRequest): Promise<GitConfigSnapshot> {
    const rootPath = await this.resolveRepositoryRoot(request.repoPath)
    const name = normalizeRemoteName(request.name)
    const url = normalizeRemoteUrl(request.url)

    await this.assertRemoteMissing(rootPath, name)
    await this.git(rootPath, ['remote', 'add', name, url])

    return this.getGitConfig(rootPath)
  }

  async setRemoteUrl(request: RemoteUpsertRequest): Promise<GitConfigSnapshot> {
    const rootPath = await this.resolveRepositoryRoot(request.repoPath)
    const name = normalizeRemoteName(request.name)
    const url = normalizeRemoteUrl(request.url)

    await this.assertRemoteExists(rootPath, name)
    await this.git(rootPath, ['remote', 'set-url', name, url])

    return this.getGitConfig(rootPath)
  }

  async removeRemote(request: RemoteRemoveRequest): Promise<GitConfigSnapshot> {
    if (!request.confirmed) {
      throw new BranchPilotUserError('confirmation_required', 'Removing a remote requires explicit confirmation.')
    }

    const rootPath = await this.resolveRepositoryRoot(request.repoPath)
    const name = normalizeRemoteName(request.name)

    await this.assertRemoteExists(rootPath, name)
    await this.git(rootPath, ['remote', 'remove', name])

    return this.getGitConfig(rootPath)
  }

  async stageFile(request: FileActionRequest): Promise<RepositorySnapshot> {
    const rootPath = await this.resolveRepositoryRoot(request.repoPath)
    await this.git(rootPath, ['add', '--', normalizeRelativePath(request.filePath)])
    return this.getStatusOnlySnapshot(rootPath)
  }

  async unstageFile(request: FileActionRequest): Promise<RepositorySnapshot> {
    const rootPath = await this.resolveRepositoryRoot(request.repoPath)
    await this.git(rootPath, ['restore', '--staged', '--', normalizeRelativePath(request.filePath)])
    return this.getStatusOnlySnapshot(rootPath)
  }

  async stageHunk(request: HunkActionRequest): Promise<RepositorySnapshot> {
    const rootPath = await this.resolveRepositoryRoot(request.repoPath)
    const filePath = normalizeRelativePath(request.filePath)
    const patch = normalizeHunkPatch(request.patch, filePath)

    await this.git(rootPath, ['apply', '--cached', '--whitespace=nowarn'], {
      input: patch,
      timeoutMs: 30_000
    })

    return this.getStatusOnlySnapshot(rootPath)
  }

  async unstageHunk(request: HunkActionRequest): Promise<RepositorySnapshot> {
    const rootPath = await this.resolveRepositoryRoot(request.repoPath)
    const filePath = normalizeRelativePath(request.filePath)
    const patch = normalizeHunkPatch(request.patch, filePath)

    await this.git(rootPath, ['apply', '--reverse', '--cached', '--whitespace=nowarn'], {
      input: patch,
      timeoutMs: 30_000
    })

    return this.getStatusOnlySnapshot(rootPath)
  }

  async stageAll(repoPath: string): Promise<RepositorySnapshot> {
    const rootPath = await this.resolveRepositoryRoot(repoPath)
    await this.git(rootPath, ['add', '-A'])
    return this.getStatusOnlySnapshot(rootPath)
  }

  async unstageAll(repoPath: string): Promise<RepositorySnapshot> {
    const rootPath = await this.resolveRepositoryRoot(repoPath)
    await this.git(rootPath, ['restore', '--staged', '--', '.'])
    return this.getStatusOnlySnapshot(rootPath)
  }

  async discardFile(request: FileActionRequest & { confirmed: boolean }): Promise<RepositorySnapshot> {
    if (!request.confirmed) {
      throw new BranchPilotUserError('confirmation_required', 'Discard requires explicit confirmation.')
    }

    const rootPath = await this.resolveRepositoryRoot(request.repoPath)
    await this.git(rootPath, ['restore', '--', normalizeRelativePath(request.filePath)])
    return this.getStatusOnlySnapshot(rootPath)
  }

  async deleteUntrackedFile(request: FileActionRequest & { confirmed: boolean }): Promise<RepositorySnapshot> {
    if (!request.confirmed) {
      throw new BranchPilotUserError('confirmation_required', 'Deleting an untracked file requires explicit confirmation.')
    }

    const rootPath = await this.resolveRepositoryRoot(request.repoPath)
    await this.git(rootPath, ['clean', '-f', '--', normalizeRelativePath(request.filePath)])
    return this.getStatusOnlySnapshot(rootPath)
  }

  async commit(request: CommitRequest): Promise<RepositorySnapshot> {
    const title = request.title.trim()

    if (!title) {
      throw new BranchPilotUserError('invalid_commit_message', 'Commit title is required.')
    }

    const rootPath = await this.resolveRepositoryRoot(request.repoPath)
    const hasNoStagedChanges = await this.git(rootPath, ['diff', '--cached', '--quiet'], {
      allowedExitCodes: [0, 1]
    })

    if (hasNoStagedChanges.exitCode === 0) {
      throw new BranchPilotUserError('nothing_to_commit', 'Stage at least one change before committing.')
    }

    const message = buildCommitMessage(title, request.description, request.coAuthors)
    await this.gitCommitWithMessageFile(rootPath, ['commit', '-F'], message)

    return this.getSnapshot(rootPath)
  }

  async amendCommit(request: ConfirmedCommitRequest): Promise<RepositorySnapshot> {
    if (!request.confirmed) {
      throw new BranchPilotUserError('confirmation_required', 'Amending the last commit requires explicit confirmation.')
    }

    const title = request.title.trim()

    if (!title) {
      throw new BranchPilotUserError('invalid_commit_message', 'Commit title is required.')
    }

    const rootPath = await this.resolveRepositoryRoot(request.repoPath)
    await this.git(rootPath, ['rev-parse', '--verify', 'HEAD'])

    const statusOutput = await this.git(rootPath, ['status', '--porcelain=v2', '-z', '--branch'])
    const parsedStatus = parseGitStatus(statusOutput.stdout)
    const mergeState = await this.getMergeState(rootPath, parsedStatus.conflicts)

    if (mergeState.operation !== 'none') {
      throw new BranchPilotUserError('git_operation_in_progress', `Finish or abort the ${mergeState.operation} before amending.`)
    }

    if (parsedStatus.counts.conflicted > 0) {
      throw new BranchPilotUserError('conflicts_present', 'Resolve conflicted files before amending.')
    }

    const message = buildCommitMessage(title, request.description, request.coAuthors)
    await this.gitCommitWithMessageFile(rootPath, ['commit', '--amend', '-F'], message)

    return this.getSnapshot(rootPath)
  }

  async revertCommit(request: ConfirmedCommitReferenceRequest): Promise<RepositorySnapshot> {
    if (!request.confirmed) {
      throw new BranchPilotUserError('confirmation_required', 'Reverting a commit requires explicit confirmation.')
    }

    const rootPath = await this.resolveRepositoryRoot(request.repoPath)
    const commitSha = normalizeCommitSha(request.commitSha)

    await this.assertNoActiveOperation(rootPath)
    await this.assertNoConflicts(rootPath, 'reverting')

    const result = await this.git(rootPath, ['revert', '--no-edit', commitSha], {
      allowedExitCodes: [0, 1],
      timeoutMs: 120_000
    })

    if (result.exitCode === 0) {
      return this.getSnapshot(rootPath)
    }

    const snapshot = await this.getSnapshot(rootPath)
    const output = [result.stderr, result.stdout].filter(Boolean).join('\n')

    if (snapshot.status.merge.operation !== 'none' || isConflictOutput(output)) {
      return snapshot
    }

    throw new CommandExecutionError(`${result.command} ${result.args.join(' ')} failed with exit code ${result.exitCode}`, result)
  }

  async cherryPickCommit(request: ConfirmedCommitReferenceRequest): Promise<RepositorySnapshot> {
    if (!request.confirmed) {
      throw new BranchPilotUserError('confirmation_required', 'Cherry-picking a commit requires explicit confirmation.')
    }

    const rootPath = await this.resolveRepositoryRoot(request.repoPath)
    const commitSha = normalizeCommitSha(request.commitSha)

    await this.assertNoActiveOperation(rootPath)
    await this.assertNoConflicts(rootPath, 'cherry-picking')

    const result = await this.git(rootPath, ['cherry-pick', commitSha], {
      allowedExitCodes: [0, 1],
      timeoutMs: 120_000
    })

    if (result.exitCode === 0) {
      return this.getSnapshot(rootPath)
    }

    const snapshot = await this.getSnapshot(rootPath)
    const output = [result.stderr, result.stdout].filter(Boolean).join('\n')

    if (snapshot.status.merge.operation !== 'none' || isConflictOutput(output)) {
      return snapshot
    }

    throw new CommandExecutionError(`${result.command} ${result.args.join(' ')} failed with exit code ${result.exitCode}`, result)
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

  async createStash(request: CreateStashRequest): Promise<RepositorySnapshot> {
    const rootPath = await this.resolveRepositoryRoot(request.repoPath)
    const snapshot = await this.getSnapshot(rootPath)

    if (snapshot.status.counts.changed === 0) {
      throw new BranchPilotUserError('nothing_to_stash', 'No local changes to stash.')
    }

    const args = ['stash', 'push']

    if (request.includeUntracked) {
      args.push('-u')
    }

    args.push('-m', normalizeStashMessage(request.message))

    await this.git(rootPath, args, { timeoutMs: 120_000 })

    return this.getStatusOnlySnapshot(rootPath)
  }

  async applyStash(request: StashActionRequest): Promise<RepositorySnapshot> {
    const rootPath = await this.resolveRepositoryRoot(request.repoPath)
    await this.git(rootPath, ['stash', 'apply', normalizeStashRef(request.stashRef)], { timeoutMs: 120_000 })

    return this.getStatusOnlySnapshot(rootPath)
  }

  async dropStash(request: ConfirmedStashActionRequest): Promise<RepositorySnapshot> {
    if (!request.confirmed) {
      throw new BranchPilotUserError('confirmation_required', 'Dropping a stash requires explicit confirmation.')
    }

    const rootPath = await this.resolveRepositoryRoot(request.repoPath)
    await this.git(rootPath, ['stash', 'drop', normalizeStashRef(request.stashRef)], { timeoutMs: 120_000 })

    return this.getStatusOnlySnapshot(rootPath)
  }

  async fetch(repoPath: string): Promise<RepositorySnapshot> {
    const rootPath = await this.resolveRepositoryRoot(repoPath)
    await this.assertHasAnyRemote(rootPath)
    await this.git(rootPath, ['fetch', '--all', '--prune'], { timeoutMs: 120_000 })
    return this.getSnapshot(rootPath)
  }

  async pull(repoPath: string): Promise<RepositorySnapshot> {
    const rootPath = await this.resolveRepositoryRoot(repoPath)
    await this.assertCurrentBranch(rootPath, 'pull')
    await this.assertHasAnyRemote(rootPath)
    await this.assertHasUpstream(rootPath, 'pulling')
    await this.git(rootPath, ['pull', '--ff-only'], { timeoutMs: 120_000 })
    return this.getSnapshot(rootPath)
  }

  async push(repoPath: string): Promise<RepositorySnapshot> {
    const rootPath = await this.resolveRepositoryRoot(repoPath)
    await this.assertCurrentBranch(rootPath, 'push')
    await this.assertHasAnyRemote(rootPath)
    await this.assertHasUpstream(rootPath, 'pushing')
    await this.git(rootPath, ['push'], { timeoutMs: 120_000 })
    return this.getSnapshot(rootPath)
  }

  async publishBranch(request: PublishBranchRequest): Promise<RepositorySnapshot> {
    const rootPath = await this.resolveRepositoryRoot(request.repoPath)
    const currentBranch = await this.assertCurrentBranch(rootPath, 'publish')
    const branch = normalizeBranchName(request.branch || currentBranch)
    const remote = await this.assertRemoteExists(rootPath, request.remote || DEFAULT_REMOTE)

    if (branch !== currentBranch) {
      throw new BranchPilotUserError('invalid_branch', 'Only the checked-out branch can be published.')
    }

    await this.git(rootPath, ['push', '-u', remote, branch], {
      timeoutMs: 120_000
    })

    return this.getSnapshot(rootPath)
  }

  async createBranch(repoPath: string, branchName: string, description?: string): Promise<RepositorySnapshot> {
    const rootPath = await this.resolveRepositoryRoot(repoPath)
    const normalizedName = normalizeBranchName(branchName)
    await this.git(rootPath, ['switch', '-c', normalizedName])

    if (description?.trim()) {
      await this.git(rootPath, [
        'config',
        `branch.${normalizedName}.description`,
        normalizeConfigValue(description, 'Branch description')
      ])
    }

    return this.getSnapshot(rootPath)
  }

  async renameBranch(repoPath: string, oldBranchName: string, newBranchName: string): Promise<RepositorySnapshot> {
    const rootPath = await this.resolveRepositoryRoot(repoPath)
    const oldName = normalizeBranchName(oldBranchName)
    const newName = normalizeBranchName(newBranchName)

    if (oldName === newName) {
      throw new BranchPilotUserError('same_branch', 'Choose a different branch name.')
    }

    await this.assertLocalBranchExists(rootPath, oldName)
    await this.assertBranchDoesNotExist(rootPath, newName)
    await this.git(rootPath, ['branch', '-m', oldName, newName])

    return this.getSnapshot(rootPath)
  }

  async setBranchUpstream(repoPath: string, branchName: string, upstream: string): Promise<RepositorySnapshot> {
    const rootPath = await this.resolveRepositoryRoot(repoPath)
    const normalizedName = normalizeBranchName(branchName)
    const normalizedUpstream = normalizeGitRef(upstream)

    await this.assertLocalBranchExists(rootPath, normalizedName)
    await this.assertRemoteTrackingBranchExists(rootPath, normalizedUpstream)
    await this.git(rootPath, ['branch', `--set-upstream-to=${normalizedUpstream}`, normalizedName])

    return this.getSnapshot(rootPath)
  }

  async updateBranchDescription(repoPath: string, branchName: string, description: string): Promise<RepositorySnapshot> {
    const rootPath = await this.resolveRepositoryRoot(repoPath)
    const normalizedName = normalizeBranchName(branchName)
    await this.assertLocalBranchExists(rootPath, normalizedName)

    if (description.trim()) {
      await this.git(rootPath, [
        'config',
        `branch.${normalizedName}.description`,
        normalizeConfigValue(description, 'Branch description')
      ])
    } else {
      await this.git(rootPath, ['config', '--unset', `branch.${normalizedName}.description`], {
        allowedExitCodes: [0, 5]
      })
    }

    return this.getSnapshot(rootPath)
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

  async switchBranch(repoPath: string, branchName: string): Promise<RepositorySnapshot> {
    const rootPath = await this.resolveRepositoryRoot(repoPath)
    await this.git(rootPath, ['switch', normalizeBranchName(branchName)])
    return this.getSnapshot(rootPath)
  }

  async deleteBranch(repoPath: string, branchName: string, force: boolean, confirmed: boolean): Promise<RepositorySnapshot> {
    if (!confirmed) {
      throw new BranchPilotUserError('confirmation_required', 'Deleting a branch requires explicit confirmation.')
    }

    const rootPath = await this.resolveRepositoryRoot(repoPath)
    const normalizedName = normalizeBranchName(branchName)
    const currentBranch = await this.getCurrentBranch(rootPath)

    if (currentBranch === normalizedName) {
      throw new BranchPilotUserError('git_current_branch', 'Cannot delete the checked-out branch. Switch branches first.')
    }

    await this.git(rootPath, ['branch', force ? '-D' : '-d', normalizedName])
    return this.getSnapshot(rootPath)
  }

  async createTag(request: CreateTagRequest): Promise<RepositorySnapshot> {
    const rootPath = await this.resolveRepositoryRoot(request.repoPath)
    const tagName = normalizeTagName(request.tagName)
    await this.assertValidTagName(rootPath, tagName)

    const message = request.message?.trim()

    if (message) {
      await this.git(rootPath, ['tag', '-a', tagName, '-m', normalizeConfigValue(message, 'Tag message')])
    } else {
      await this.git(rootPath, ['tag', tagName])
    }

    return this.getSnapshot(rootPath)
  }

  async deleteTag(request: DeleteTagRequest): Promise<RepositorySnapshot> {
    if (!request.confirmed) {
      throw new BranchPilotUserError('confirmation_required', 'Deleting a tag requires explicit confirmation.')
    }

    const rootPath = await this.resolveRepositoryRoot(request.repoPath)
    const tagName = normalizeTagName(request.tagName)
    await this.assertValidTagName(rootPath, tagName)
    await this.git(rootPath, ['tag', '-d', tagName])

    return this.getSnapshot(rootPath)
  }

  async listWorktrees(repoPath: string): Promise<WorktreeSummary[]> {
    const rootPath = await this.resolveRepositoryRoot(repoPath)
    return this.listRepositoryWorktrees(rootPath)
  }

  async createWorktree(request: CreateWorktreeRequest): Promise<RepositorySnapshot> {
    const rootPath = await this.resolveRepositoryRoot(request.repoPath)
    const branchName = normalizeBranchName(request.branchName)
    const baseRef = normalizeGitRef(request.baseRef || await this.getCurrentBranch(rootPath) || 'HEAD')
    const targetPath = normalizeWorktreePath(rootPath, request.targetPath)

    await this.assertValidBranchName(rootPath, branchName)
    await this.assertBranchDoesNotExist(rootPath, branchName)
    await this.assertValidBaseRef(rootPath, baseRef)
    await assertWorktreeTargetAvailable(targetPath)
    await this.git(rootPath, ['worktree', 'add', '-b', branchName, targetPath, baseRef], { timeoutMs: 120_000 })

    return this.getSnapshot(rootPath)
  }

  async removeWorktree(request: RemoveWorktreeRequest): Promise<RepositorySnapshot> {
    if (!request.confirmed) {
      throw new BranchPilotUserError('confirmation_required', 'Removing a worktree requires explicit confirmation.')
    }

    if (request.force) {
      throw new BranchPilotUserError('unsupported_force_remove', 'Force removing worktrees is not available in BranchPilot v1.')
    }

    const rootPath = await this.resolveRepositoryRoot(request.repoPath)
    const targetPath = await normalizeExistingWorktreePath(rootPath, request.targetPath)
    const worktree = (await this.listRepositoryWorktrees(rootPath))
      .find((candidate) => path.resolve(candidate.path) === targetPath)

    if (!worktree) {
      throw new BranchPilotUserError('worktree_not_found', 'Worktree is not linked to this repository.')
    }

    if (worktree.current) {
      throw new BranchPilotUserError('current_worktree', 'Cannot remove the currently open worktree.')
    }

    await this.git(rootPath, [
      'worktree',
      'remove',
      ...(request.force ? ['--force'] : []),
      worktree.path
    ], { timeoutMs: 120_000 })

    return this.getSnapshot(rootPath)
  }

  async listSubmodules(repoPath: string): Promise<SubmoduleSummary[]> {
    const rootPath = await this.resolveRepositoryRoot(repoPath)
    return this.listRepositorySubmodules(rootPath)
  }

  async updateSubmodule(request: UpdateSubmoduleRequest): Promise<RepositorySnapshot> {
    const rootPath = await this.resolveRepositoryRoot(request.repoPath)
    const submodulePath = request.path ? normalizeRelativePath(request.path) : undefined
    const submodules = await this.listRepositorySubmodules(rootPath)

    if (submodulePath && !submodules.some((submodule) => submodule.path === submodulePath)) {
      throw new BranchPilotUserError('submodule_not_found', 'Submodule is not configured in this repository.')
    }

    const syncArgs = ['submodule', 'sync']
    const updateArgs = ['submodule', 'update']

    if (request.recursive) {
      syncArgs.push('--recursive')
      updateArgs.push('--recursive')
    }

    if (request.init) {
      updateArgs.push('--init')
    }

    if (submodulePath) {
      syncArgs.push('--', submodulePath)
      updateArgs.push('--', submodulePath)
    }

    await this.git(rootPath, syncArgs, { timeoutMs: 120_000 })
    await this.git(rootPath, updateArgs, { timeoutMs: 120_000 })

    return this.getSnapshot(rootPath)
  }

  async getGitLfsSummary(repoPath: string): Promise<GitLfsSummary> {
    const rootPath = await this.resolveRepositoryRoot(repoPath)
    return this.getRepositoryGitLfsSummary(rootPath)
  }

  async pullGitLfs(repoPath: string): Promise<RepositorySnapshot> {
    const rootPath = await this.resolveRepositoryRoot(repoPath)
    const summary = await this.getRepositoryGitLfsSummary(rootPath)

    if (!summary.installed) {
      throw new BranchPilotUserError('git_lfs_missing', 'Git LFS is not installed. Install git-lfs before pulling LFS objects.')
    }

    await this.assertNoActiveOperation(rootPath)
    await this.assertNoConflicts(rootPath, 'pulling Git LFS objects')
    await this.git(rootPath, ['lfs', 'pull'], { timeoutMs: 120_000 })

    return this.getSnapshot(rootPath)
  }

  async exportPatch(request: ExportPatchRequest): Promise<ExportedPatch> {
    const rootPath = await this.resolveRepositoryRoot(request.repoPath)
    const outputPath = normalizePatchOutputPath(request.outputPath)
    const scope = normalizePatchScope(request.scope)
    const args = ['diff', '--binary', '--no-ext-diff']

    if (scope === 'staged') {
      args.push('--cached')
    } else {
      args.push('HEAD')
    }

    const result = await this.git(rootPath, args, {
      allowedExitCodes: [0, 1],
      timeoutMs: 120_000
    })
    const patch = result.stdout.endsWith('\n') ? result.stdout : `${result.stdout}\n`

    if (!patch.trim()) {
      throw new BranchPilotUserError('empty_patch', scope === 'staged'
        ? 'No staged changes are available to export.'
        : 'No tracked working tree changes are available to export.')
    }

    await fs.mkdir(path.dirname(outputPath), { recursive: true })
    await fs.writeFile(outputPath, patch, 'utf8')

    return {
      path: outputPath,
      fileName: path.basename(outputPath),
      scope,
      bytes: Buffer.byteLength(patch)
    }
  }

  async applyPatch(request: ApplyPatchRequest): Promise<RepositorySnapshot> {
    if (!request.confirmed) {
      throw new BranchPilotUserError('confirmation_required', 'Applying a patch requires explicit confirmation.')
    }

    const rootPath = await this.resolveRepositoryRoot(request.repoPath)
    const patchPath = normalizePatchInputPath(request.patchPath)

    await assertPatchFileExists(patchPath)
    await this.assertNoActiveOperation(rootPath)
    await this.assertNoConflicts(rootPath, 'applying a patch')
    await this.git(rootPath, ['apply', '--check', '--whitespace=nowarn', patchPath], { timeoutMs: 120_000 })
    await this.git(rootPath, ['apply', '--whitespace=nowarn', patchPath], { timeoutMs: 120_000 })

    return this.getSnapshot(rootPath)
  }

  async acceptOurs(request: FileActionRequest): Promise<RepositorySnapshot> {
    const rootPath = await this.resolveRepositoryRoot(request.repoPath)
    const filePath = normalizeRelativePath(request.filePath)
    await this.git(rootPath, ['checkout', '--ours', '--', filePath])
    await this.git(rootPath, ['add', '--', filePath])
    return this.getSnapshot(rootPath)
  }

  async acceptTheirs(request: FileActionRequest): Promise<RepositorySnapshot> {
    const rootPath = await this.resolveRepositoryRoot(request.repoPath)
    const filePath = normalizeRelativePath(request.filePath)
    await this.git(rootPath, ['checkout', '--theirs', '--', filePath])
    await this.git(rootPath, ['add', '--', filePath])
    return this.getSnapshot(rootPath)
  }

  async markResolved(request: FileActionRequest): Promise<RepositorySnapshot> {
    const rootPath = await this.resolveRepositoryRoot(request.repoPath)
    await this.git(rootPath, ['add', '--', normalizeRelativePath(request.filePath)])
    return this.getSnapshot(rootPath)
  }

  async mergeBranch(request: MergeBranchRequest): Promise<RepositorySnapshot> {
    const rootPath = await this.resolveRepositoryRoot(request.repoPath)
    const currentBranch = await this.assertCurrentBranch(rootPath, 'merge')
    const branchName = normalizeBranchName(request.branchName)

    if (branchName === currentBranch) {
      throw new BranchPilotUserError('invalid_branch', 'Cannot merge the current branch into itself.')
    }

    await this.assertNoActiveOperation(rootPath)

    const result = await this.git(rootPath, ['merge', branchName], {
      allowedExitCodes: [0, 1],
      timeoutMs: 120_000
    })

    if (result.exitCode === 0) {
      return this.getSnapshot(rootPath)
    }

    const snapshot = await this.getSnapshot(rootPath)
    const output = [result.stderr, result.stdout].filter(Boolean).join('\n')

    if (snapshot.status.merge.operation !== 'none' || isConflictOutput(output)) {
      return snapshot
    }

    throw new CommandExecutionError(`${result.command} ${result.args.join(' ')} failed with exit code ${result.exitCode}`, result)
  }

  async rebaseBranch(request: MergeBranchRequest): Promise<RepositorySnapshot> {
    const rootPath = await this.resolveRepositoryRoot(request.repoPath)
    const currentBranch = await this.assertCurrentBranch(rootPath, 'rebase')
    const branchName = normalizeBranchName(request.branchName)

    if (branchName === currentBranch) {
      throw new BranchPilotUserError('invalid_branch', 'Cannot rebase the current branch onto itself.')
    }

    await this.assertNoActiveOperation(rootPath)

    const result = await this.git(rootPath, ['rebase', branchName], {
      allowedExitCodes: [0, 1],
      timeoutMs: 120_000
    })

    if (result.exitCode === 0) {
      return this.getSnapshot(rootPath)
    }

    const snapshot = await this.getSnapshot(rootPath)
    const output = [result.stderr, result.stdout].filter(Boolean).join('\n')

    if (snapshot.status.merge.operation !== 'none' || isConflictOutput(output)) {
      return snapshot
    }

    throw new CommandExecutionError(`${result.command} ${result.args.join(' ')} failed with exit code ${result.exitCode}`, result)
  }

  async continueMergeOperation(repoPath: string): Promise<RepositorySnapshot> {
    const rootPath = await this.resolveRepositoryRoot(repoPath)
    const mergeState = await this.getMergeState(rootPath, [])

    if (mergeState.operation === 'merge') {
      await this.git(rootPath, ['-c', 'core.editor=true', 'merge', '--continue'], { timeoutMs: 120_000 })
    } else if (mergeState.operation === 'rebase') {
      await this.git(rootPath, ['-c', 'core.editor=true', 'rebase', '--continue'], { timeoutMs: 120_000 })
    } else if (mergeState.operation === 'cherry-pick') {
      await this.git(rootPath, ['-c', 'core.editor=true', 'cherry-pick', '--continue'], { timeoutMs: 120_000 })
    } else {
      throw new BranchPilotUserError('no_merge_operation', 'No merge, rebase, or cherry-pick operation is in progress.')
    }

    return this.getSnapshot(rootPath)
  }

  async abortMergeOperation(repoPath: string): Promise<RepositorySnapshot> {
    const rootPath = await this.resolveRepositoryRoot(repoPath)
    const mergeState = await this.getMergeState(rootPath, [])

    if (mergeState.operation === 'merge') {
      await this.git(rootPath, ['merge', '--abort'])
    } else if (mergeState.operation === 'rebase') {
      await this.git(rootPath, ['rebase', '--abort'])
    } else if (mergeState.operation === 'cherry-pick') {
      await this.git(rootPath, ['cherry-pick', '--abort'])
    } else {
      throw new BranchPilotUserError('no_merge_operation', 'No merge, rebase, or cherry-pick operation is in progress.')
    }

    return this.getSnapshot(rootPath)
  }

  private async listBranches(rootPath: string, options: {
    includeDescriptions?: boolean
  } = {}): Promise<BranchSummary[]> {
    const result = await this.git(rootPath, [
      'branch',
      '--format=%(refname:short)%00%(HEAD)%00%(upstream:short)%00%(committerdate:iso-strict)%00%(objectname)'
    ])

    const branches = result.stdout
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [name, head, upstream, lastCommitAt, lastCommit] = line.split('\0')

        return {
          name,
          current: head === '*',
          upstream: upstream || undefined,
          lastCommit: lastCommit || undefined,
          lastCommitAt: lastCommitAt || undefined
        }
      })

    if (options.includeDescriptions === false) {
      return branches
    }

    return Promise.all(branches.map(async (branch) => ({
      ...branch,
      description: await this.getConfig(rootPath, `branch.${branch.name}.description`)
    })))
  }

  private async listRemoteBranches(rootPath: string): Promise<RemoteBranchSummary[]> {
    const result = await this.git(rootPath, [
      'branch',
      '-r',
      '--format=%(refname:short)%00%(committerdate:iso-strict)%00%(objectname)'
    ])

    return result.stdout
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [name, lastCommitAt, lastCommit] = line.split('\0')
        const separatorIndex = name.indexOf('/')

        return {
          name,
          remote: separatorIndex === -1 ? name : name.slice(0, separatorIndex),
          branchName: separatorIndex === -1 ? name : name.slice(separatorIndex + 1),
          lastCommit: lastCommit || undefined,
          lastCommitAt: lastCommitAt || undefined
        }
      })
      .filter((branch) => branch.branchName !== 'HEAD')
  }

  private async listTags(rootPath: string): Promise<TagSummary[]> {
    const result = await this.git(rootPath, [
      'tag',
      '--list',
      '--sort=-creatordate',
      '--format=%(refname:short)%00%(objectname)%00%(objectname:short)%00%(*objectname)%00%(*objectname:short)%00%(creatordate:iso-strict)%00%(subject)'
    ])

    return result.stdout
      .split('\n')
      .filter(Boolean)
      .map(parseTagSummary)
  }

  private async listRepositoryWorktrees(rootPath: string): Promise<WorktreeSummary[]> {
    const result = await this.git(rootPath, ['worktree', 'list', '--porcelain', '-z'], { allowedExitCodes: [0, 1] })
    return parseWorktreeList(result.stdout, rootPath)
  }

  private async listRepositorySubmodules(rootPath: string): Promise<SubmoduleSummary[]> {
    if (!await pathExists(path.join(rootPath, '.gitmodules'))) {
      return []
    }

    const config = await this.git(rootPath, [
      'config',
      '-z',
      '--file',
      '.gitmodules',
      '--get-regexp',
      '^submodule\\..*\\.(path|url|branch)$'
    ], { allowedExitCodes: [0, 1] })
    const submoduleConfigs = parseGitmodulesConfig(config.stdout)
    const status = await this.git(rootPath, ['submodule', 'status', '--recursive'], { allowedExitCodes: [0, 1] })
    const statusByPath = new Map(parseSubmoduleStatus(status.stdout).map((entry) => [entry.path, entry]))

    return submoduleConfigs.map((entry) => {
      const statusEntry = statusByPath.get(entry.path)

      return {
        path: entry.path,
        absolutePath: path.join(rootPath, entry.path),
        url: entry.url,
        branch: entry.branch,
        head: statusEntry?.head,
        status: statusEntry?.status ?? 'unknown',
        description: statusEntry?.description
      }
    })
  }

  private async getRepositoryGitLfsSummary(rootPath: string): Promise<GitLfsSummary> {
    const trackedPatterns = await this.listGitLfsPatterns(rootPath)
    const versionResult = await this.git(rootPath, ['lfs', 'version'], { allowedExitCodes: [0, 1] })
    const installed = versionResult.exitCode === 0
    const version = installed ? parseGitLfsVersion(versionResult.stdout) : undefined
    const files = installed ? await this.listGitLfsFiles(rootPath) : []

    return {
      installed,
      version,
      trackedPatterns,
      files,
      fileCount: files.length,
      message: gitLfsMessage(installed, trackedPatterns.length, files.length, version)
    }
  }

  private async listGitLfsPatterns(rootPath: string): Promise<GitLfsPattern[]> {
    const result = await this.git(rootPath, ['ls-files', '-z', '--', '.gitattributes', ':(glob)**/.gitattributes'], {
      allowedExitCodes: [0, 1]
    })
    const attributeFiles = result.stdout.split('\0').filter(Boolean)
    const patterns: GitLfsPattern[] = []

    for (const filePath of attributeFiles) {
      const fullPath = resolveRepositoryPath(rootPath, filePath)
      const content = await fs.readFile(fullPath, 'utf8')

      patterns.push(...parseGitLfsPatterns(content, filePath))
    }

    return patterns
  }

  private async listGitLfsFiles(rootPath: string): Promise<GitLfsFile[]> {
    const result = await this.git(rootPath, ['lfs', 'ls-files', '--long'], {
      allowedExitCodes: [0, 1],
      timeoutMs: 120_000
    })

    if (result.exitCode !== 0) {
      return []
    }

    return parseGitLfsFiles(result.stdout)
  }

  private async assertValidTagName(rootPath: string, tagName: string): Promise<void> {
    const result = await this.git(rootPath, ['check-ref-format', `refs/tags/${tagName}`], {
      allowedExitCodes: [0, 1]
    })

    if (result.exitCode !== 0) {
      throw new BranchPilotUserError('invalid_tag', 'Invalid tag name.')
    }
  }

  private async assertValidBranchName(rootPath: string, branchName: string): Promise<void> {
    const result = await this.git(rootPath, ['check-ref-format', `refs/heads/${branchName}`], {
      allowedExitCodes: [0, 1]
    })

    if (result.exitCode !== 0) {
      throw new BranchPilotUserError('invalid_branch', 'Invalid branch name.')
    }
  }

  private async resolveRepositoryRoot(selectedPath: string): Promise<string> {
    const result = await this.git(selectedPath, ['rev-parse', '--show-toplevel'])
    return result.stdout.trim()
  }

  private async ensureSupportedRepository(rootPath: string): Promise<void> {
    const isBare = await this.git(rootPath, ['rev-parse', '--is-bare-repository'])

    if (isBare.stdout.trim() === 'true') {
      throw new BranchPilotUserError('unsupported_repository', 'Bare repositories are not supported yet.')
    }
  }

  private async getPrimaryRemote(rootPath: string): Promise<{ name: string; url: string } | undefined> {
    const firstFetchRemote = (await this.listRemotes(rootPath)).find((remote) => remote.fetchUrl)

    if (!firstFetchRemote) {
      return undefined
    }

    return {
      name: firstFetchRemote.name,
      url: firstFetchRemote.fetchUrl ?? firstFetchRemote.pushUrl ?? ''
    }
  }

  private async getConfig(rootPath: string, key: string, scope?: 'local' | 'global'): Promise<string | undefined> {
    const args = ['config']

    if (scope) {
      args.push(`--${scope}`)
    }

    args.push('--get', key)

    const result = await this.git(rootPath, args, {
      allowedExitCodes: [0, 1]
    })

    return result.exitCode === 0 ? result.stdout.trim() || undefined : undefined
  }

  private async listRemotes(rootPath: string): Promise<RemoteSummary[]> {
    const result = await this.git(rootPath, ['remote', '-v'], { allowedExitCodes: [0, 1] })
    const remotes = new Map<string, RemoteSummary>()

    for (const line of result.stdout.split('\n').map((entry) => entry.trim()).filter(Boolean)) {
      const match = line.match(/^(\S+)\s+(\S+)\s+\((fetch|push)\)$/)

      if (!match) {
        continue
      }

      const [, name, url, direction] = match
      const remote = remotes.get(name) ?? { name }

      if (direction === 'fetch') {
        remote.fetchUrl = url
      } else {
        remote.pushUrl = url
      }

      remotes.set(name, remote)
    }

    return [...remotes.values()]
  }

  private async getDefaultBranch(rootPath: string, remotes: RemoteSummary[]): Promise<GitDefaultBranchResult> {
    for (const remote of remotes) {
      const result = await this.git(rootPath, ['symbolic-ref', '--quiet', '--short', `refs/remotes/${remote.name}/HEAD`], {
        allowedExitCodes: [0, 1, 128]
      })
      const refName = result.stdout.trim()

      if (result.exitCode === 0 && refName) {
        return {
          name: refName.startsWith(`${remote.name}/`) ? refName.slice(remote.name.length + 1) : refName,
          source: 'remote',
          remote: remote.name
        }
      }
    }

    for (const branchName of ['main', 'master']) {
      if (await this.localBranchExists(rootPath, branchName)) {
        return {
          name: branchName,
          source: 'local'
        }
      }
    }

    const currentBranch = await this.getCurrentBranch(rootPath)

    if (currentBranch) {
      return {
        name: currentBranch,
        source: 'current'
      }
    }

    return { source: 'unknown' }
  }

  private async localBranchExists(rootPath: string, branchName: string): Promise<boolean> {
    const result = await this.git(rootPath, ['show-ref', '--verify', '--quiet', `refs/heads/${branchName}`], {
      allowedExitCodes: [0, 1]
    })

    return result.exitCode === 0
  }

  private async getCommitFiles(rootPath: string, commitSha: string): Promise<CommitFileChange[]> {
    const result = await this.git(rootPath, ['diff-tree', '--root', '-r', '--name-status', '-z', '--no-commit-id', commitSha])
    return parseNameStatusRecords(result.stdout)
  }

  private async getBranchComparisonFiles(rootPath: string, range: string): Promise<CommitFileChange[]> {
    const result = await this.git(rootPath, [
      'diff',
      '--name-status',
      '-z',
      '--find-renames',
      range
    ])

    return parseNameStatusRecords(result.stdout)
  }

  private async getCommitContainingBranches(rootPath: string, commitSha: string): Promise<string[]> {
    const result = await this.git(rootPath, ['branch', '--format=%(refname:short)', '--contains', commitSha])

    return result.stdout
      .split('\n')
      .map((branch) => branch.trim())
      .filter(Boolean)
  }

  private async getCurrentBranch(rootPath: string): Promise<string> {
    const result = await this.git(rootPath, ['branch', '--show-current'], {
      allowedExitCodes: [0, 1]
    })

    return result.stdout.trim()
  }

  private async assertCurrentBranch(rootPath: string, action: string): Promise<string> {
    const branch = await this.getCurrentBranch(rootPath)

    if (!branch) {
      throw new BranchPilotUserError('git_detached_head', `Cannot ${action} from a detached HEAD. Switch to a branch first.`)
    }

    return branch
  }

  private async assertHasAnyRemote(rootPath: string): Promise<void> {
    const remotes = await this.listRemotes(rootPath)

    if (remotes.length === 0) {
      throw new BranchPilotUserError('git_no_remote', 'This repository has no remotes configured.')
    }
  }

  private async assertRemoteExists(rootPath: string, remoteName: string): Promise<string> {
    const remotes = await this.listRemotes(rootPath)

    if (remotes.length === 0) {
      throw new BranchPilotUserError('git_no_remote', 'This repository has no remotes configured.')
    }

    if (!remotes.some((remote) => remote.name === remoteName)) {
      throw new BranchPilotUserError('git_no_remote', `Remote "${remoteName}" is not configured for this repository.`)
    }

    return remoteName
  }

  private async assertLocalBranchExists(rootPath: string, branchName: string): Promise<void> {
    const result = await this.git(rootPath, ['show-ref', '--verify', '--quiet', `refs/heads/${branchName}`], {
      allowedExitCodes: [0, 1]
    })

    if (result.exitCode !== 0) {
      throw new BranchPilotUserError('invalid_branch', 'Local branch does not exist.')
    }
  }

  private async assertBranchDoesNotExist(rootPath: string, branchName: string): Promise<void> {
    const result = await this.git(rootPath, ['show-ref', '--verify', '--quiet', `refs/heads/${branchName}`], {
      allowedExitCodes: [0, 1]
    })

    if (result.exitCode === 0) {
      throw new BranchPilotUserError('branch_exists', 'Local branch already exists.')
    }
  }

  private async assertRemoteTrackingBranchExists(rootPath: string, upstream: string): Promise<void> {
    const result = await this.git(rootPath, ['show-ref', '--verify', '--quiet', `refs/remotes/${upstream}`], {
      allowedExitCodes: [0, 1]
    })

    if (result.exitCode !== 0) {
      throw new BranchPilotUserError('invalid_upstream', 'Remote tracking branch does not exist. Fetch first or choose another upstream.')
    }
  }

  private async assertRemoteMissing(rootPath: string, name: string): Promise<void> {
    if (await this.remoteExists(rootPath, name)) {
      throw new BranchPilotUserError('remote_exists', 'Remote already exists.')
    }
  }

  private async remoteExists(rootPath: string, name: string): Promise<boolean> {
    const result = await this.git(rootPath, ['remote', 'get-url', name], {
      allowedExitCodes: [0, 1, 2]
    })

    return result.exitCode === 0
  }

  private async assertValidBaseRef(rootPath: string, baseRef: string): Promise<void> {
    const result = await this.git(rootPath, ['rev-parse', '--verify', `${baseRef}^{commit}`], {
      allowedExitCodes: [0, 128]
    })

    if (result.exitCode !== 0) {
      throw new BranchPilotUserError('invalid_ref', 'Base ref does not resolve to a commit.')
    }
  }

  private async assertHasUpstream(rootPath: string, action: string): Promise<void> {
    const upstream = await this.git(rootPath, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], {
      allowedExitCodes: [0, 128]
    })

    if (upstream.exitCode !== 0 || !upstream.stdout.trim()) {
      throw new BranchPilotUserError('git_no_upstream', `Publish this branch before ${action}.`)
    }
  }

  private async assertNoActiveOperation(rootPath: string): Promise<void> {
    const mergeState = await this.getMergeState(rootPath, [])

    if (mergeState.operation !== 'none') {
      throw new BranchPilotUserError('git_operation_active', `A ${mergeState.operation} operation is already in progress.`)
    }
  }

  private async assertNoConflicts(rootPath: string, actionLabel: string): Promise<void> {
    const statusOutput = await this.git(rootPath, ['status', '--porcelain=v2', '-z', '--branch'])
    const parsedStatus = parseGitStatus(statusOutput.stdout)

    if (parsedStatus.counts.conflicted > 0) {
      throw new BranchPilotUserError('conflicts_present', `Resolve conflicted files before ${actionLabel}.`)
    }
  }

  private async getMergeState(rootPath: string, conflictFiles: MergeState['files']): Promise<MergeState> {
    const gitDirResult = await this.git(rootPath, ['rev-parse', '--git-dir'])
    const gitDir = path.isAbsolute(gitDirResult.stdout.trim())
      ? gitDirResult.stdout.trim()
      : path.join(rootPath, gitDirResult.stdout.trim())

    if (await pathExists(path.join(gitDir, 'MERGE_HEAD'))) {
      return { operation: 'merge', files: conflictFiles }
    }

    if (await pathExists(path.join(gitDir, 'rebase-merge')) || await pathExists(path.join(gitDir, 'rebase-apply'))) {
      return { operation: 'rebase', files: conflictFiles }
    }

    if (await pathExists(path.join(gitDir, 'CHERRY_PICK_HEAD'))) {
      return { operation: 'cherry-pick', files: conflictFiles }
    }

    // Conflicts can exist without an operation marker (e.g. after stash apply).
    // Reporting 'merge' here would offer Continue/Abort actions that git rejects.
    return {
      operation: 'none',
      files: conflictFiles
    }
  }

  private async isUntracked(rootPath: string, filePath: string): Promise<boolean> {
    const result = await this.git(rootPath, ['ls-files', '--error-unmatch', '--', filePath], {
      allowedExitCodes: [0, 1]
    })

    return result.exitCode === 1
  }

  private async getUntrackedFilePreview(rootPath: string, filePath: string): Promise<DiffResult> {
    const fullPath = resolveRepositoryPath(rootPath, filePath)
    const fileStats = await fs.stat(fullPath)
    const file = await readFilePrefix(fullPath, MAX_DIFF_OUTPUT_BYTES)
    const binary = file.includes(0)
    const tooLarge = fileStats.size > MAX_DIFF_BYTES
    const text = binary
      ? 'Binary untracked file.'
      : file
          .toString('utf8')
          .slice(0, MAX_DIFF_BYTES)
          .split('\n')
          .map((line) => `+${line}`)
          .join('\n')

    return {
      filePath,
      staged: false,
      text,
      binary,
      tooLarge,
      files: []
    }
  }

  private async gitCommitWithMessageFile(rootPath: string, argsPrefix: string[], message: string): Promise<void> {
    const messageFile = path.join(os.tmpdir(), `branchpilot-commit-${Date.now()}.txt`)

    await fs.writeFile(messageFile, message, 'utf8')

    try {
      await this.git(rootPath, [...argsPrefix, messageFile], { timeoutMs: 120_000 })
    } finally {
      await fs.rm(messageFile, { force: true })
    }
  }

  private async git(
    cwd: string,
    args: string[],
    options: { allowedExitCodes?: number[]; input?: string; timeoutMs?: number; maxOutputBytes?: number } = {}
  ) {
    return this.runner.run('/usr/bin/git', args, {
      cwd,
      allowedExitCodes: options.allowedExitCodes,
      input: options.input,
      timeoutMs: options.timeoutMs,
      maxOutputBytes: options.maxOutputBytes
    })
  }
}

