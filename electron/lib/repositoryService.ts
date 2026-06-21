import {
  promises as fs
} from 'node:fs'
import { spawn } from 'node:child_process'
import path from 'node:path'
import type {
  CloneRepositoryRequest,
  CommitRequest,
  ConfirmedCommitReferenceRequest,
  ConfirmedCommitRequest,
  ConfirmedStashActionRequest,
  CreateStashRequest,
  FileActionRequest,
  ImagePreview,
  ImagePreviewRequest,
  GitIdentityUpdate,
  HunkActionRequest,
  RecentRepository,
  RemoteRemoveRequest,
  RemoteUpsertRequest,
  RepositoryPinRequest,
  RepositorySnapshot,
  StashActionRequest
} from '../../src/shared/branchPilot.js'
import {
  CommandExecutionError
} from './commandRunner.js'
import {
  BranchPilotUserError
} from './errors.js'
import {
  parseGitStatus
} from './gitStatusParser.js'
import {
  buildCommitMessage,
  cloneNameFromRemoteUrl,
  isConflictOutput,
  imageMimeFromPath,
  MAX_IMAGE_PREVIEW_BYTES,
  resolveRepositoryPath,
  normalizeCloneParentPath,
  normalizeCloneRemoteUrl,
  normalizeCloneTargetName,
  normalizeCommitSha,
  normalizeHunkPatch,
  normalizeRelativePath,
  pathExists
} from './repositoryService.helpers.js'
import {
  RepositoryServiceWrites
} from './repositoryService.writes.js'
import { RepositoryActivityAnalytics } from './repositoryService.activityAnalytics.js'
import { RepositoryDashboardService } from './repositoryService.dashboard.js'
import { RepositoryStashService } from './repositoryService.stash.js'
import { RepositoryConfigService } from './repositoryService.config.js'
import { RepositoryWorktreeTagService } from './repositoryService.worktreeTag.js'
import { RepositorySubmoduleLfsService } from './repositoryService.submoduleLfs.js'

export class RepositoryService extends RepositoryServiceWrites {
  // Composition over inheritance: contributor / activity reporting lives in its own
  // collaborator, wired to a narrow slice of this service's git kernel.
  private readonly activityAnalytics = new RepositoryActivityAnalytics({
    resolveRepositoryRoot: (selectedPath) => this.resolveRepositoryRoot(selectedPath),
    getRecentRepositories: () => this.settings.getRecentRepositories(),
    getConfig: (rootPath, key, scope) => this.getConfig(rootPath, key, scope),
    git: (cwd, args, options) => this.git(cwd, args, options)
  })

  // Cross-repository portfolio scan, also a composed collaborator.
  private readonly dashboardService = new RepositoryDashboardService({
    resolveRepositoryRoot: (selectedPath) => this.resolveRepositoryRoot(selectedPath),
    getRecentRepositories: () => this.settings.getRecentRepositories(),
    getRepositoryStatusContext: (rootPath, options) => this.getRepositoryStatusContext(rootPath, options),
    listBranches: (rootPath, options) => this.listBranches(rootPath, options)
  })

  // Stash domain (list / push / apply / drop) as a composed collaborator.
  private readonly stashService = new RepositoryStashService({
    resolveRepositoryRoot: (selectedPath) => this.resolveRepositoryRoot(selectedPath),
    git: (cwd, args, options) => this.git(cwd, args, options),
    getSnapshot: (repoPath) => this.getSnapshot(repoPath),
    getStatusOnlySnapshot: (rootPath) => this.getStatusOnlySnapshot(rootPath)
  })

  // Git identity, signing and remote management as a composed collaborator.
  private readonly configService = new RepositoryConfigService({
    resolveRepositoryRoot: (selectedPath) => this.resolveRepositoryRoot(selectedPath),
    git: (cwd, args, options) => this.git(cwd, args, options),
    getConfig: (rootPath, key, scope) => this.getConfig(rootPath, key, scope),
    listRemotes: (rootPath) => this.listRemotes(rootPath),
    getDefaultBranch: (rootPath, remotes) => this.getDefaultBranch(rootPath, remotes),
    assertRemoteMissing: (rootPath, name) => this.assertRemoteMissing(rootPath, name),
    assertRemoteExists: (rootPath, name) => this.assertRemoteExists(rootPath, name)
  })

  // Tag + linked-worktree management as a composed collaborator.
  private readonly worktreeTagService = new RepositoryWorktreeTagService({
    resolveRepositoryRoot: (selectedPath) => this.resolveRepositoryRoot(selectedPath),
    git: (cwd, args, options) => this.git(cwd, args, options),
    getSnapshot: (repoPath) => this.getSnapshot(repoPath),
    getCurrentBranch: (rootPath) => this.getCurrentBranch(rootPath),
    assertValidTagName: (rootPath, tagName) => this.assertValidTagName(rootPath, tagName),
    assertValidBranchName: (rootPath, branchName) => this.assertValidBranchName(rootPath, branchName),
    assertBranchDoesNotExist: (rootPath, branchName) => this.assertBranchDoesNotExist(rootPath, branchName),
    assertValidBaseRef: (rootPath, baseRef) => this.assertValidBaseRef(rootPath, baseRef),
    listRepositoryWorktrees: (rootPath) => this.listRepositoryWorktrees(rootPath)
  })

  // Submodule + Git LFS management as a composed collaborator.
  private readonly submoduleLfsService = new RepositorySubmoduleLfsService({
    resolveRepositoryRoot: (selectedPath) => this.resolveRepositoryRoot(selectedPath),
    git: (cwd, args, options) => this.git(cwd, args, options),
    getSnapshot: (repoPath) => this.getSnapshot(repoPath),
    listRepositorySubmodules: (rootPath) => this.listRepositorySubmodules(rootPath),
    getRepositoryGitLfsSummary: (rootPath) => this.getRepositoryGitLfsSummary(rootPath),
    assertNoActiveOperation: (rootPath) => this.assertNoActiveOperation(rootPath),
    assertNoConflicts: (rootPath, actionLabel) => this.assertNoConflicts(rootPath, actionLabel)
  })

  listSubmodules(repoPath: string) {
    return this.submoduleLfsService.listSubmodules(repoPath)
  }

  getGitLfsSummary(repoPath: string) {
    return this.submoduleLfsService.getGitLfsSummary(repoPath)
  }

  updateSubmodule(request: UpdateSubmoduleRequest) {
    return this.submoduleLfsService.updateSubmodule(request)
  }

  pullGitLfs(repoPath: string) {
    return this.submoduleLfsService.pullGitLfs(repoPath)
  }

  listWorktrees(repoPath: string) {
    return this.worktreeTagService.listWorktrees(repoPath)
  }

  createTag(request: CreateTagRequest) {
    return this.worktreeTagService.createTag(request)
  }

  deleteTag(request: DeleteTagRequest) {
    return this.worktreeTagService.deleteTag(request)
  }

  createWorktree(request: CreateWorktreeRequest) {
    return this.worktreeTagService.createWorktree(request)
  }

  removeWorktree(request: RemoveWorktreeRequest) {
    return this.worktreeTagService.removeWorktree(request)
  }

  getContributors(repoPath: string) {
    return this.activityAnalytics.getContributors(repoPath)
  }

  getContributorStats(repoPath?: string) {
    return this.activityAnalytics.getContributorStats(repoPath)
  }

  getContributionGraph(repoPath?: string) {
    return this.activityAnalytics.getContributionGraph(repoPath)
  }

  getRepositoryRhythm(repoPath?: string) {
    return this.activityAnalytics.getRepositoryRhythm(repoPath)
  }

  getRepositoryDashboard(repoPath?: string) {
    return this.dashboardService.getRepositoryDashboard(repoPath)
  }

  async getImagePreview(request: ImagePreviewRequest): Promise<ImagePreview> {
    const rootPath = await this.resolveRepositoryRoot(request.repoPath)
    const relativePath = normalizeRelativePath(request.filePath)
    const mimeType = imageMimeFromPath(relativePath)

    if (!mimeType) {
      throw new BranchPilotUserError('not_an_image', 'This file is not a previewable image.')
    }

    const buffer = request.commitSha
      ? await this.readGitBlob(rootPath, `${normalizeCommitSha(request.commitSha)}:${relativePath}`)
      : await this.readWorkingTreeImage(rootPath, relativePath)

    return {
      dataUrl: `data:${mimeType};base64,${buffer.toString('base64')}`,
      mimeType,
      byteSize: buffer.length
    }
  }

  private async readWorkingTreeImage(rootPath: string, relativePath: string): Promise<Buffer> {
    const absolutePath = resolveRepositoryPath(rootPath, relativePath)
    const stats = await fs.stat(absolutePath).catch(() => null)

    if (!stats || !stats.isFile()) {
      throw new BranchPilotUserError('image_not_found', 'Image is not available in the working tree.')
    }

    if (stats.size > MAX_IMAGE_PREVIEW_BYTES) {
      throw new BranchPilotUserError('image_too_large', 'Image is too large to preview.')
    }

    return fs.readFile(absolutePath)
  }

  /** Reads a git blob (e.g. `<sha>:<path>`) as raw bytes so binary images survive intact. */
  private readGitBlob(rootPath: string, ref: string): Promise<Buffer> {
    return new Promise<Buffer>((resolve, reject) => {
      const child = spawn('/usr/bin/git', ['-C', rootPath, 'cat-file', 'blob', ref], {
        stdio: ['ignore', 'pipe', 'pipe']
      })
      const chunks: Buffer[] = []
      let size = 0
      let aborted = false
      let stderr = ''

      child.stdout.on('data', (chunk: Buffer) => {
        size += chunk.length
        if (size > MAX_IMAGE_PREVIEW_BYTES) {
          aborted = true
          child.kill()
          reject(new BranchPilotUserError('image_too_large', 'Image is too large to preview.'))
          return
        }
        chunks.push(chunk)
      })
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf8')
      })
      child.on('error', reject)
      child.on('close', (code) => {
        if (aborted) return
        if (code !== 0) {
          reject(new BranchPilotUserError('image_not_found', stderr.trim() || 'Image is not available in this commit.'))
          return
        }
        resolve(Buffer.concat(chunks))
      })
    })
  }

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

  async setRepositoryPinned(request: RepositoryPinRequest): Promise<RecentRepository[]> {
    const rootPath = await this.resolveRepositoryRoot(request.repoPath)

    return this.settings.setRepositoryPinned(rootPath, request.pinned)
  }

  getGitConfig(repoPath: string) {
    return this.configService.getGitConfig(repoPath)
  }

  setLocalGitIdentity(request: GitIdentityUpdate) {
    return this.configService.setLocalGitIdentity(request)
  }

  addRemote(request: RemoteUpsertRequest) {
    return this.configService.addRemote(request)
  }

  setRemoteUrl(request: RemoteUpsertRequest) {
    return this.configService.setRemoteUrl(request)
  }

  removeRemote(request: RemoteRemoveRequest) {
    return this.configService.removeRemote(request)
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

  /** Permanently reverts a single unstaged hunk in the working tree (GitHub-Desktop-style discard). */
  async discardHunk(request: HunkActionRequest): Promise<RepositorySnapshot> {
    const rootPath = await this.resolveRepositoryRoot(request.repoPath)
    const filePath = normalizeRelativePath(request.filePath)
    const patch = normalizeHunkPatch(request.patch, filePath)

    await this.git(rootPath, ['apply', '--reverse', '--whitespace=nowarn'], {
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

  listStashes(repoPath: string) {
    return this.stashService.listStashes(repoPath)
  }

  createStash(request: CreateStashRequest) {
    return this.stashService.createStash(request)
  }

  applyStash(request: StashActionRequest) {
    return this.stashService.applyStash(request)
  }

  dropStash(request: ConfirmedStashActionRequest) {
    return this.stashService.dropStash(request)
  }
}
