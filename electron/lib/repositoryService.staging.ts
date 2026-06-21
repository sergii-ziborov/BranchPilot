import type {
  FileActionRequest,
  HunkActionRequest,
  RepositorySnapshot
} from '../../src/shared/branchPilot.js'
import type { CommandRunResult } from './commandRunner.js'
import { BranchPilotUserError } from './errors.js'
import { normalizeHunkPatch, normalizeRelativePath } from './repositoryService.helpers.js'

/** Narrow kernel slice the staging domain needs (composition, not inheritance). */
export interface StagingKernel {
  resolveRepositoryRoot(selectedPath: string): Promise<string>
  git(
    cwd: string,
    args: string[],
    options?: { allowedExitCodes?: number[]; input?: string; timeoutMs?: number; maxOutputBytes?: number }
  ): Promise<CommandRunResult>
  getStatusOnlySnapshot(rootPath: string): Promise<RepositorySnapshot>
}

/** Working-tree / index staging: stage, unstage, discard (files, hunks, and all). */
export class RepositoryStagingService {
  constructor(private readonly kernel: StagingKernel) {}

  async stageFile(request: FileActionRequest): Promise<RepositorySnapshot> {
    const rootPath = await this.kernel.resolveRepositoryRoot(request.repoPath)
    await this.kernel.git(rootPath, ['add', '--', normalizeRelativePath(request.filePath)])
    return this.kernel.getStatusOnlySnapshot(rootPath)
  }

  async unstageFile(request: FileActionRequest): Promise<RepositorySnapshot> {
    const rootPath = await this.kernel.resolveRepositoryRoot(request.repoPath)
    await this.kernel.git(rootPath, ['restore', '--staged', '--', normalizeRelativePath(request.filePath)])
    return this.kernel.getStatusOnlySnapshot(rootPath)
  }

  async stageHunk(request: HunkActionRequest): Promise<RepositorySnapshot> {
    const rootPath = await this.kernel.resolveRepositoryRoot(request.repoPath)
    const filePath = normalizeRelativePath(request.filePath)
    const patch = normalizeHunkPatch(request.patch, filePath)

    await this.kernel.git(rootPath, ['apply', '--cached', '--whitespace=nowarn'], {
      input: patch,
      timeoutMs: 30_000
    })

    return this.kernel.getStatusOnlySnapshot(rootPath)
  }

  async unstageHunk(request: HunkActionRequest): Promise<RepositorySnapshot> {
    const rootPath = await this.kernel.resolveRepositoryRoot(request.repoPath)
    const filePath = normalizeRelativePath(request.filePath)
    const patch = normalizeHunkPatch(request.patch, filePath)

    await this.kernel.git(rootPath, ['apply', '--reverse', '--cached', '--whitespace=nowarn'], {
      input: patch,
      timeoutMs: 30_000
    })

    return this.kernel.getStatusOnlySnapshot(rootPath)
  }

  /** Permanently reverts a single unstaged hunk in the working tree (GitHub-Desktop-style discard). */
  async discardHunk(request: HunkActionRequest): Promise<RepositorySnapshot> {
    const rootPath = await this.kernel.resolveRepositoryRoot(request.repoPath)
    const filePath = normalizeRelativePath(request.filePath)
    const patch = normalizeHunkPatch(request.patch, filePath)

    await this.kernel.git(rootPath, ['apply', '--reverse', '--whitespace=nowarn'], {
      input: patch,
      timeoutMs: 30_000
    })

    return this.kernel.getStatusOnlySnapshot(rootPath)
  }

  async stageAll(repoPath: string): Promise<RepositorySnapshot> {
    const rootPath = await this.kernel.resolveRepositoryRoot(repoPath)
    await this.kernel.git(rootPath, ['add', '-A'])
    return this.kernel.getStatusOnlySnapshot(rootPath)
  }

  async unstageAll(repoPath: string): Promise<RepositorySnapshot> {
    const rootPath = await this.kernel.resolveRepositoryRoot(repoPath)
    await this.kernel.git(rootPath, ['restore', '--staged', '--', '.'])
    return this.kernel.getStatusOnlySnapshot(rootPath)
  }

  async discardFile(request: FileActionRequest & { confirmed: boolean }): Promise<RepositorySnapshot> {
    if (!request.confirmed) {
      throw new BranchPilotUserError('confirmation_required', 'Discard requires explicit confirmation.')
    }

    const rootPath = await this.kernel.resolveRepositoryRoot(request.repoPath)
    await this.kernel.git(rootPath, ['restore', '--', normalizeRelativePath(request.filePath)])
    return this.kernel.getStatusOnlySnapshot(rootPath)
  }

  async deleteUntrackedFile(request: FileActionRequest & { confirmed: boolean }): Promise<RepositorySnapshot> {
    if (!request.confirmed) {
      throw new BranchPilotUserError('confirmation_required', 'Deleting an untracked file requires explicit confirmation.')
    }

    const rootPath = await this.kernel.resolveRepositoryRoot(request.repoPath)
    await this.kernel.git(rootPath, ['clean', '-f', '--', normalizeRelativePath(request.filePath)])
    return this.kernel.getStatusOnlySnapshot(rootPath)
  }
}
