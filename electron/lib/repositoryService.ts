import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type {
  BranchSummary,
  CommitRequest,
  DiffRequest,
  DiffResult,
  FileActionRequest,
  MergeState,
  PublishBranchRequest,
  RecentRepository,
  RepositorySnapshot,
  RepositoryStatus,
  RepositorySummary
} from '../../src/shared/branchPilot.js'
import { CommandRunner } from './commandRunner.js'
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

    const args = ['diff', '--no-ext-diff']

    if (request.staged) {
      args.push('--cached')
    }

    args.push('--', relativePath)

    const result = await this.git(rootPath, args, { allowedExitCodes: [0, 1] })
    const binary = result.stdout.includes('Binary files') || result.stdout.includes('GIT binary patch')
    const tooLarge = result.stdout.length > MAX_DIFF_BYTES

    return {
      filePath: relativePath,
      staged: request.staged,
      text: tooLarge ? result.stdout.slice(0, MAX_DIFF_BYTES) : result.stdout,
      binary,
      tooLarge
    }
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

  async fetch(repoPath: string): Promise<RepositorySnapshot> {
    const rootPath = await this.resolveRepositoryRoot(repoPath)
    await this.git(rootPath, ['fetch', '--prune'], { timeoutMs: 120_000 })
    return this.getSnapshot(rootPath)
  }

  async pull(repoPath: string): Promise<RepositorySnapshot> {
    const rootPath = await this.resolveRepositoryRoot(repoPath)
    await this.git(rootPath, ['pull', '--ff-only'], { timeoutMs: 120_000 })
    return this.getSnapshot(rootPath)
  }

  async push(repoPath: string): Promise<RepositorySnapshot> {
    const rootPath = await this.resolveRepositoryRoot(repoPath)
    await this.git(rootPath, ['push'], { timeoutMs: 120_000 })
    return this.getSnapshot(rootPath)
  }

  async publishBranch(request: PublishBranchRequest): Promise<RepositorySnapshot> {
    const rootPath = await this.resolveRepositoryRoot(request.repoPath)
    const branch = request.branch || (await this.getCurrentBranch(rootPath))

    if (!branch || branch === 'Detached HEAD') {
      throw new BranchPilotUserError('invalid_branch', 'Cannot publish a detached HEAD.')
    }

    await this.git(rootPath, ['push', '-u', request.remote || DEFAULT_REMOTE, branch], {
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
    await this.git(rootPath, ['branch', force ? '-D' : '-d', normalizeBranchName(branchName)])
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
    const result = await this.git(rootPath, ['remote', '-v'], { allowedExitCodes: [0, 1] })
    const firstFetchRemote = result.stdout
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .find((line) => line.endsWith('(fetch)'))

    if (!firstFetchRemote) {
      return undefined
    }

    const [name, url] = firstFetchRemote.replace(/\s+\(fetch\)$/, '').split(/\s+/)
    return name && url ? { name, url } : undefined
  }

  private async getConfig(rootPath: string, key: string): Promise<string | undefined> {
    const result = await this.git(rootPath, ['config', '--get', key], {
      allowedExitCodes: [0, 1]
    })

    return result.exitCode === 0 ? result.stdout.trim() || undefined : undefined
  }

  private async getCurrentBranch(rootPath: string): Promise<string> {
    const result = await this.git(rootPath, ['branch', '--show-current'], {
      allowedExitCodes: [0, 1]
    })

    return result.stdout.trim()
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
      tooLarge
    }
  }

  private async git(
    cwd: string,
    args: string[],
    options: { allowedExitCodes?: number[]; timeoutMs?: number } = {}
  ) {
    return this.runner.run('/usr/bin/git', args, {
      cwd,
      allowedExitCodes: options.allowedExitCodes,
      timeoutMs: options.timeoutMs
    })
  }
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
