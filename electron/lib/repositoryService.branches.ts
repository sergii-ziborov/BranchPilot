import type {
  BranchActionRequest,
  BranchComparison,
  BranchCompareRequest,
  CommitFileChange,
  PublishBranchRequest,
  RepositorySnapshot
} from '../../src/shared/branchPilot.js'
import type { CommandRunResult } from './commandRunner.js'
import { BranchPilotUserError } from './errors.js'
import { DEFAULT_REMOTE, MAX_BRANCH_COMPARE_SUMMARY_BYTES } from './repositoryService.base.js'
import {
  normalizeBranchName,
  normalizeConfigValue,
  normalizeGitRef,
  parseBranchCompareCommitCounts
} from './repositoryService.helpers.js'

/** Narrow kernel slice the branch domain needs (composition, not inheritance). */
export interface BranchKernel {
  resolveRepositoryRoot(selectedPath: string): Promise<string>
  git(
    cwd: string,
    args: string[],
    options?: { allowedExitCodes?: number[]; input?: string; timeoutMs?: number; maxOutputBytes?: number }
  ): Promise<CommandRunResult>
  getSnapshot(repoPath: string): Promise<RepositorySnapshot>
  getCurrentBranch(rootPath: string): Promise<string>
  assertCurrentBranch(rootPath: string, action: string): Promise<string>
  assertRemoteExists(rootPath: string, remoteName: string): Promise<string>
  assertLocalBranchExists(rootPath: string, branchName: string): Promise<void>
  assertBranchDoesNotExist(rootPath: string, branchName: string): Promise<void>
  assertRemoteTrackingBranchExists(rootPath: string, upstream: string): Promise<void>
  getBranchComparisonFiles(rootPath: string, range: string): Promise<CommitFileChange[]>
}

/** Local branch lifecycle: create, rename, switch, delete, publish, upstream, description, compare. */
export class RepositoryBranchService {
  constructor(private readonly kernel: BranchKernel) {}

  async publishBranch(request: PublishBranchRequest): Promise<RepositorySnapshot> {
    const rootPath = await this.kernel.resolveRepositoryRoot(request.repoPath)
    const currentBranch = await this.kernel.assertCurrentBranch(rootPath, 'publish')
    const branch = normalizeBranchName(request.branch || currentBranch)
    const remote = await this.kernel.assertRemoteExists(rootPath, request.remote || DEFAULT_REMOTE)

    if (branch !== currentBranch) {
      throw new BranchPilotUserError('invalid_branch', 'Only the checked-out branch can be published.')
    }

    await this.kernel.git(rootPath, ['push', '-u', remote, branch], {
      timeoutMs: 120_000
    })

    return this.kernel.getSnapshot(rootPath)
  }

  async createBranch(request: BranchActionRequest): Promise<RepositorySnapshot>
  async createBranch(repoPath: string, branchName: string, description?: string): Promise<RepositorySnapshot>
  async createBranch(
    requestOrRepoPath: BranchActionRequest | string,
    branchName?: string,
    description?: string
  ): Promise<RepositorySnapshot> {
    const request = typeof requestOrRepoPath === 'string'
      ? { repoPath: requestOrRepoPath, branchName: branchName ?? '', description }
      : requestOrRepoPath
    const rootPath = await this.kernel.resolveRepositoryRoot(request.repoPath)
    const normalizedName = normalizeBranchName(request.branchName)
    const baseRef = request.baseRef ? normalizeGitRef(request.baseRef) : undefined
    const checkout = request.checkout !== false

    if (checkout) {
      await this.kernel.git(rootPath, ['switch', '-c', normalizedName, ...(baseRef ? [baseRef] : [])])
    } else {
      await this.kernel.git(rootPath, ['branch', normalizedName, ...(baseRef ? [baseRef] : [])])
    }

    if (request.description?.trim()) {
      await this.kernel.git(rootPath, [
        'config',
        `branch.${normalizedName}.description`,
        normalizeConfigValue(request.description, 'Branch description')
      ])
    }

    return this.kernel.getSnapshot(rootPath)
  }

  async renameBranch(repoPath: string, oldBranchName: string, newBranchName: string): Promise<RepositorySnapshot> {
    const rootPath = await this.kernel.resolveRepositoryRoot(repoPath)
    const oldName = normalizeBranchName(oldBranchName)
    const newName = normalizeBranchName(newBranchName)

    if (oldName === newName) {
      throw new BranchPilotUserError('same_branch', 'Choose a different branch name.')
    }

    await this.kernel.assertLocalBranchExists(rootPath, oldName)
    await this.kernel.assertBranchDoesNotExist(rootPath, newName)
    await this.kernel.git(rootPath, ['branch', '-m', oldName, newName])

    return this.kernel.getSnapshot(rootPath)
  }

  async setBranchUpstream(repoPath: string, branchName: string, upstream: string): Promise<RepositorySnapshot> {
    const rootPath = await this.kernel.resolveRepositoryRoot(repoPath)
    const normalizedName = normalizeBranchName(branchName)
    const normalizedUpstream = normalizeGitRef(upstream)

    await this.kernel.assertLocalBranchExists(rootPath, normalizedName)
    await this.kernel.assertRemoteTrackingBranchExists(rootPath, normalizedUpstream)
    await this.kernel.git(rootPath, ['branch', `--set-upstream-to=${normalizedUpstream}`, normalizedName])

    return this.kernel.getSnapshot(rootPath)
  }

  async updateBranchDescription(repoPath: string, branchName: string, description: string): Promise<RepositorySnapshot> {
    const rootPath = await this.kernel.resolveRepositoryRoot(repoPath)
    const normalizedName = normalizeBranchName(branchName)
    await this.kernel.assertLocalBranchExists(rootPath, normalizedName)

    if (description.trim()) {
      await this.kernel.git(rootPath, [
        'config',
        `branch.${normalizedName}.description`,
        normalizeConfigValue(description, 'Branch description')
      ])
    } else {
      await this.kernel.git(rootPath, ['config', '--unset', `branch.${normalizedName}.description`], {
        allowedExitCodes: [0, 5]
      })
    }

    return this.kernel.getSnapshot(rootPath)
  }

  async switchBranch(repoPath: string, branchName: string, stashChanges = false): Promise<RepositorySnapshot> {
    const rootPath = await this.kernel.resolveRepositoryRoot(repoPath)

    if (stashChanges) {
      // "Leave my changes" — stash on the current branch before switching away.
      await this.kernel.git(rootPath, ['stash', 'push', '--include-untracked', '-m', 'BranchPilot: auto-stash on branch switch'])
    }

    await this.kernel.git(rootPath, ['switch', normalizeBranchName(branchName)])
    return this.kernel.getSnapshot(rootPath)
  }

  async deleteBranch(repoPath: string, branchName: string, force: boolean, confirmed: boolean): Promise<RepositorySnapshot> {
    if (!confirmed) {
      throw new BranchPilotUserError('confirmation_required', 'Deleting a branch requires explicit confirmation.')
    }

    const rootPath = await this.kernel.resolveRepositoryRoot(repoPath)
    const normalizedName = normalizeBranchName(branchName)
    const currentBranch = await this.kernel.getCurrentBranch(rootPath)

    if (currentBranch === normalizedName) {
      throw new BranchPilotUserError('git_current_branch', 'Cannot delete the checked-out branch. Switch branches first.')
    }

    await this.kernel.git(rootPath, ['branch', force ? '-D' : '-d', normalizedName])
    return this.kernel.getSnapshot(rootPath)
  }

  async compareBranch(request: BranchCompareRequest): Promise<BranchComparison> {
    const rootPath = await this.kernel.resolveRepositoryRoot(request.repoPath)
    const baseBranch = normalizeBranchName(request.baseBranch ?? await this.kernel.assertCurrentBranch(rootPath, 'compare branches'))
    const targetBranch = normalizeBranchName(request.targetBranch)

    await this.kernel.assertLocalBranchExists(rootPath, baseBranch)
    await this.kernel.assertLocalBranchExists(rootPath, targetBranch)

    if (baseBranch === targetBranch) {
      throw new BranchPilotUserError('same_branch', 'Choose a different branch to compare.')
    }

    const range = `${baseBranch}...${targetBranch}`
    const commitCounts = await this.kernel.git(rootPath, ['rev-list', '--left-right', '--count', range])
    const [baseOnlyCommits, targetOnlyCommits] = parseBranchCompareCommitCounts(commitCounts.stdout)
    const files = await this.kernel.getBranchComparisonFiles(rootPath, range)
    const summary = await this.kernel.git(rootPath, [
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
}
