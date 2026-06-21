import path from 'node:path'
import type {
  CreateTagRequest,
  CreateWorktreeRequest,
  DeleteTagRequest,
  RemoveWorktreeRequest,
  RepositorySnapshot,
  WorktreeSummary
} from '../../src/shared/branchPilot.js'
import type { CommandRunResult } from './commandRunner.js'
import { BranchPilotUserError } from './errors.js'
import {
  assertWorktreeTargetAvailable,
  normalizeBranchName,
  normalizeConfigValue,
  normalizeExistingWorktreePath,
  normalizeGitRef,
  normalizeTagName,
  normalizeWorktreePath
} from './repositoryService.helpers.js'

/** Narrow kernel slice the tag / worktree domain needs (composition, not inheritance). */
export interface WorktreeTagKernel {
  resolveRepositoryRoot(selectedPath: string): Promise<string>
  git(
    cwd: string,
    args: string[],
    options?: { allowedExitCodes?: number[]; input?: string; timeoutMs?: number; maxOutputBytes?: number }
  ): Promise<CommandRunResult>
  getSnapshot(repoPath: string): Promise<RepositorySnapshot>
  getCurrentBranch(rootPath: string): Promise<string>
  assertValidTagName(rootPath: string, tagName: string): Promise<void>
  assertValidBranchName(rootPath: string, branchName: string): Promise<void>
  assertBranchDoesNotExist(rootPath: string, branchName: string): Promise<void>
  assertValidBaseRef(rootPath: string, baseRef: string): Promise<void>
  listRepositoryWorktrees(rootPath: string): Promise<WorktreeSummary[]>
}

/** Tag and linked-worktree management (ancillary repository structure). */
export class RepositoryWorktreeTagService {
  constructor(private readonly kernel: WorktreeTagKernel) {}

  async listWorktrees(repoPath: string): Promise<WorktreeSummary[]> {
    const rootPath = await this.kernel.resolveRepositoryRoot(repoPath)
    return this.kernel.listRepositoryWorktrees(rootPath)
  }

  async createTag(request: CreateTagRequest): Promise<RepositorySnapshot> {
    const rootPath = await this.kernel.resolveRepositoryRoot(request.repoPath)
    const tagName = normalizeTagName(request.tagName)
    await this.kernel.assertValidTagName(rootPath, tagName)

    const message = request.message?.trim()

    if (message) {
      await this.kernel.git(rootPath, ['tag', '-a', tagName, '-m', normalizeConfigValue(message, 'Tag message')])
    } else {
      await this.kernel.git(rootPath, ['tag', tagName])
    }

    return this.kernel.getSnapshot(rootPath)
  }

  async deleteTag(request: DeleteTagRequest): Promise<RepositorySnapshot> {
    if (!request.confirmed) {
      throw new BranchPilotUserError('confirmation_required', 'Deleting a tag requires explicit confirmation.')
    }

    const rootPath = await this.kernel.resolveRepositoryRoot(request.repoPath)
    const tagName = normalizeTagName(request.tagName)
    await this.kernel.assertValidTagName(rootPath, tagName)
    await this.kernel.git(rootPath, ['tag', '-d', tagName])

    return this.kernel.getSnapshot(rootPath)
  }

  async createWorktree(request: CreateWorktreeRequest): Promise<RepositorySnapshot> {
    const rootPath = await this.kernel.resolveRepositoryRoot(request.repoPath)
    const branchName = normalizeBranchName(request.branchName)
    const baseRef = normalizeGitRef(request.baseRef || await this.kernel.getCurrentBranch(rootPath) || 'HEAD')
    const targetPath = normalizeWorktreePath(rootPath, request.targetPath)

    await this.kernel.assertValidBranchName(rootPath, branchName)
    await this.kernel.assertBranchDoesNotExist(rootPath, branchName)
    await this.kernel.assertValidBaseRef(rootPath, baseRef)
    await assertWorktreeTargetAvailable(targetPath)
    await this.kernel.git(rootPath, ['worktree', 'add', '-b', branchName, targetPath, baseRef], { timeoutMs: 120_000 })

    return this.kernel.getSnapshot(rootPath)
  }

  async removeWorktree(request: RemoveWorktreeRequest): Promise<RepositorySnapshot> {
    if (!request.confirmed) {
      throw new BranchPilotUserError('confirmation_required', 'Removing a worktree requires explicit confirmation.')
    }

    if (request.force) {
      throw new BranchPilotUserError('unsupported_force_remove', 'Force removing worktrees is not available in BranchPilot v1.')
    }

    const rootPath = await this.kernel.resolveRepositoryRoot(request.repoPath)
    const targetPath = await normalizeExistingWorktreePath(rootPath, request.targetPath)
    const worktree = (await this.kernel.listRepositoryWorktrees(rootPath))
      .find((candidate) => path.resolve(candidate.path) === targetPath)

    if (!worktree) {
      throw new BranchPilotUserError('worktree_not_found', 'Worktree is not linked to this repository.')
    }

    if (worktree.current) {
      throw new BranchPilotUserError('current_worktree', 'Cannot remove the currently open worktree.')
    }

    await this.kernel.git(rootPath, [
      'worktree',
      'remove',
      ...(request.force ? ['--force'] : []),
      worktree.path
    ], { timeoutMs: 120_000 })

    return this.kernel.getSnapshot(rootPath)
  }
}
