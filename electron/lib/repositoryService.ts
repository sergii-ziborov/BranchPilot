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
  GitConfigSnapshot,
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
  normalizeConfigValue,
  normalizeHunkPatch,
  normalizeRelativePath,
  normalizeRemoteName,
  normalizeRemoteUrl,
  normalizeStashMessage,
  normalizeStashRef,
  pathExists
} from './repositoryService.helpers.js'
import {
  RepositoryServiceWrites
} from './repositoryService.writes.js'

export class RepositoryService extends RepositoryServiceWrites {
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
}
