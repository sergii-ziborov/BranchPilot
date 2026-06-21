import type {
  GitConfigSnapshot,
  GitIdentityUpdate,
  RemoteRemoveRequest,
  RemoteSummary,
  RemoteUpsertRequest
} from '../../src/shared/branchPilot.js'
import type { CommandRunResult } from './commandRunner.js'
import type { GitDefaultBranchResult } from './repositoryService.base.js'
import { BranchPilotUserError } from './errors.js'
import { normalizeConfigValue, normalizeRemoteName, normalizeRemoteUrl } from './repositoryService.helpers.js'

/** Narrow kernel slice the config / remotes domain needs (composition, not inheritance). */
export interface ConfigKernel {
  resolveRepositoryRoot(selectedPath: string): Promise<string>
  git(
    cwd: string,
    args: string[],
    options?: { allowedExitCodes?: number[]; input?: string; timeoutMs?: number; maxOutputBytes?: number }
  ): Promise<CommandRunResult>
  getConfig(rootPath: string, key: string, scope?: 'local' | 'global'): Promise<string | undefined>
  listRemotes(rootPath: string): Promise<RemoteSummary[]>
  getDefaultBranch(rootPath: string, remotes: RemoteSummary[]): Promise<GitDefaultBranchResult>
  assertRemoteMissing(rootPath: string, name: string): Promise<void>
  assertRemoteExists(rootPath: string, remoteName: string): Promise<string>
}

/** Git identity, signing, default-branch and remote management. */
export class RepositoryConfigService {
  constructor(private readonly kernel: ConfigKernel) {}

  async getGitConfig(repoPath: string): Promise<GitConfigSnapshot> {
    const rootPath = await this.kernel.resolveRepositoryRoot(repoPath)
    const localUserName = await this.kernel.getConfig(rootPath, 'user.name', 'local')
    const localUserEmail = await this.kernel.getConfig(rootPath, 'user.email', 'local')
    const globalUserName = await this.kernel.getConfig(rootPath, 'user.name', 'global')
    const globalUserEmail = await this.kernel.getConfig(rootPath, 'user.email', 'global')
    const localSigning = await this.kernel.getConfig(rootPath, 'commit.gpgsign', 'local')
    const globalSigning = await this.kernel.getConfig(rootPath, 'commit.gpgsign', 'global')
    const signingValue = localSigning ?? globalSigning
    const remotes = await this.kernel.listRemotes(rootPath)
    const defaultBranch = await this.kernel.getDefaultBranch(rootPath, remotes)

    return {
      localUserName,
      localUserEmail,
      globalUserName,
      globalUserEmail,
      effectiveUserName: localUserName ?? globalUserName,
      effectiveUserEmail: localUserEmail ?? globalUserEmail,
      defaultBranch: defaultBranch.name,
      defaultBranchSource: defaultBranch.source,
      defaultBranchRemote: defaultBranch.remote,
      commitSigningEnabled: signingValue ? signingValue === 'true' : undefined,
      commitSigningSource: localSigning ? 'local' : globalSigning ? 'global' : 'unset',
      remotes
    }
  }

  async setLocalGitIdentity(request: GitIdentityUpdate): Promise<GitConfigSnapshot> {
    const rootPath = await this.kernel.resolveRepositoryRoot(request.repoPath)
    const name = normalizeConfigValue(request.name, 'Name')
    const email = normalizeConfigValue(request.email, 'Email')

    await this.kernel.git(rootPath, ['config', '--local', 'user.name', name])
    await this.kernel.git(rootPath, ['config', '--local', 'user.email', email])

    return this.getGitConfig(rootPath)
  }

  async addRemote(request: RemoteUpsertRequest): Promise<GitConfigSnapshot> {
    const rootPath = await this.kernel.resolveRepositoryRoot(request.repoPath)
    const name = normalizeRemoteName(request.name)
    const url = normalizeRemoteUrl(request.url)

    await this.kernel.assertRemoteMissing(rootPath, name)
    await this.kernel.git(rootPath, ['remote', 'add', name, url])

    return this.getGitConfig(rootPath)
  }

  async setRemoteUrl(request: RemoteUpsertRequest): Promise<GitConfigSnapshot> {
    const rootPath = await this.kernel.resolveRepositoryRoot(request.repoPath)
    const name = normalizeRemoteName(request.name)
    const url = normalizeRemoteUrl(request.url)

    await this.kernel.assertRemoteExists(rootPath, name)
    await this.kernel.git(rootPath, ['remote', 'set-url', name, url])

    return this.getGitConfig(rootPath)
  }

  async removeRemote(request: RemoteRemoveRequest): Promise<GitConfigSnapshot> {
    if (!request.confirmed) {
      throw new BranchPilotUserError('confirmation_required', 'Removing a remote requires explicit confirmation.')
    }

    const rootPath = await this.kernel.resolveRepositoryRoot(request.repoPath)
    const name = normalizeRemoteName(request.name)

    await this.kernel.assertRemoteExists(rootPath, name)
    await this.kernel.git(rootPath, ['remote', 'remove', name])

    return this.getGitConfig(rootPath)
  }
}
