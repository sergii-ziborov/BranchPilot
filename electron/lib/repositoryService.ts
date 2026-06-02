import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type {
  BranchSummary,
  CommitDetails,
  CommitDetailsRequest,
  CommitFileChange,
  CommitFileDiffRequest,
  ConfirmedStashActionRequest,
  CommitRequest,
  CreateStashRequest,
  CommitSummary,
  DiffRequest,
  DiffResult,
  FileActionRequest,
  GitConfigSnapshot,
  GitIdentityUpdate,
  HunkActionRequest,
  MergeBranchRequest,
  MergeState,
  PublishBranchRequest,
  RecentRepository,
  RemoteSummary,
  RepositorySnapshot,
  RepositoryStatus,
  RepositorySummary,
  StashActionRequest,
  StashEntry
} from '../../src/shared/branchPilot.js'
import { CommandExecutionError, CommandRunner } from './commandRunner.js'
import { parseUnifiedDiff } from './diffParser.js'
import { BranchPilotUserError } from './errors.js'
import { parseGitStatus } from './gitStatusParser.js'
import { SettingsStore } from './settingsStore.js'

const MAX_DIFF_BYTES = 350_000
const DEFAULT_REMOTE = 'origin'

export class RepositoryService {
  constructor(
    private readonly runner: CommandRunner,
    private readonly settings: SettingsStore
  ) {}

  async openRepository(selectedPath: string): Promise<RepositorySnapshot> {
    const rootPath = await this.resolveRepositoryRoot(selectedPath)
    await this.ensureSupportedRepository(rootPath)
    await this.settings.rememberRepository(rootPath)

    return this.getSnapshot(rootPath)
  }

  async getRecentRepositories(): Promise<RecentRepository[]> {
    return this.settings.getRecentRepositories()
  }

  async getSnapshot(repoPath: string): Promise<RepositorySnapshot> {
    const rootPath = await this.resolveRepositoryRoot(repoPath)
    const statusOutput = await this.git(rootPath, ['status', '--porcelain=v2', '-z', '--branch'])
    const parsedStatus = parseGitStatus(statusOutput.stdout)
    const remote = await this.getPrimaryRemote(rootPath)
    const gitUserName = await this.getConfig(rootPath, 'user.name')
    const gitUserEmail = await this.getConfig(rootPath, 'user.email')

    const summary: RepositorySummary = {
      rootPath,
      name: path.basename(rootPath),
      currentBranch: parsedStatus.branch || 'Unknown',
      headOid: parsedStatus.headOid,
      upstream: parsedStatus.upstream,
      ahead: parsedStatus.ahead,
      behind: parsedStatus.behind,
      remoteName: remote?.name,
      remoteUrl: remote?.url,
      isDetached: parsedStatus.isDetached,
      gitUserName,
      gitUserEmail
    }

    const status: RepositoryStatus = {
      summary,
      changes: parsedStatus.changes,
      counts: parsedStatus.counts,
      merge: await this.getMergeState(rootPath, parsedStatus.conflicts)
    }

    return {
      summary,
      status,
      branches: await this.listBranches(rootPath),
      recentRepositories: await this.settings.getRecentRepositories()
    }
  }

  async getDiff(request: DiffRequest): Promise<DiffResult> {
    const rootPath = await this.resolveRepositoryRoot(request.repoPath)
    const relativePath = normalizeRelativePath(request.filePath)

    if (!request.staged && await this.isUntracked(rootPath, relativePath)) {
      return this.getUntrackedFilePreview(rootPath, relativePath)
    }

    const args = ['diff', '--no-ext-diff', '--unified=3']

    if (request.staged) {
      args.push('--cached')
    }

    args.push('--', relativePath)

    const result = await this.git(rootPath, args, { allowedExitCodes: [0, 1] })
    const binary = result.stdout.includes('Binary files') || result.stdout.includes('GIT binary patch')
    const tooLarge = result.stdout.length > MAX_DIFF_BYTES

    const text = tooLarge ? result.stdout.slice(0, MAX_DIFF_BYTES) : result.stdout

    return {
      filePath: relativePath,
      staged: request.staged,
      text,
      binary,
      tooLarge,
      files: binary || tooLarge ? [] : parseUnifiedDiff(text)
    }
  }

  async getHistory(repoPath: string): Promise<CommitSummary[]> {
    const rootPath = await this.resolveRepositoryRoot(repoPath)
    const result = await this.git(rootPath, [
      'log',
      '--max-count=200',
      '--date=iso-strict',
      '--pretty=format:%H%x00%h%x00%s%x00%an%x00%ae%x00%ad'
    ], {
      allowedExitCodes: [0, 128]
    })

    if (result.exitCode !== 0 || !result.stdout.trim()) {
      return []
    }

    return result.stdout
      .split('\n')
      .filter(Boolean)
      .map(parseCommitSummary)
  }

  async getCommitDetails(request: CommitDetailsRequest): Promise<CommitDetails> {
    const rootPath = await this.resolveRepositoryRoot(request.repoPath)
    const commitSha = normalizeCommitSha(request.commitSha)
    const metadata = await this.git(rootPath, [
      'show',
      '-s',
      '--date=iso-strict',
      '--format=%H%x00%h%x00%s%x00%b%x00%an%x00%ae%x00%ad',
      commitSha
    ])
    const [sha, shortSha, subject, body, authorName, authorEmail, authoredAt] = metadata.stdout.split('\0')

    return {
      sha,
      shortSha,
      subject,
      body: body.trim(),
      authorName,
      authorEmail,
      authoredAt: authoredAt.trim(),
      files: await this.getCommitFiles(rootPath, commitSha)
    }
  }

  async getCommitFileDiff(request: CommitFileDiffRequest): Promise<DiffResult> {
    const rootPath = await this.resolveRepositoryRoot(request.repoPath)
    const commitSha = normalizeCommitSha(request.commitSha)
    const filePath = normalizeRelativePath(request.filePath)
    const result = await this.git(rootPath, ['show', '--format=', '--no-ext-diff', commitSha, '--', filePath], {
      allowedExitCodes: [0, 1]
    })
    const binary = result.stdout.includes('Binary files') || result.stdout.includes('GIT binary patch')
    const tooLarge = result.stdout.length > MAX_DIFF_BYTES

    const text = tooLarge ? result.stdout.slice(0, MAX_DIFF_BYTES) : result.stdout

    return {
      filePath,
      staged: false,
      text,
      binary,
      tooLarge,
      files: binary || tooLarge ? [] : parseUnifiedDiff(text)
    }
  }

  async getGitConfig(repoPath: string): Promise<GitConfigSnapshot> {
    const rootPath = await this.resolveRepositoryRoot(repoPath)
    const localUserName = await this.getConfig(rootPath, 'user.name', 'local')
    const localUserEmail = await this.getConfig(rootPath, 'user.email', 'local')
    const globalUserName = await this.getConfig(rootPath, 'user.name', 'global')
    const globalUserEmail = await this.getConfig(rootPath, 'user.email', 'global')
    const localSigning = await this.getConfig(rootPath, 'commit.gpgsign', 'local')
    const globalSigning = await this.getConfig(rootPath, 'commit.gpgsign', 'global')
    const signingValue = localSigning ?? globalSigning

    return {
      localUserName,
      localUserEmail,
      globalUserName,
      globalUserEmail,
      effectiveUserName: localUserName ?? globalUserName,
      effectiveUserEmail: localUserEmail ?? globalUserEmail,
      commitSigningEnabled: signingValue ? signingValue === 'true' : undefined,
      commitSigningSource: localSigning ? 'local' : globalSigning ? 'global' : 'unset',
      remotes: await this.listRemotes(rootPath)
    }
  }

  async setLocalGitIdentity(request: GitIdentityUpdate): Promise<GitConfigSnapshot> {
    const rootPath = await this.resolveRepositoryRoot(request.repoPath)
    const name = normalizeConfigValue(request.name, 'Name')
    const email = normalizeConfigValue(request.email, 'Email')

    await this.git(rootPath, ['config', '--local', 'user.name', name])
    await this.git(rootPath, ['config', '--local', 'user.email', email])

    return this.getGitConfig(rootPath)
  }

  async stageFile(request: FileActionRequest): Promise<RepositorySnapshot> {
    const rootPath = await this.resolveRepositoryRoot(request.repoPath)
    await this.git(rootPath, ['add', '--', normalizeRelativePath(request.filePath)])
    return this.getSnapshot(rootPath)
  }

  async unstageFile(request: FileActionRequest): Promise<RepositorySnapshot> {
    const rootPath = await this.resolveRepositoryRoot(request.repoPath)
    await this.git(rootPath, ['restore', '--staged', '--', normalizeRelativePath(request.filePath)])
    return this.getSnapshot(rootPath)
  }

  async stageHunk(request: HunkActionRequest): Promise<RepositorySnapshot> {
    const rootPath = await this.resolveRepositoryRoot(request.repoPath)
    const filePath = normalizeRelativePath(request.filePath)
    const patch = normalizeHunkPatch(request.patch, filePath)

    await this.git(rootPath, ['apply', '--cached', '--whitespace=nowarn'], {
      input: patch,
      timeoutMs: 30_000
    })

    return this.getSnapshot(rootPath)
  }

  async unstageHunk(request: HunkActionRequest): Promise<RepositorySnapshot> {
    const rootPath = await this.resolveRepositoryRoot(request.repoPath)
    const filePath = normalizeRelativePath(request.filePath)
    const patch = normalizeHunkPatch(request.patch, filePath)

    await this.git(rootPath, ['apply', '--reverse', '--cached', '--whitespace=nowarn'], {
      input: patch,
      timeoutMs: 30_000
    })

    return this.getSnapshot(rootPath)
  }

  async stageAll(repoPath: string): Promise<RepositorySnapshot> {
    const rootPath = await this.resolveRepositoryRoot(repoPath)
    await this.git(rootPath, ['add', '-A'])
    return this.getSnapshot(rootPath)
  }

  async unstageAll(repoPath: string): Promise<RepositorySnapshot> {
    const rootPath = await this.resolveRepositoryRoot(repoPath)
    await this.git(rootPath, ['restore', '--staged', '--', '.'])
    return this.getSnapshot(rootPath)
  }

  async discardFile(request: FileActionRequest & { confirmed: boolean }): Promise<RepositorySnapshot> {
    if (!request.confirmed) {
      throw new BranchPilotUserError('confirmation_required', 'Discard requires explicit confirmation.')
    }

    const rootPath = await this.resolveRepositoryRoot(request.repoPath)
    await this.git(rootPath, ['restore', '--', normalizeRelativePath(request.filePath)])
    return this.getSnapshot(rootPath)
  }

  async deleteUntrackedFile(request: FileActionRequest & { confirmed: boolean }): Promise<RepositorySnapshot> {
    if (!request.confirmed) {
      throw new BranchPilotUserError('confirmation_required', 'Deleting an untracked file requires explicit confirmation.')
    }

    const rootPath = await this.resolveRepositoryRoot(request.repoPath)
    await this.git(rootPath, ['clean', '-f', '--', normalizeRelativePath(request.filePath)])
    return this.getSnapshot(rootPath)
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

    const message = [title, request.description.trim()].filter(Boolean).join('\n\n')
    const messageFile = path.join(os.tmpdir(), `branchpilot-commit-${Date.now()}.txt`)

    await fs.writeFile(messageFile, message, 'utf8')

    try {
      await this.git(rootPath, ['commit', '-F', messageFile], { timeoutMs: 120_000 })
    } finally {
      await fs.rm(messageFile, { force: true })
    }

    return this.getSnapshot(rootPath)
  }

  async listStashes(repoPath: string): Promise<StashEntry[]> {
    const rootPath = await this.resolveRepositoryRoot(repoPath)
    const result = await this.git(rootPath, ['stash', 'list', '--format=%gd%x00%H%x00%cr%x00%gs'], {
      allowedExitCodes: [0]
    })

    return result.stdout
      .split('\n')
      .filter(Boolean)
      .map(parseStashEntry)
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

    return this.getSnapshot(rootPath)
  }

  async applyStash(request: StashActionRequest): Promise<RepositorySnapshot> {
    const rootPath = await this.resolveRepositoryRoot(request.repoPath)
    await this.git(rootPath, ['stash', 'apply', normalizeStashRef(request.stashRef)], { timeoutMs: 120_000 })

    return this.getSnapshot(rootPath)
  }

  async dropStash(request: ConfirmedStashActionRequest): Promise<RepositorySnapshot> {
    if (!request.confirmed) {
      throw new BranchPilotUserError('confirmation_required', 'Dropping a stash requires explicit confirmation.')
    }

    const rootPath = await this.resolveRepositoryRoot(request.repoPath)
    await this.git(rootPath, ['stash', 'drop', normalizeStashRef(request.stashRef)], { timeoutMs: 120_000 })

    return this.getSnapshot(rootPath)
  }

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
    await this.git(rootPath, ['pull', '--ff-only'], { timeoutMs: 120_000 })
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

  async createBranch(repoPath: string, branchName: string): Promise<RepositorySnapshot> {
    const rootPath = await this.resolveRepositoryRoot(repoPath)
    const normalizedName = normalizeBranchName(branchName)
    await this.git(rootPath, ['switch', '-c', normalizedName])
    return this.getSnapshot(rootPath)
  }

  async switchBranch(repoPath: string, branchName: string): Promise<RepositorySnapshot> {
    const rootPath = await this.resolveRepositoryRoot(repoPath)
    await this.git(rootPath, ['switch', normalizeBranchName(branchName)])
    return this.getSnapshot(rootPath)
  }

  async deleteBranch(repoPath: string, branchName: string, force: boolean): Promise<RepositorySnapshot> {
    const rootPath = await this.resolveRepositoryRoot(repoPath)
    const normalizedName = normalizeBranchName(branchName)
    const currentBranch = await this.getCurrentBranch(rootPath)

    if (currentBranch === normalizedName) {
      throw new BranchPilotUserError('git_current_branch', 'Cannot delete the checked-out branch. Switch branches first.')
    }

    await this.git(rootPath, ['branch', force ? '-D' : '-d', normalizedName])
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

  private async listBranches(rootPath: string): Promise<BranchSummary[]> {
    const result = await this.git(rootPath, [
      'branch',
      '--format=%(refname:short)%00%(HEAD)%00%(upstream:short)%00%(committerdate:iso-strict)%00%(objectname)'
    ])

    return result.stdout
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [name, head, upstream, lastCommitAt, lastCommit] = line.split('\0')

        return {
          name,
          current: head === '*',
          upstream: upstream || undefined,
          lastCommit: lastCommit || undefined,
          lastCommitAt: lastCommitAt || undefined
        }
      })
  }

  private async resolveRepositoryRoot(selectedPath: string): Promise<string> {
    const result = await this.git(selectedPath, ['rev-parse', '--show-toplevel'])
    return result.stdout.trim()
  }

  private async ensureSupportedRepository(rootPath: string): Promise<void> {
    const isBare = await this.git(rootPath, ['rev-parse', '--is-bare-repository'])

    if (isBare.stdout.trim() === 'true') {
      throw new BranchPilotUserError('unsupported_repository', 'Bare repositories are not supported yet.')
    }
  }

  private async getPrimaryRemote(rootPath: string): Promise<{ name: string; url: string } | undefined> {
    const firstFetchRemote = (await this.listRemotes(rootPath)).find((remote) => remote.fetchUrl)

    if (!firstFetchRemote) {
      return undefined
    }

    return {
      name: firstFetchRemote.name,
      url: firstFetchRemote.fetchUrl ?? firstFetchRemote.pushUrl ?? ''
    }
  }

  private async getConfig(rootPath: string, key: string, scope?: 'local' | 'global'): Promise<string | undefined> {
    const args = ['config']

    if (scope) {
      args.push(`--${scope}`)
    }

    args.push('--get', key)

    const result = await this.git(rootPath, args, {
      allowedExitCodes: [0, 1]
    })

    return result.exitCode === 0 ? result.stdout.trim() || undefined : undefined
  }

  private async listRemotes(rootPath: string): Promise<RemoteSummary[]> {
    const result = await this.git(rootPath, ['remote', '-v'], { allowedExitCodes: [0, 1] })
    const remotes = new Map<string, RemoteSummary>()

    for (const line of result.stdout.split('\n').map((entry) => entry.trim()).filter(Boolean)) {
      const match = line.match(/^(\S+)\s+(\S+)\s+\((fetch|push)\)$/)

      if (!match) {
        continue
      }

      const [, name, url, direction] = match
      const remote = remotes.get(name) ?? { name }

      if (direction === 'fetch') {
        remote.fetchUrl = url
      } else {
        remote.pushUrl = url
      }

      remotes.set(name, remote)
    }

    return [...remotes.values()]
  }

  private async getCommitFiles(rootPath: string, commitSha: string): Promise<CommitFileChange[]> {
    const result = await this.git(rootPath, ['diff-tree', '--root', '-r', '--name-status', '-z', '--no-commit-id', commitSha])
    const records = result.stdout.split('\0').filter(Boolean)
    const files: CommitFileChange[] = []

    for (let index = 0; index < records.length; index += 1) {
      const rawStatus = records[index]

      if (rawStatus.startsWith('R') || rawStatus.startsWith('C')) {
        files.push({
          rawStatus,
          status: rawStatus.startsWith('R') ? 'renamed' : 'copied',
          originalPath: records[index + 1],
          path: records[index + 2]
        })
        index += 2
        continue
      }

      files.push({
        rawStatus,
        status: mapRawStatus(rawStatus),
        path: records[index + 1]
      })
      index += 1
    }

    return files
  }

  private async getCurrentBranch(rootPath: string): Promise<string> {
    const result = await this.git(rootPath, ['branch', '--show-current'], {
      allowedExitCodes: [0, 1]
    })

    return result.stdout.trim()
  }

  private async assertCurrentBranch(rootPath: string, action: string): Promise<string> {
    const branch = await this.getCurrentBranch(rootPath)

    if (!branch) {
      throw new BranchPilotUserError('git_detached_head', `Cannot ${action} from a detached HEAD. Switch to a branch first.`)
    }

    return branch
  }

  private async assertHasAnyRemote(rootPath: string): Promise<void> {
    const remotes = await this.listRemotes(rootPath)

    if (remotes.length === 0) {
      throw new BranchPilotUserError('git_no_remote', 'This repository has no remotes configured.')
    }
  }

  private async assertRemoteExists(rootPath: string, remoteName: string): Promise<string> {
    const remotes = await this.listRemotes(rootPath)

    if (remotes.length === 0) {
      throw new BranchPilotUserError('git_no_remote', 'This repository has no remotes configured.')
    }

    if (!remotes.some((remote) => remote.name === remoteName)) {
      throw new BranchPilotUserError('git_no_remote', `Remote "${remoteName}" is not configured for this repository.`)
    }

    return remoteName
  }

  private async assertHasUpstream(rootPath: string, action: string): Promise<void> {
    const upstream = await this.git(rootPath, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], {
      allowedExitCodes: [0, 128]
    })

    if (upstream.exitCode !== 0 || !upstream.stdout.trim()) {
      throw new BranchPilotUserError('git_no_upstream', `Publish this branch before ${action}.`)
    }
  }

  private async assertNoActiveOperation(rootPath: string): Promise<void> {
    const mergeState = await this.getMergeState(rootPath, [])

    if (mergeState.operation !== 'none') {
      throw new BranchPilotUserError('git_operation_active', `A ${mergeState.operation} operation is already in progress.`)
    }
  }

  private async getMergeState(rootPath: string, conflictFiles: MergeState['files']): Promise<MergeState> {
    const gitDirResult = await this.git(rootPath, ['rev-parse', '--git-dir'])
    const gitDir = path.isAbsolute(gitDirResult.stdout.trim())
      ? gitDirResult.stdout.trim()
      : path.join(rootPath, gitDirResult.stdout.trim())

    if (await pathExists(path.join(gitDir, 'MERGE_HEAD'))) {
      return { operation: 'merge', files: conflictFiles }
    }

    if (await pathExists(path.join(gitDir, 'rebase-merge')) || await pathExists(path.join(gitDir, 'rebase-apply'))) {
      return { operation: 'rebase', files: conflictFiles }
    }

    if (await pathExists(path.join(gitDir, 'CHERRY_PICK_HEAD'))) {
      return { operation: 'cherry-pick', files: conflictFiles }
    }

    return {
      operation: conflictFiles.length > 0 ? 'merge' : 'none',
      files: conflictFiles
    }
  }

  private async isUntracked(rootPath: string, filePath: string): Promise<boolean> {
    const result = await this.git(rootPath, ['ls-files', '--error-unmatch', '--', filePath], {
      allowedExitCodes: [0, 1]
    })

    return result.exitCode === 1
  }

  private async getUntrackedFilePreview(rootPath: string, filePath: string): Promise<DiffResult> {
    const fullPath = resolveRepositoryPath(rootPath, filePath)
    const file = await fs.readFile(fullPath)
    const binary = file.includes(0)
    const tooLarge = file.byteLength > MAX_DIFF_BYTES
    const text = binary
      ? 'Binary untracked file.'
      : file
          .toString('utf8')
          .slice(0, MAX_DIFF_BYTES)
          .split('\n')
          .map((line) => `+${line}`)
          .join('\n')

    return {
      filePath,
      staged: false,
      text,
      binary,
      tooLarge,
      files: []
    }
  }

  private async git(
    cwd: string,
    args: string[],
    options: { allowedExitCodes?: number[]; input?: string; timeoutMs?: number } = {}
  ) {
    return this.runner.run('/usr/bin/git', args, {
      cwd,
      allowedExitCodes: options.allowedExitCodes,
      input: options.input,
      timeoutMs: options.timeoutMs
    })
  }
}

function normalizeHunkPatch(patch: string, filePath: string): string {
  if (!patch.trim() || patch.includes('\0')) {
    throw new BranchPilotUserError('invalid_hunk_patch', 'Hunk patch is invalid.')
  }

  const files = parseUnifiedDiff(patch)

  if (files.length !== 1 || files[0].hunks.length !== 1) {
    throw new BranchPilotUserError('invalid_hunk_patch', 'Hunk patch must contain exactly one file hunk.')
  }

  const paths = [files[0].oldPath, files[0].newPath]
    .filter((candidate): candidate is string => Boolean(candidate) && candidate !== '/dev/null')
    .map((candidate) => normalizeRelativePath(candidate))

  if (!paths.includes(filePath)) {
    throw new BranchPilotUserError('invalid_hunk_patch', 'Hunk patch does not match the selected file.')
  }

  return patch.endsWith('\n') ? patch : `${patch}\n`
}

function normalizeRelativePath(filePath: string): string {
  if (!filePath || path.isAbsolute(filePath) || filePath.includes('..')) {
    throw new BranchPilotUserError('invalid_path', 'Only repository-relative paths are allowed.')
  }

  return filePath
}

function normalizeBranchName(branchName: string): string {
  const trimmed = branchName.trim()

  if (!trimmed || trimmed.startsWith('-') || trimmed.includes('\0')) {
    throw new BranchPilotUserError('invalid_branch', 'Invalid branch name.')
  }

  return trimmed
}

function normalizeCommitSha(commitSha: string): string {
  const trimmed = commitSha.trim()

  if (!/^[a-fA-F0-9]{7,40}$/.test(trimmed)) {
    throw new BranchPilotUserError('invalid_commit', 'Invalid commit identifier.')
  }

  return trimmed
}

function normalizeConfigValue(value: string, label: string): string {
  const trimmed = value.trim()

  if (!trimmed || trimmed.includes('\0')) {
    throw new BranchPilotUserError('invalid_git_config', `${label} is required.`)
  }

  return trimmed
}

function normalizeStashMessage(message: string): string {
  const trimmed = message.trim()

  if (!trimmed || trimmed.includes('\0')) {
    throw new BranchPilotUserError('invalid_stash_message', 'Stash message is required.')
  }

  return trimmed
}

function normalizeStashRef(stashRef: string): string {
  const trimmed = stashRef.trim()

  if (!/^stash@\{\d+\}$/.test(trimmed)) {
    throw new BranchPilotUserError('invalid_stash_ref', 'Invalid stash reference.')
  }

  return trimmed
}

function isConflictOutput(output: string): boolean {
  const normalized = output.toLowerCase()

  return normalized.includes('automatic merge failed')
    || normalized.includes('fix conflicts')
    || normalized.includes('merge conflict')
    || normalized.includes('conflict (')
}

function parseCommitSummary(line: string): CommitSummary {
  const [sha, shortSha, subject, authorName, authorEmail, authoredAt] = line.split('\0')

  return {
    sha,
    shortSha,
    subject,
    authorName,
    authorEmail,
    authoredAt
  }
}

function parseStashEntry(line: string): StashEntry {
  const [ref, sha, createdAtLabel, message] = line.split('\0')

  return {
    ref,
    sha,
    createdAtLabel,
    message
  }
}

function mapRawStatus(rawStatus: string) {
  if (rawStatus.startsWith('A')) return 'added'
  if (rawStatus.startsWith('D')) return 'deleted'
  if (rawStatus.startsWith('R')) return 'renamed'
  if (rawStatus.startsWith('C')) return 'copied'
  if (rawStatus.startsWith('M')) return 'modified'

  return 'unknown'
}

function resolveRepositoryPath(rootPath: string, relativePath: string): string {
  const fullPath = path.resolve(rootPath, normalizeRelativePath(relativePath))
  const normalizedRoot = path.resolve(rootPath)

  if (!fullPath.startsWith(`${normalizedRoot}${path.sep}`) && fullPath !== normalizedRoot) {
    throw new BranchPilotUserError('invalid_path', 'Path escapes repository root.')
  }

  return fullPath
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}
