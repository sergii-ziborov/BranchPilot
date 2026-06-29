import type {
  CommitRequest,
  ConfirmedCommitReferenceRequest,
  ConfirmedCommitRequest,
  MergeState,
  RepositorySnapshot
} from '../../src/shared/branchPilot.js'
import { CommandExecutionError, type CommandRunResult } from './commandRunner.js'
import { BranchPilotUserError } from './errors.js'
import { parseGitStatus } from './gitStatusParser.js'
import { buildCommitMessage, isConflictOutput, normalizeCommitSha } from './repositoryService.helpers.js'

/** Narrow kernel slice the commit domain needs (composition, not inheritance). */
export interface CommitKernel {
  resolveRepositoryRoot(selectedPath: string): Promise<string>
  git(
    cwd: string,
    args: string[],
    options?: { allowedExitCodes?: number[]; input?: string; timeoutMs?: number; maxOutputBytes?: number }
  ): Promise<CommandRunResult>
  getSnapshot(repoPath: string): Promise<RepositorySnapshot>
  getMergeState(rootPath: string, conflictFiles: MergeState['files']): Promise<MergeState>
  assertNoActiveOperation(rootPath: string): Promise<void>
  assertNoConflicts(rootPath: string, actionLabel: string): Promise<void>
  gitCommitWithMessageFile(rootPath: string, argsPrefix: string[], message: string): Promise<void>
}

/** Commit creation and history operations: commit, amend, revert, cherry-pick. */
export class RepositoryCommitService {
  constructor(private readonly kernel: CommitKernel) {}

  async commit(request: CommitRequest): Promise<RepositorySnapshot> {
    const title = request.title.trim()

    if (!title) {
      throw new BranchPilotUserError('invalid_commit_message', 'Commit title is required.')
    }

    const rootPath = await this.kernel.resolveRepositoryRoot(request.repoPath)
    const hasNoStagedChanges = await this.kernel.git(rootPath, ['diff', '--cached', '--quiet'], {
      allowedExitCodes: [0, 1]
    })

    if (hasNoStagedChanges.exitCode === 0) {
      throw new BranchPilotUserError('nothing_to_commit', 'Stage at least one change before committing.')
    }

    const message = buildCommitMessage(title, request.description, request.coAuthors)
    await this.kernel.gitCommitWithMessageFile(rootPath, ['commit', '-F'], message)

    return this.kernel.getSnapshot(rootPath)
  }

  async amendCommit(request: ConfirmedCommitRequest): Promise<RepositorySnapshot> {
    if (!request.confirmed) {
      throw new BranchPilotUserError('confirmation_required', 'Amending the last commit requires explicit confirmation.')
    }

    const title = request.title.trim()

    if (!title) {
      throw new BranchPilotUserError('invalid_commit_message', 'Commit title is required.')
    }

    const rootPath = await this.kernel.resolveRepositoryRoot(request.repoPath)
    await this.kernel.git(rootPath, ['rev-parse', '--verify', 'HEAD'])

    const statusOutput = await this.kernel.git(rootPath, ['status', '--porcelain=v2', '-z', '--branch', '--untracked-files=all'])
    const parsedStatus = parseGitStatus(statusOutput.stdout)
    const mergeState = await this.kernel.getMergeState(rootPath, parsedStatus.conflicts)

    if (mergeState.operation !== 'none') {
      throw new BranchPilotUserError('git_operation_in_progress', `Finish or abort the ${mergeState.operation} before amending.`)
    }

    if (parsedStatus.counts.conflicted > 0) {
      throw new BranchPilotUserError('conflicts_present', 'Resolve conflicted files before amending.')
    }

    const message = buildCommitMessage(title, request.description, request.coAuthors)
    await this.kernel.gitCommitWithMessageFile(rootPath, ['commit', '--amend', '-F'], message)

    return this.kernel.getSnapshot(rootPath)
  }

  async revertCommit(request: ConfirmedCommitReferenceRequest): Promise<RepositorySnapshot> {
    if (!request.confirmed) {
      throw new BranchPilotUserError('confirmation_required', 'Reverting a commit requires explicit confirmation.')
    }

    const rootPath = await this.kernel.resolveRepositoryRoot(request.repoPath)
    const commitSha = normalizeCommitSha(request.commitSha)

    await this.kernel.assertNoActiveOperation(rootPath)
    await this.kernel.assertNoConflicts(rootPath, 'reverting')

    const result = await this.kernel.git(rootPath, ['revert', '--no-edit', commitSha], {
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

  async cherryPickCommit(request: ConfirmedCommitReferenceRequest): Promise<RepositorySnapshot> {
    if (!request.confirmed) {
      throw new BranchPilotUserError('confirmation_required', 'Cherry-picking a commit requires explicit confirmation.')
    }

    const rootPath = await this.kernel.resolveRepositoryRoot(request.repoPath)
    const commitSha = normalizeCommitSha(request.commitSha)

    await this.kernel.assertNoActiveOperation(rootPath)
    await this.kernel.assertNoConflicts(rootPath, 'cherry-picking')

    const result = await this.kernel.git(rootPath, ['cherry-pick', commitSha], {
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

  async resetToCommit(request: ConfirmedCommitReferenceRequest): Promise<RepositorySnapshot> {
    if (!request.confirmed) {
      throw new BranchPilotUserError('confirmation_required', 'Resetting to a commit requires explicit confirmation.')
    }

    const rootPath = await this.kernel.resolveRepositoryRoot(request.repoPath)
    const commitSha = normalizeCommitSha(request.commitSha)

    await this.kernel.assertNoActiveOperation(rootPath)
    await this.kernel.assertNoConflicts(rootPath, 'resetting')
    await this.kernel.git(rootPath, ['reset', '--hard', commitSha], { timeoutMs: 120_000 })

    return this.kernel.getSnapshot(rootPath)
  }
}
