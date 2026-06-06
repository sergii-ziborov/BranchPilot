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
    const [branches, tags, worktrees, submodules, lfs, recentRepositories] = await Promise.all([
      this.listBranches(rootPath),
      this.listTags(rootPath),
      this.listRepositoryWorktrees(rootPath),
      this.listRepositorySubmodules(rootPath),
      this.getRepositoryGitLfsSummary(rootPath),
      this.settings.getRecentRepositories()
    ])

    return {
      summary,
      status,
      branches,
      tags,
      worktrees,
      submodules,
      lfs,
      recentRepositories
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
    return this.getSnapshot(rootPath)
  }

  async unstageFile(request: FileActionRequest): Promise<RepositorySnapshot> {
    const rootPath = await this.resolveRepositoryRoot(request.repoPath)
    await this.git(rootPath, ['restore', '--staged', '--', normalizeRelativePath(request.filePath)])
    return this.getSnapshot(rootPath)
  }

  async stageHunk(request: HunkActionRequest): Promise<RepositorySnapshot> {
    const rootPath = await this.resolveRepositoryRoot(request.repoPath)
    const filePath = normalizeRelativePath(request.filePath)
    const patch = normalizeHunkPatch(request.patch, filePath)

    await this.git(rootPath, ['apply', '--cached', '--whitespace=nowarn'], {
      input: patch,
      timeoutMs: 30_000
    })

    return this.getSnapshot(rootPath)
  }

  async unstageHunk(request: HunkActionRequest): Promise<RepositorySnapshot> {
    const rootPath = await this.resolveRepositoryRoot(request.repoPath)
    const filePath = normalizeRelativePath(request.filePath)
    const patch = normalizeHunkPatch(request.patch, filePath)

    await this.git(rootPath, ['apply', '--reverse', '--cached', '--whitespace=nowarn'], {
      input: patch,
      timeoutMs: 30_000
    })

    return this.getSnapshot(rootPath)
  }

  async stageAll(repoPath: string): Promise<RepositorySnapshot> {
    const rootPath = await this.resolveRepositoryRoot(repoPath)
    await this.git(rootPath, ['add', '-A'])
    return this.getSnapshot(rootPath)
  }

  async unstageAll(repoPath: string): Promise<RepositorySnapshot> {
    const rootPath = await this.resolveRepositoryRoot(repoPath)
    await this.git(rootPath, ['restore', '--staged', '--', '.'])
    return this.getSnapshot(rootPath)
  }

  async discardFile(request: FileActionRequest & { confirmed: boolean }): Promise<RepositorySnapshot> {
    if (!request.confirmed) {
      throw new BranchPilotUserError('confirmation_required', 'Discard requires explicit confirmation.')
    }

    const rootPath = await this.resolveRepositoryRoot(request.repoPath)
    await this.git(rootPath, ['restore', '--', normalizeRelativePath(request.filePath)])
    return this.getSnapshot(rootPath)
  }

  async deleteUntrackedFile(request: FileActionRequest & { confirmed: boolean }): Promise<RepositorySnapshot> {
    if (!request.confirmed) {
      throw new BranchPilotUserError('confirmation_required', 'Deleting an untracked file requires explicit confirmation.')
    }

    const rootPath = await this.resolveRepositoryRoot(request.repoPath)
    await this.git(rootPath, ['clean', '-f', '--', normalizeRelativePath(request.filePath)])
    return this.getSnapshot(rootPath)
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

    const message = [title, request.description.trim()].filter(Boolean).join('\n\n')
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

    const message = [title, request.description.trim()].filter(Boolean).join('\n\n')
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

    return this.getSnapshot(rootPath)
  }

  async applyStash(request: StashActionRequest): Promise<RepositorySnapshot> {
    const rootPath = await this.resolveRepositoryRoot(request.repoPath)
    await this.git(rootPath, ['stash', 'apply', normalizeStashRef(request.stashRef)], { timeoutMs: 120_000 })

    return this.getSnapshot(rootPath)
  }

  async dropStash(request: ConfirmedStashActionRequest): Promise<RepositorySnapshot> {
    if (!request.confirmed) {
      throw new BranchPilotUserError('confirmation_required', 'Dropping a stash requires explicit confirmation.')
    }

    const rootPath = await this.resolveRepositoryRoot(request.repoPath)
    await this.git(rootPath, ['stash', 'drop', normalizeStashRef(request.stashRef)], { timeoutMs: 120_000 })

    return this.getSnapshot(rootPath)
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

    if (force) {
      throw new BranchPilotUserError('unsupported_force_delete', 'Force deleting branches is not available in BranchPilot v1.')
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

    return {
      operation: conflictFiles.length > 0 ? 'merge' : 'none',
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

function normalizeHunkPatch(patch: string, filePath: string): string {
  if (!patch.trim() || patch.includes('\0')) {
    throw new BranchPilotUserError('invalid_hunk_patch', 'Hunk patch is invalid.')
  }

  const files = parseUnifiedDiff(patch)

  if (files.length !== 1 || files[0].hunks.length !== 1) {
    throw new BranchPilotUserError('invalid_hunk_patch', 'Hunk patch must contain exactly one file hunk.')
  }

  const paths = [files[0].oldPath, files[0].newPath]
    .filter((candidate): candidate is string => Boolean(candidate) && candidate !== '/dev/null')
    .map((candidate) => normalizeRelativePath(candidate))

  if (!paths.includes(filePath)) {
    throw new BranchPilotUserError('invalid_hunk_patch', 'Hunk patch does not match the selected file.')
  }

  return patch.endsWith('\n') ? patch : `${patch}\n`
}

function normalizeRelativePath(filePath: string): string {
  if (!filePath || path.isAbsolute(filePath) || filePath.includes('..')) {
    throw new BranchPilotUserError('invalid_path', 'Only repository-relative paths are allowed.')
  }

  return filePath
}

function staleBranchesForRepository(repoPath: string, repoName: string, branches: BranchSummary[]): DashboardStaleBranch[] {
  const now = Date.now()

  return branches
    .filter((branch) => !branch.current && Boolean(branch.lastCommitAt))
    .map((branch) => {
      const committedAt = Date.parse(branch.lastCommitAt ?? '')
      const daysSinceCommit = Number.isNaN(committedAt)
        ? 0
        : Math.floor((now - committedAt) / (1000 * 60 * 60 * 24))

      return {
        repoPath,
        repoName,
        name: branch.name,
        lastCommitAt: branch.lastCommitAt ?? '',
        daysSinceCommit
      }
    })
    .filter((branch) => branch.daysSinceCommit >= STALE_BRANCH_THRESHOLD_DAYS)
    .sort((first, second) => second.daysSinceCommit - first.daysSinceCommit)
}

function normalizeBranchName(branchName: string): string {
  const trimmed = branchName.trim()

  if (!trimmed || trimmed.startsWith('-') || trimmed.includes('\0')) {
    throw new BranchPilotUserError('invalid_branch', 'Invalid branch name.')
  }

  return trimmed
}

function normalizeGitRef(ref: string): string {
  const trimmed = ref.trim()

  if (!trimmed || trimmed.startsWith('-') || trimmed.includes('\0')) {
    throw new BranchPilotUserError('invalid_ref', 'Invalid base ref.')
  }

  return trimmed
}

function normalizeTagName(tagName: string): string {
  const trimmed = tagName.trim()

  if (!trimmed || trimmed.startsWith('-') || trimmed.includes('\0')) {
    throw new BranchPilotUserError('invalid_tag', 'Invalid tag name.')
  }

  return trimmed
}

function normalizeRemoteName(name: string): string {
  const trimmed = name.trim()

  if (!/^[A-Za-z0-9._-]+$/.test(trimmed) || trimmed.startsWith('-')) {
    throw new BranchPilotUserError('invalid_remote', 'Remote name can contain letters, numbers, dots, underscores, and hyphens.')
  }

  return trimmed
}

function normalizeRemoteUrl(url: string): string {
  const trimmed = url.trim()

  if (!trimmed || trimmed.includes('\0') || trimmed.startsWith('-')) {
    throw new BranchPilotUserError('invalid_remote_url', 'Remote URL is required.')
  }

  return trimmed
}

function normalizeCloneRemoteUrl(remoteUrl: string): string {
  const trimmed = remoteUrl.trim()

  if (!trimmed || trimmed.includes('\0') || trimmed.startsWith('-')) {
    throw new BranchPilotUserError('invalid_clone_url', 'Clone URL is required.')
  }

  return trimmed
}

function normalizeCloneParentPath(targetParentPath: string | undefined): string {
  const trimmed = targetParentPath?.trim()

  if (!trimmed || trimmed.includes('\0') || !path.isAbsolute(trimmed)) {
    throw new BranchPilotUserError('invalid_clone_target', 'Choose a folder to clone into.')
  }

  return path.resolve(trimmed)
}

function normalizeCloneTargetName(targetName: string): string {
  const trimmed = targetName.trim()

  if (!/^[A-Za-z0-9._ -]+$/.test(trimmed) || trimmed.startsWith('.') || trimmed.includes('..')) {
    throw new BranchPilotUserError('invalid_clone_target', 'Clone folder name is invalid.')
  }

  return trimmed
}

function cloneNameFromRemoteUrl(remoteUrl: string): string {
  const trimmed = remoteUrl.trim()
  const pathname = remoteUrlPathname(trimmed)
  const basename = path.basename(pathname).replace(/\.git$/i, '')

  return basename || 'repository'
}

function remoteUrlPathname(remoteUrl: string): string {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(remoteUrl)) {
    try {
      return new URL(remoteUrl).pathname
    } catch {
      return remoteUrl
    }
  }

  const scpLike = /^(?:[^@\s]+@)?[^:\s]+:(?<path>[^\\\s]+)$/.exec(remoteUrl)

  if (scpLike?.groups?.path) {
    return scpLike.groups.path
  }

  return remoteUrl
}

function normalizeWorktreePath(rootPath: string, targetPath: string | undefined, options: { allowInsideRoot?: boolean } = {}): string {
  const trimmed = targetPath?.trim()

  if (!trimmed || trimmed.includes('\0') || !path.isAbsolute(trimmed)) {
    throw new BranchPilotUserError('invalid_worktree_path', 'Worktree target path is required.')
  }

  const normalizedTarget = path.resolve(trimmed)
  const normalizedRoot = path.resolve(rootPath)

  if (!options.allowInsideRoot && (
    normalizedTarget === normalizedRoot
    || normalizedTarget.startsWith(`${normalizedRoot}${path.sep}`)
  )) {
    throw new BranchPilotUserError('invalid_worktree_path', 'Choose a worktree folder outside the current repository.')
  }

  return normalizedTarget
}

async function normalizeExistingWorktreePath(rootPath: string, targetPath: string | undefined): Promise<string> {
  const normalizedTarget = normalizeWorktreePath(rootPath, targetPath, { allowInsideRoot: true })

  try {
    return path.resolve(await fs.realpath(normalizedTarget))
  } catch {
    return normalizedTarget
  }
}

async function assertWorktreeTargetAvailable(targetPath: string): Promise<void> {
  if (await pathExists(targetPath)) {
    throw new BranchPilotUserError('worktree_path_exists', 'Worktree target folder already exists.')
  }
}

function normalizePatchScope(scope: ExportPatchRequest['scope']): ExportPatchRequest['scope'] {
  if (scope !== 'working-tree' && scope !== 'staged') {
    throw new BranchPilotUserError('invalid_patch_scope', 'Invalid patch scope.')
  }

  return scope
}

function normalizePatchOutputPath(outputPath?: string): string {
  const normalized = normalizePatchFilePath(outputPath, 'Patch output path is required.')

  if (!normalized.endsWith('.patch') && !normalized.endsWith('.diff')) {
    return `${normalized}.patch`
  }

  return normalized
}

function normalizePatchInputPath(patchPath?: string): string {
  return normalizePatchFilePath(patchPath, 'Patch file path is required.')
}

async function assertPatchFileExists(patchPath: string): Promise<void> {
  try {
    await fs.access(patchPath)
  } catch {
    throw new BranchPilotUserError('patch_not_found', 'Patch file could not be read.')
  }
}

function normalizePatchFilePath(filePath: string | undefined, message: string): string {
  const trimmed = filePath?.trim()

  if (!trimmed || trimmed.includes('\0') || !path.isAbsolute(trimmed)) {
    throw new BranchPilotUserError('invalid_patch_path', message)
  }

  return trimmed
}

function normalizeCommitSha(commitSha: string): string {
  const trimmed = commitSha.trim()

  if (!/^[a-fA-F0-9]{7,40}$/.test(trimmed)) {
    throw new BranchPilotUserError('invalid_commit', 'Invalid commit identifier.')
  }

  return trimmed
}

function normalizeConfigValue(value: string, label: string): string {
  const trimmed = value.trim()

  if (!trimmed || trimmed.includes('\0')) {
    throw new BranchPilotUserError('invalid_git_config', `${label} is required.`)
  }

  return trimmed
}

function normalizeStashMessage(message: string): string {
  const trimmed = message.trim()

  if (!trimmed || trimmed.includes('\0')) {
    throw new BranchPilotUserError('invalid_stash_message', 'Stash message is required.')
  }

  return trimmed
}

function normalizeStashRef(stashRef: string): string {
  const trimmed = stashRef.trim()

  if (!/^stash@\{\d+\}$/.test(trimmed)) {
    throw new BranchPilotUserError('invalid_stash_ref', 'Invalid stash reference.')
  }

  return trimmed
}

function isConflictOutput(output: string): boolean {
  const normalized = output.toLowerCase()

  return normalized.includes('automatic merge failed')
    || normalized.includes('fix conflicts')
    || normalized.includes('merge conflict')
    || normalized.includes('conflict (')
}

function parseCommitSummary(line: string): CommitSummary {
  const [sha, shortSha, subject, authorName, authorEmail, authoredAt] = line.split('\0')

  return {
    sha,
    shortSha,
    subject,
    authorName,
    authorEmail,
    authoredAt
  }
}

function parseStashEntry(line: string): StashEntry {
  const [ref, sha, createdAtLabel, message] = line.split('\0')

  return {
    ref,
    sha,
    createdAtLabel,
    message
  }
}

function parseNameStatusRecords(output: string): CommitFileChange[] {
  const records = output.split('\0').filter(Boolean)
  const files: CommitFileChange[] = []

  for (let index = 0; index < records.length; index += 1) {
    const rawStatus = records[index]

    if (rawStatus.startsWith('R') || rawStatus.startsWith('C')) {
      files.push({
        rawStatus,
        status: rawStatus.startsWith('R') ? 'renamed' : 'copied',
        originalPath: records[index + 1],
        path: records[index + 2]
      })
      index += 2
      continue
    }

    files.push({
      rawStatus,
      status: mapRawStatus(rawStatus),
      path: records[index + 1]
    })
    index += 1
  }

  return files
}

function parseBranchCompareCommitCounts(output: string): [number, number] {
  const [baseOnly, targetOnly] = output.trim().split(/\s+/).map((value) => Number.parseInt(value, 10))

  return [
    Number.isFinite(baseOnly) ? baseOnly : 0,
    Number.isFinite(targetOnly) ? targetOnly : 0
  ]
}

function parseTagSummary(line: string): TagSummary {
  const [name, objectSha, objectShortSha, dereferencedSha, dereferencedShortSha, createdAt, subject] = line.split('\0')

  return {
    name,
    targetSha: dereferencedSha || objectSha,
    targetShortSha: dereferencedShortSha || objectShortSha,
    createdAt: createdAt || undefined,
    subject: subject || undefined
  }
}

interface ParsedSubmoduleConfig {
  name: string
  path?: string
  url?: string
  branch?: string
}

interface ParsedSubmoduleStatus {
  path: string
  head?: string
  status: SubmoduleStatus
  description?: string
}

function parseGitmodulesConfig(output: string): Array<Required<Pick<ParsedSubmoduleConfig, 'name' | 'path'>> & Partial<ParsedSubmoduleConfig>> {
  const entries = new Map<string, ParsedSubmoduleConfig>()

  for (const record of output.split('\0').filter(Boolean)) {
    const separatorIndex = record.indexOf('\n')

    if (separatorIndex === -1) {
      continue
    }

    const key = record.slice(0, separatorIndex)
    const value = record.slice(separatorIndex + 1)
    const match = key.match(/^submodule\.(.+)\.(path|url|branch)$/)

    if (!match) {
      continue
    }

    const [, name, property] = match
    const entry = entries.get(name) ?? { name }

    if (property === 'path') {
      entry.path = value
    } else if (property === 'url') {
      entry.url = value
    } else if (property === 'branch') {
      entry.branch = value
    }

    entries.set(name, entry)
  }

  return [...entries.values()]
    .filter((entry): entry is Required<Pick<ParsedSubmoduleConfig, 'name' | 'path'>> & Partial<ParsedSubmoduleConfig> =>
      Boolean(entry.path)
    )
    .map((entry) => ({
      ...entry,
      path: normalizeRelativePath(entry.path)
    }))
}

function parseSubmoduleStatus(output: string): ParsedSubmoduleStatus[] {
  return output
    .split('\n')
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map(parseSubmoduleStatusLine)
    .filter((entry): entry is ParsedSubmoduleStatus => Boolean(entry))
}

function parseSubmoduleStatusLine(line: string): ParsedSubmoduleStatus | null {
  const prefix = line[0]
  const rest = line.slice(1)
  const firstSpaceIndex = rest.indexOf(' ')

  if (firstSpaceIndex === -1) {
    return null
  }

  const head = rest.slice(0, firstSpaceIndex)
  let pathAndDescription = rest.slice(firstSpaceIndex + 1)
  let description: string | undefined
  const descriptionIndex = pathAndDescription.lastIndexOf(' (')

  if (descriptionIndex !== -1 && pathAndDescription.endsWith(')')) {
    description = pathAndDescription.slice(descriptionIndex + 2, -1)
    pathAndDescription = pathAndDescription.slice(0, descriptionIndex)
  }

  return {
    path: normalizeRelativePath(pathAndDescription),
    head: head || undefined,
    status: mapSubmoduleStatus(prefix),
    description
  }
}

function mapSubmoduleStatus(prefix: string): SubmoduleStatus {
  if (prefix === ' ') return 'initialized'
  if (prefix === '-') return 'uninitialized'
  if (prefix === '+') return 'modified'
  if (prefix === 'U') return 'conflicted'
  return 'unknown'
}

function parseGitLfsVersion(output: string): string | undefined {
  const firstLine = output.trim().split('\n')[0]

  return firstLine || undefined
}

function gitLfsMessage(installed: boolean, patternCount: number, fileCount: number, version?: string): string {
  if (!installed) {
    return patternCount > 0
      ? 'Git LFS patterns are configured, but git-lfs is not installed.'
      : 'Git LFS is not installed.'
  }

  if (patternCount === 0 && fileCount === 0) {
    return `${version ?? 'Git LFS'} detected. No tracked LFS patterns were found.`
  }

  return `${version ?? 'Git LFS'} detected with ${patternCount} tracked pattern${patternCount === 1 ? '' : 's'} and ${fileCount} known LFS file${fileCount === 1 ? '' : 's'}.`
}

function parseGitLfsPatterns(content: string, sourcePath: string): GitLfsPattern[] {
  return content
    .split('\n')
    .map((line, index) => parseGitLfsPatternLine(line, sourcePath, index + 1))
    .filter((pattern): pattern is GitLfsPattern => Boolean(pattern))
}

function parseGitLfsPatternLine(line: string, sourcePath: string, lineNumber: number): GitLfsPattern | null {
  const trimmed = line.trim()

  if (!trimmed || trimmed.startsWith('#')) {
    return null
  }

  const [pattern, ...attributes] = trimmed.split(/\s+/)

  if (!pattern || pattern.startsWith('#') || !attributes.includes('filter=lfs')) {
    return null
  }

  return {
    pattern,
    sourcePath,
    line: lineNumber
  }
}

function parseGitLfsFiles(output: string): GitLfsFile[] {
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map(parseGitLfsFileLine)
    .filter((file): file is GitLfsFile => Boolean(file))
}

function parseGitLfsFileLine(line: string): GitLfsFile | null {
  const match = line.match(/^([a-fA-F0-9]{40,64})\s+([*-])\s+(.+)$/)

  if (match) {
    const [, oid, marker, filePath] = match

    return {
      oid,
      path: normalizeRelativePath(filePath),
      status: mapGitLfsFileStatus(marker)
    }
  }

  const fallback = line.match(/^([*-])\s+(.+)$/)

  if (fallback) {
    const [, marker, filePath] = fallback

    return {
      path: normalizeRelativePath(filePath),
      status: mapGitLfsFileStatus(marker)
    }
  }

  return null
}

function mapGitLfsFileStatus(marker: string): GitLfsFileStatus {
  if (marker === '*') return 'present'
  if (marker === '-') return 'pointer'
  return 'unknown'
}

function parseWorktreeList(output: string, rootPath: string): WorktreeSummary[] {
  const entries: WorktreeSummary[] = []
  const records = output.split('\0')
  let current: Partial<WorktreeSummary> | null = null
  const normalizedRootPath = path.resolve(rootPath)

  for (const record of records) {
    if (!record) {
      if (current?.path) {
        entries.push(finalizeWorktreeSummary(current, normalizedRootPath))
      }
      current = null
      continue
    }

    const [key, ...valueParts] = record.split(' ')
    const value = valueParts.join(' ')

    if (key === 'worktree') {
      if (current?.path) {
        entries.push(finalizeWorktreeSummary(current, normalizedRootPath))
      }
      current = {
        path: value,
        detached: false,
        bare: false,
        locked: false,
        prunable: false,
        current: false
      }
      continue
    }

    if (!current) {
      continue
    }

    if (key === 'HEAD') {
      current.head = value || undefined
    } else if (key === 'branch') {
      current.branch = value.startsWith('refs/heads/') ? value.slice('refs/heads/'.length) : value
    } else if (key === 'detached') {
      current.detached = true
    } else if (key === 'bare') {
      current.bare = true
    } else if (key === 'locked') {
      current.locked = true
      current.reason = value || current.reason
    } else if (key === 'prunable') {
      current.prunable = true
      current.reason = value || current.reason
    }
  }

  if (current?.path) {
    entries.push(finalizeWorktreeSummary(current, normalizedRootPath))
  }

  return entries
}

function finalizeWorktreeSummary(worktree: Partial<WorktreeSummary>, normalizedRootPath: string): WorktreeSummary {
  return {
    path: worktree.path ?? '',
    branch: worktree.branch,
    head: worktree.head,
    detached: Boolean(worktree.detached),
    bare: Boolean(worktree.bare),
    locked: Boolean(worktree.locked),
    prunable: Boolean(worktree.prunable),
    current: path.resolve(worktree.path ?? '') === normalizedRootPath,
    reason: worktree.reason
  }
}

function mapRawStatus(rawStatus: string) {
  if (rawStatus.startsWith('A')) return 'added'
  if (rawStatus.startsWith('D')) return 'deleted'
  if (rawStatus.startsWith('R')) return 'renamed'
  if (rawStatus.startsWith('C')) return 'copied'
  if (rawStatus.startsWith('M')) return 'modified'

  return 'unknown'
}

function resolveRepositoryPath(rootPath: string, relativePath: string): string {
  const fullPath = path.resolve(rootPath, normalizeRelativePath(relativePath))
  const normalizedRoot = path.resolve(rootPath)

  if (!fullPath.startsWith(`${normalizedRoot}${path.sep}`) && fullPath !== normalizedRoot) {
    throw new BranchPilotUserError('invalid_path', 'Path escapes repository root.')
  }

  return fullPath
}

async function readFilePrefix(filePath: string, maxBytes: number): Promise<Buffer> {
  const file = await fs.open(filePath, 'r')

  try {
    const buffer = Buffer.alloc(Math.max(0, maxBytes))
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0)

    return buffer.subarray(0, bytesRead)
  } finally {
    await file.close()
  }
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}
