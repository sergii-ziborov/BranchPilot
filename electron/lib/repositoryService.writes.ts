import {
  promises as fs
} from 'node:fs'
import path from 'node:path'
import type {
  ApplyPatchRequest,
  CreateTagRequest,
  CreateWorktreeRequest,
  DeleteTagRequest,
  ExportPatchRequest,
  ExportedPatch,
  FileActionRequest,
  MergeBranchRequest,
  PublishBranchRequest,
  RemoveWorktreeRequest,
  RepositorySnapshot,
  UpdateSubmoduleRequest
} from '../../src/shared/branchPilot.js'
import {
  CommandExecutionError
} from './commandRunner.js'
import {
  BranchPilotUserError
} from './errors.js'
import {
  assertPatchFileExists,
  assertWorktreeTargetAvailable,
  isConflictOutput,
  normalizeBranchName,
  normalizeConfigValue,
  normalizeExistingWorktreePath,
  normalizeGitRef,
  normalizePatchInputPath,
  normalizePatchOutputPath,
  normalizePatchScope,
  normalizeRelativePath,
  normalizeTagName,
  normalizeWorktreePath
} from './repositoryService.helpers.js'
import {
  DEFAULT_REMOTE
} from './repositoryService.base.js'
import {
  RepositoryServiceQueries
} from './repositoryService.queries.js'

export class RepositoryServiceWrites extends RepositoryServiceQueries {
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
    // --autostash: uncommitted changes are stashed before the pull and restored
    // after, so a dirty working tree no longer turns a pull into a hard error.
    await this.git(rootPath, ['pull', '--ff-only', '--autostash'], { timeoutMs: 120_000 })
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

  async renameBranch(repoPath: string, oldBranchName: string, newBranchName: string): Promise<RepositorySnapshot> {
    const rootPath = await this.resolveRepositoryRoot(repoPath)
    const oldName = normalizeBranchName(oldBranchName)
    const newName = normalizeBranchName(newBranchName)

    if (oldName === newName) {
      throw new BranchPilotUserError('same_branch', 'Choose a different branch name.')
    }

    await this.assertLocalBranchExists(rootPath, oldName)
    await this.assertBranchDoesNotExist(rootPath, newName)
    await this.git(rootPath, ['branch', '-m', oldName, newName])

    return this.getSnapshot(rootPath)
  }

  async setBranchUpstream(repoPath: string, branchName: string, upstream: string): Promise<RepositorySnapshot> {
    const rootPath = await this.resolveRepositoryRoot(repoPath)
    const normalizedName = normalizeBranchName(branchName)
    const normalizedUpstream = normalizeGitRef(upstream)

    await this.assertLocalBranchExists(rootPath, normalizedName)
    await this.assertRemoteTrackingBranchExists(rootPath, normalizedUpstream)
    await this.git(rootPath, ['branch', `--set-upstream-to=${normalizedUpstream}`, normalizedName])

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

  async switchBranch(repoPath: string, branchName: string, stashChanges = false): Promise<RepositorySnapshot> {
    const rootPath = await this.resolveRepositoryRoot(repoPath)

    if (stashChanges) {
      // "Leave my changes" — stash on the current branch before switching away.
      await this.git(rootPath, ['stash', 'push', '--include-untracked', '-m', 'BranchPilot: auto-stash on branch switch'])
    }

    await this.git(rootPath, ['switch', normalizeBranchName(branchName)])
    return this.getSnapshot(rootPath)
  }

  async deleteBranch(repoPath: string, branchName: string, force: boolean, confirmed: boolean): Promise<RepositorySnapshot> {
    if (!confirmed) {
      throw new BranchPilotUserError('confirmation_required', 'Deleting a branch requires explicit confirmation.')
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

  async rebaseBranch(request: MergeBranchRequest): Promise<RepositorySnapshot> {
    const rootPath = await this.resolveRepositoryRoot(request.repoPath)
    const currentBranch = await this.assertCurrentBranch(rootPath, 'rebase')
    const branchName = normalizeBranchName(request.branchName)

    if (branchName === currentBranch) {
      throw new BranchPilotUserError('invalid_branch', 'Cannot rebase the current branch onto itself.')
    }

    await this.assertNoActiveOperation(rootPath)

    const result = await this.git(rootPath, ['rebase', branchName], {
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

}
