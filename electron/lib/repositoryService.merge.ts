import type {
  FileActionRequest,
  MergeBranchRequest,
  MergeState,
  RepositorySnapshot
} from '../../src/shared/branchPilot.js'
import { CommandExecutionError, type CommandRunResult } from './commandRunner.js'
import { BranchPilotUserError } from './errors.js'
import { isConflictOutput, normalizeBranchName, normalizeRelativePath } from './repositoryService.helpers.js'

/** Narrow kernel slice the merge / conflict domain needs (composition, not inheritance). */
export interface MergeKernel {
  resolveRepositoryRoot(selectedPath: string): Promise<string>
  git(
    cwd: string,
    args: string[],
    options?: { allowedExitCodes?: number[]; input?: string; timeoutMs?: number; maxOutputBytes?: number }
  ): Promise<CommandRunResult>
  getSnapshot(repoPath: string): Promise<RepositorySnapshot>
  assertCurrentBranch(rootPath: string, action: string): Promise<string>
  assertNoActiveOperation(rootPath: string): Promise<void>
  getMergeState(rootPath: string, conflictFiles: MergeState['files']): Promise<MergeState>
}

/** Merge / rebase integration and conflict resolution (accept ours/theirs, continue, abort). */
export class RepositoryMergeService {
  constructor(private readonly kernel: MergeKernel) {}

  async acceptOurs(request: FileActionRequest): Promise<RepositorySnapshot> {
    const rootPath = await this.kernel.resolveRepositoryRoot(request.repoPath)
    const filePath = normalizeRelativePath(request.filePath)
    await this.kernel.git(rootPath, ['checkout', '--ours', '--', filePath])
    await this.kernel.git(rootPath, ['add', '--', filePath])
    return this.kernel.getSnapshot(rootPath)
  }

  async acceptTheirs(request: FileActionRequest): Promise<RepositorySnapshot> {
    const rootPath = await this.kernel.resolveRepositoryRoot(request.repoPath)
    const filePath = normalizeRelativePath(request.filePath)
    await this.kernel.git(rootPath, ['checkout', '--theirs', '--', filePath])
    await this.kernel.git(rootPath, ['add', '--', filePath])
    return this.kernel.getSnapshot(rootPath)
  }

  async markResolved(request: FileActionRequest): Promise<RepositorySnapshot> {
    const rootPath = await this.kernel.resolveRepositoryRoot(request.repoPath)
    await this.kernel.git(rootPath, ['add', '--', normalizeRelativePath(request.filePath)])
    return this.kernel.getSnapshot(rootPath)
  }

  async mergeBranch(request: MergeBranchRequest): Promise<RepositorySnapshot> {
    const rootPath = await this.kernel.resolveRepositoryRoot(request.repoPath)
    const currentBranch = await this.kernel.assertCurrentBranch(rootPath, 'merge')
    const branchName = normalizeBranchName(request.branchName)

    if (branchName === currentBranch) {
      throw new BranchPilotUserError('invalid_branch', 'Cannot merge the current branch into itself.')
    }

    await this.kernel.assertNoActiveOperation(rootPath)

    const result = await this.kernel.git(rootPath, ['merge', branchName], {
      allowedExitCodes: [0, 1],
      timeoutMs: 120_000
    })

    if (result.exitCode === 0) {
      return this.kernel.getSnapshot(rootPath)
    }

    const snapshot = await this.kernel.getSnapshot(rootPath)
    const output = [result.stderr, result.stdout].filter(Boolean).join('\n')

    if (snapshot.status.merge.operation !== 'none' || isConflictOutput(output)) {
      return snapshot
    }

    throw new CommandExecutionError(`${result.command} ${result.args.join(' ')} failed with exit code ${result.exitCode}`, result)
  }

  async rebaseBranch(request: MergeBranchRequest): Promise<RepositorySnapshot> {
    const rootPath = await this.kernel.resolveRepositoryRoot(request.repoPath)
    const currentBranch = await this.kernel.assertCurrentBranch(rootPath, 'rebase')
    const branchName = normalizeBranchName(request.branchName)

    if (branchName === currentBranch) {
      throw new BranchPilotUserError('invalid_branch', 'Cannot rebase the current branch onto itself.')
    }

    await this.kernel.assertNoActiveOperation(rootPath)

    const result = await this.kernel.git(rootPath, ['rebase', branchName], {
      allowedExitCodes: [0, 1],
      timeoutMs: 120_000
    })

    if (result.exitCode === 0) {
      return this.kernel.getSnapshot(rootPath)
    }

    const snapshot = await this.kernel.getSnapshot(rootPath)
    const output = [result.stderr, result.stdout].filter(Boolean).join('\n')

    if (snapshot.status.merge.operation !== 'none' || isConflictOutput(output)) {
      return snapshot
    }

    throw new CommandExecutionError(`${result.command} ${result.args.join(' ')} failed with exit code ${result.exitCode}`, result)
  }

  async continueMergeOperation(repoPath: string): Promise<RepositorySnapshot> {
    const rootPath = await this.kernel.resolveRepositoryRoot(repoPath)
    const mergeState = await this.kernel.getMergeState(rootPath, [])

    if (mergeState.operation === 'merge') {
      await this.kernel.git(rootPath, ['-c', 'core.editor=true', 'merge', '--continue'], { timeoutMs: 120_000 })
    } else if (mergeState.operation === 'rebase') {
      await this.kernel.git(rootPath, ['-c', 'core.editor=true', 'rebase', '--continue'], { timeoutMs: 120_000 })
    } else if (mergeState.operation === 'cherry-pick') {
      await this.kernel.git(rootPath, ['-c', 'core.editor=true', 'cherry-pick', '--continue'], { timeoutMs: 120_000 })
    } else {
      throw new BranchPilotUserError('no_merge_operation', 'No merge, rebase, or cherry-pick operation is in progress.')
    }

    return this.kernel.getSnapshot(rootPath)
  }

  async abortMergeOperation(repoPath: string): Promise<RepositorySnapshot> {
    const rootPath = await this.kernel.resolveRepositoryRoot(repoPath)
    const mergeState = await this.kernel.getMergeState(rootPath, [])

    if (mergeState.operation === 'merge') {
      await this.kernel.git(rootPath, ['merge', '--abort'])
    } else if (mergeState.operation === 'rebase') {
      await this.kernel.git(rootPath, ['rebase', '--abort'])
    } else if (mergeState.operation === 'cherry-pick') {
      await this.kernel.git(rootPath, ['cherry-pick', '--abort'])
    } else {
      throw new BranchPilotUserError('no_merge_operation', 'No merge, rebase, or cherry-pick operation is in progress.')
    }

    return this.kernel.getSnapshot(rootPath)
  }
}
