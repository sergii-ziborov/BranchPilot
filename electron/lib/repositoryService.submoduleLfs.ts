import type {
  GitLfsSummary,
  RepositorySnapshot,
  SubmoduleSummary,
  UpdateSubmoduleRequest
} from '../../src/shared/branchPilot.js'
import type { CommandRunResult } from './commandRunner.js'
import { BranchPilotUserError } from './errors.js'
import { normalizeRelativePath } from './repositoryService.helpers.js'

/** Narrow kernel slice the submodule / Git LFS domain needs (composition, not inheritance). */
export interface SubmoduleLfsKernel {
  resolveRepositoryRoot(selectedPath: string): Promise<string>
  git(
    cwd: string,
    args: string[],
    options?: { allowedExitCodes?: number[]; input?: string; timeoutMs?: number; maxOutputBytes?: number }
  ): Promise<CommandRunResult>
  getSnapshot(repoPath: string): Promise<RepositorySnapshot>
  listRepositorySubmodules(rootPath: string): Promise<SubmoduleSummary[]>
  getRepositoryGitLfsSummary(rootPath: string): Promise<GitLfsSummary>
  assertNoActiveOperation(rootPath: string): Promise<void>
  assertNoConflicts(rootPath: string, actionLabel: string): Promise<void>
}

/** Submodule sync/update and Git LFS object management. */
export class RepositorySubmoduleLfsService {
  constructor(private readonly kernel: SubmoduleLfsKernel) {}

  async listSubmodules(repoPath: string): Promise<SubmoduleSummary[]> {
    const rootPath = await this.kernel.resolveRepositoryRoot(repoPath)
    return this.kernel.listRepositorySubmodules(rootPath)
  }

  async getGitLfsSummary(repoPath: string): Promise<GitLfsSummary> {
    const rootPath = await this.kernel.resolveRepositoryRoot(repoPath)
    return this.kernel.getRepositoryGitLfsSummary(rootPath)
  }

  async updateSubmodule(request: UpdateSubmoduleRequest): Promise<RepositorySnapshot> {
    const rootPath = await this.kernel.resolveRepositoryRoot(request.repoPath)
    const submodulePath = request.path ? normalizeRelativePath(request.path) : undefined
    const submodules = await this.kernel.listRepositorySubmodules(rootPath)

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

    await this.kernel.git(rootPath, syncArgs, { timeoutMs: 120_000 })
    await this.kernel.git(rootPath, updateArgs, { timeoutMs: 120_000 })

    return this.kernel.getSnapshot(rootPath)
  }

  async pullGitLfs(repoPath: string): Promise<RepositorySnapshot> {
    const rootPath = await this.kernel.resolveRepositoryRoot(repoPath)
    const summary = await this.kernel.getRepositoryGitLfsSummary(rootPath)

    if (!summary.installed) {
      throw new BranchPilotUserError('git_lfs_missing', 'Git LFS is not installed. Install git-lfs before pulling LFS objects.')
    }

    await this.kernel.assertNoActiveOperation(rootPath)
    await this.kernel.assertNoConflicts(rootPath, 'pulling Git LFS objects')
    await this.kernel.git(rootPath, ['lfs', 'pull'], { timeoutMs: 120_000 })

    return this.kernel.getSnapshot(rootPath)
  }
}
