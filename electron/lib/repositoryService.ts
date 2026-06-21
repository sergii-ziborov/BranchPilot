import {
  promises as fs
} from 'node:fs'
import { spawn } from 'node:child_process'
import path from 'node:path'
import type {
  CloneRepositoryRequest,
  ImagePreview,
  ImagePreviewRequest,
  RecentRepository,
  RepositoryPinRequest,
  RepositorySnapshot
} from '../../src/shared/branchPilot.js'
import {
  BranchPilotUserError
} from './errors.js'
import {
  cloneNameFromRemoteUrl,
  imageMimeFromPath,
  MAX_IMAGE_PREVIEW_BYTES,
  resolveRepositoryPath,
  normalizeCloneParentPath,
  normalizeCloneRemoteUrl,
  normalizeCloneTargetName,
  normalizeCommitSha,
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
import { RepositoryBranchService } from './repositoryService.branches.js'
import { RepositoryMergeService } from './repositoryService.merge.js'
import { RepositoryStagingService } from './repositoryService.staging.js'
import { RepositoryCommitService } from './repositoryService.commits.js'

export class RepositoryService extends RepositoryServiceWrites {
  // Composition over inheritance: each cohesive domain lives in its own collaborator,
  // wired to a narrow slice of this service's git kernel. The IPC layer calls these
  // sub-services directly (e.g. repositoryService.branches.createBranch(...)), so the
  // facade stays a thin composition root rather than a wall of delegations.
  readonly activity = new RepositoryActivityAnalytics({
    resolveRepositoryRoot: (selectedPath) => this.resolveRepositoryRoot(selectedPath),
    getRecentRepositories: () => this.settings.getRecentRepositories(),
    getConfig: (rootPath, key, scope) => this.getConfig(rootPath, key, scope),
    git: (cwd, args, options) => this.git(cwd, args, options)
  })

  readonly dashboard = new RepositoryDashboardService({
    resolveRepositoryRoot: (selectedPath) => this.resolveRepositoryRoot(selectedPath),
    getRecentRepositories: () => this.settings.getRecentRepositories(),
    getRepositoryStatusContext: (rootPath, options) => this.getRepositoryStatusContext(rootPath, options),
    listBranches: (rootPath, options) => this.listBranches(rootPath, options)
  })

  readonly stash = new RepositoryStashService({
    resolveRepositoryRoot: (selectedPath) => this.resolveRepositoryRoot(selectedPath),
    git: (cwd, args, options) => this.git(cwd, args, options),
    getSnapshot: (repoPath) => this.getSnapshot(repoPath),
    getStatusOnlySnapshot: (rootPath) => this.getStatusOnlySnapshot(rootPath)
  })

  readonly config = new RepositoryConfigService({
    resolveRepositoryRoot: (selectedPath) => this.resolveRepositoryRoot(selectedPath),
    git: (cwd, args, options) => this.git(cwd, args, options),
    getConfig: (rootPath, key, scope) => this.getConfig(rootPath, key, scope),
    listRemotes: (rootPath) => this.listRemotes(rootPath),
    getDefaultBranch: (rootPath, remotes) => this.getDefaultBranch(rootPath, remotes),
    assertRemoteMissing: (rootPath, name) => this.assertRemoteMissing(rootPath, name),
    assertRemoteExists: (rootPath, name) => this.assertRemoteExists(rootPath, name)
  })

  readonly worktreeTag = new RepositoryWorktreeTagService({
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

  readonly submoduleLfs = new RepositorySubmoduleLfsService({
    resolveRepositoryRoot: (selectedPath) => this.resolveRepositoryRoot(selectedPath),
    git: (cwd, args, options) => this.git(cwd, args, options),
    getSnapshot: (repoPath) => this.getSnapshot(repoPath),
    listRepositorySubmodules: (rootPath) => this.listRepositorySubmodules(rootPath),
    getRepositoryGitLfsSummary: (rootPath) => this.getRepositoryGitLfsSummary(rootPath),
    assertNoActiveOperation: (rootPath) => this.assertNoActiveOperation(rootPath),
    assertNoConflicts: (rootPath, actionLabel) => this.assertNoConflicts(rootPath, actionLabel)
  })

  readonly branches = new RepositoryBranchService({
    resolveRepositoryRoot: (selectedPath) => this.resolveRepositoryRoot(selectedPath),
    git: (cwd, args, options) => this.git(cwd, args, options),
    getSnapshot: (repoPath) => this.getSnapshot(repoPath),
    getCurrentBranch: (rootPath) => this.getCurrentBranch(rootPath),
    assertCurrentBranch: (rootPath, action) => this.assertCurrentBranch(rootPath, action),
    assertRemoteExists: (rootPath, name) => this.assertRemoteExists(rootPath, name),
    assertLocalBranchExists: (rootPath, name) => this.assertLocalBranchExists(rootPath, name),
    assertBranchDoesNotExist: (rootPath, name) => this.assertBranchDoesNotExist(rootPath, name),
    assertRemoteTrackingBranchExists: (rootPath, upstream) => this.assertRemoteTrackingBranchExists(rootPath, upstream),
    getBranchComparisonFiles: (rootPath, range) => this.getBranchComparisonFiles(rootPath, range)
  })

  readonly merge = new RepositoryMergeService({
    resolveRepositoryRoot: (selectedPath) => this.resolveRepositoryRoot(selectedPath),
    git: (cwd, args, options) => this.git(cwd, args, options),
    getSnapshot: (repoPath) => this.getSnapshot(repoPath),
    assertCurrentBranch: (rootPath, action) => this.assertCurrentBranch(rootPath, action),
    assertNoActiveOperation: (rootPath) => this.assertNoActiveOperation(rootPath),
    getMergeState: (rootPath, conflictFiles) => this.getMergeState(rootPath, conflictFiles)
  })

  readonly staging = new RepositoryStagingService({
    resolveRepositoryRoot: (selectedPath) => this.resolveRepositoryRoot(selectedPath),
    git: (cwd, args, options) => this.git(cwd, args, options),
    getStatusOnlySnapshot: (rootPath) => this.getStatusOnlySnapshot(rootPath)
  })

  readonly commits = new RepositoryCommitService({
    resolveRepositoryRoot: (selectedPath) => this.resolveRepositoryRoot(selectedPath),
    git: (cwd, args, options) => this.git(cwd, args, options),
    getSnapshot: (repoPath) => this.getSnapshot(repoPath),
    getMergeState: (rootPath, conflictFiles) => this.getMergeState(rootPath, conflictFiles),
    assertNoActiveOperation: (rootPath) => this.assertNoActiveOperation(rootPath),
    assertNoConflicts: (rootPath, actionLabel) => this.assertNoConflicts(rootPath, actionLabel),
    gitCommitWithMessageFile: (rootPath, argsPrefix, message) => this.gitCommitWithMessageFile(rootPath, argsPrefix, message)
  })

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

}
