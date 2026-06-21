import type {
  ConfirmedStashActionRequest,
  CreateStashRequest,
  RepositorySnapshot,
  StashActionRequest,
  StashEntry
} from '../../src/shared/branchPilot.js'
import type { CommandRunResult } from './commandRunner.js'
import { BranchPilotUserError } from './errors.js'
import { parseStashEntry } from './repositoryService.parsers.js'
import { normalizeStashMessage, normalizeStashRef } from './repositoryService.helpers.js'

/** Narrow kernel slice the stash domain needs (composition, not inheritance). */
export interface StashKernel {
  resolveRepositoryRoot(selectedPath: string): Promise<string>
  git(
    cwd: string,
    args: string[],
    options?: { allowedExitCodes?: number[]; input?: string; timeoutMs?: number; maxOutputBytes?: number }
  ): Promise<CommandRunResult>
  getSnapshot(repoPath: string): Promise<RepositorySnapshot>
  getStatusOnlySnapshot(rootPath: string): Promise<RepositorySnapshot>
}

/** Git stash operations: list, push, apply, drop. */
export class RepositoryStashService {
  constructor(private readonly kernel: StashKernel) {}

  async listStashes(repoPath: string): Promise<StashEntry[]> {
    const rootPath = await this.kernel.resolveRepositoryRoot(repoPath)
    const result = await this.kernel.git(rootPath, ['stash', 'list', '--format=%gd%x00%H%x00%cr%x00%gs'], {
      allowedExitCodes: [0]
    })

    return result.stdout
      .split('\n')
      .filter(Boolean)
      .map(parseStashEntry)
  }

  async createStash(request: CreateStashRequest): Promise<RepositorySnapshot> {
    const rootPath = await this.kernel.resolveRepositoryRoot(request.repoPath)
    const snapshot = await this.kernel.getSnapshot(rootPath)

    if (snapshot.status.counts.changed === 0) {
      throw new BranchPilotUserError('nothing_to_stash', 'No local changes to stash.')
    }

    const args = ['stash', 'push']

    if (request.includeUntracked) {
      args.push('-u')
    }

    args.push('-m', normalizeStashMessage(request.message))

    await this.kernel.git(rootPath, args, { timeoutMs: 120_000 })

    return this.kernel.getStatusOnlySnapshot(rootPath)
  }

  async applyStash(request: StashActionRequest): Promise<RepositorySnapshot> {
    const rootPath = await this.kernel.resolveRepositoryRoot(request.repoPath)
    await this.kernel.git(rootPath, ['stash', 'apply', normalizeStashRef(request.stashRef)], { timeoutMs: 120_000 })

    return this.kernel.getStatusOnlySnapshot(rootPath)
  }

  async dropStash(request: ConfirmedStashActionRequest): Promise<RepositorySnapshot> {
    if (!request.confirmed) {
      throw new BranchPilotUserError('confirmation_required', 'Dropping a stash requires explicit confirmation.')
    }

    const rootPath = await this.kernel.resolveRepositoryRoot(request.repoPath)
    await this.kernel.git(rootPath, ['stash', 'drop', normalizeStashRef(request.stashRef)], { timeoutMs: 120_000 })

    return this.kernel.getStatusOnlySnapshot(rootPath)
  }
}
