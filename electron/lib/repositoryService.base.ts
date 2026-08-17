import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type {
  BranchSummary,
  CommitFileChange,
  DiffResult,
  GitDefaultBranchSource,
  GitLfsFile,
  GitLfsPattern,
  GitLfsSummary,
  MergeState,
  RemoteBranchSummary,
  RemoteSummary,
  RepositorySnapshot,
  SubmoduleSummary,
  TagSummary,
  WorktreeSummary
} from '../../src/shared/branchPilot.js'
import { CommandRunner } from './commandRunner.js'
import { BranchPilotUserError } from './errors.js'
import { parseGitStatus } from './gitStatusParser.js'
import { GIT_EXECUTABLE, normalizeNativePath } from './platformExecutables.js'
import { SettingsStore } from './settingsStore.js'
import {
  gitLfsMessage,
  parseGitLfsFiles,
  parseGitLfsPatterns,
  parseGitLfsVersion,
  parseGitmodulesConfig,
  parseNameStatusRecords,
  parseSubmoduleStatus,
  parseTagSummary,
  parseWorktreeList,
  pathExists,
  resolveRepositoryPath
} from './repositoryService.helpers.js'
import { readUntrackedFilePreview } from './repositoryService.untrackedPreview.js'

/** Git subcommands that never change repository state. */
const GIT_READ_ONLY_VERBS = new Set([
  'blame', 'cat-file', 'check-ref-format', 'diff', 'diff-tree', 'for-each-ref',
  'log', 'ls-files', 'ls-remote', 'ls-tree', 'merge-base', 'rev-list', 'rev-parse', 'shortlog',
  'show', 'show-ref', 'status', 'var', 'version'
])

/**
 * Subcommands that read or write depending on their arguments, listed with the
 * argument that makes them a read.
 */
const GIT_READ_ONLY_SUBCOMMANDS: Record<string, string[]> = {
  branch: ['--list', '--format', '--contains', '-r'],
  config: ['--get', '--get-all', '--get-regexp', '--list'],
  lfs: ['version', 'ls-files'],
  remote: ['-v', 'get-url'],
  stash: ['list', 'show'],
  submodule: ['status'],
  'symbolic-ref': ['--quiet'],
  tag: ['--list'],
  worktree: ['list']
}

/**
 * Anything not provably a read counts as a write, because a stale warm cache is
 * a wrong answer while an unnecessary cache drop only costs one reopen.
 */
function isReadOnlyGitCommand(args: string[]): boolean {
  const verb = args[0]

  if (GIT_READ_ONLY_VERBS.has(verb)) {
    return true
  }

  const readMarkers = GIT_READ_ONLY_SUBCOMMANDS[verb]

  return Boolean(readMarkers?.some((marker) => args.includes(marker)))
}

export const MAX_DIFF_BYTES = 350_000
export const MAX_DIFF_OUTPUT_BYTES = MAX_DIFF_BYTES + 1
export const MAX_BRANCH_COMPARE_SUMMARY_BYTES = 80_000
export const DEFAULT_REMOTE = 'origin'

export interface GitDefaultBranchResult {
  name?: string
  source: GitDefaultBranchSource
  remote?: string
}

export abstract class RepositoryServiceBase {
  protected readonly snapshotCache = new Map<string, RepositorySnapshot>()

  constructor(
    protected readonly runner: CommandRunner,
    protected readonly settings: SettingsStore
  ) {}


  protected cacheSnapshot(snapshot: RepositorySnapshot): RepositorySnapshot {
    this.snapshotCache.set(snapshot.summary.rootPath, snapshot)
    return snapshot
  }

  protected async listBranches(rootPath: string, options: {
    includeDescriptions?: boolean
  } = {}): Promise<BranchSummary[]> {
    const result = await this.git(rootPath, [
      'branch',
      '--format=%(refname:short)%00%(HEAD)%00%(upstream:short)%00%(committerdate:iso-strict)%00%(objectname)'
    ])

    const branches = result.stdout
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

    if (options.includeDescriptions === false) {
      return branches
    }

    return Promise.all(branches.map(async (branch) => ({
      ...branch,
      description: await this.getConfig(rootPath, `branch.${branch.name}.description`)
    })))
  }

  protected async listRemoteBranches(rootPath: string): Promise<RemoteBranchSummary[]> {
    const result = await this.git(rootPath, [
      'branch',
      '-r',
      '--format=%(refname:short)%00%(committerdate:iso-strict)%00%(objectname)'
    ])

    return result.stdout
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [name, lastCommitAt, lastCommit] = line.split('\0')
        const separatorIndex = name.indexOf('/')

        return {
          name,
          remote: separatorIndex === -1 ? name : name.slice(0, separatorIndex),
          branchName: separatorIndex === -1 ? name : name.slice(separatorIndex + 1),
          lastCommit: lastCommit || undefined,
          lastCommitAt: lastCommitAt || undefined
        }
      })
      .filter((branch) => branch.branchName !== 'HEAD')
  }

  protected async listTags(rootPath: string): Promise<TagSummary[]> {
    const result = await this.git(rootPath, [
      'tag',
      '--list',
      '--sort=-creatordate',
      '--format=%(refname:short)%00%(objectname)%00%(objectname:short)%00%(*objectname)%00%(*objectname:short)%00%(creatordate:iso-strict)%00%(subject)'
    ])

    return result.stdout
      .split('\n')
      .filter(Boolean)
      .map(parseTagSummary)
  }

  protected async listRepositoryWorktrees(rootPath: string): Promise<WorktreeSummary[]> {
    const result = await this.git(rootPath, ['worktree', 'list', '--porcelain', '-z'], { allowedExitCodes: [0, 1] })
    return parseWorktreeList(result.stdout, rootPath)
  }

  protected async listRepositorySubmodules(rootPath: string): Promise<SubmoduleSummary[]> {
    if (!await pathExists(path.join(rootPath, '.gitmodules'))) {
      return []
    }

    const config = await this.git(rootPath, [
      'config',
      '-z',
      '--file',
      '.gitmodules',
      '--get-regexp',
      '^submodule\\..*\\.(path|url|branch)$'
    ], { allowedExitCodes: [0, 1] })
    const submoduleConfigs = parseGitmodulesConfig(config.stdout)
    const status = await this.git(rootPath, ['submodule', 'status', '--recursive'], { allowedExitCodes: [0, 1] })
    const statusByPath = new Map(parseSubmoduleStatus(status.stdout).map((entry) => [entry.path, entry]))

    return submoduleConfigs.map((entry) => {
      const statusEntry = statusByPath.get(entry.path)

      return {
        path: entry.path,
        absolutePath: path.join(rootPath, entry.path),
        url: entry.url,
        branch: entry.branch,
        head: statusEntry?.head,
        status: statusEntry?.status ?? 'unknown',
        description: statusEntry?.description
      }
    })
  }

  protected async getRepositoryGitLfsSummary(rootPath: string): Promise<GitLfsSummary> {
    const trackedPatterns = await this.listGitLfsPatterns(rootPath)
    const versionResult = await this.git(rootPath, ['lfs', 'version'], { allowedExitCodes: [0, 1] })
    const installed = versionResult.exitCode === 0
    const version = installed ? parseGitLfsVersion(versionResult.stdout) : undefined
    const files = installed ? await this.listGitLfsFiles(rootPath) : []

    return {
      installed,
      version,
      trackedPatterns,
      files,
      fileCount: files.length,
      message: gitLfsMessage(installed, trackedPatterns.length, files.length, version)
    }
  }

  protected async listGitLfsPatterns(rootPath: string): Promise<GitLfsPattern[]> {
    const result = await this.git(rootPath, ['ls-files', '-z', '--', '.gitattributes', ':(glob)**/.gitattributes'], {
      allowedExitCodes: [0, 1]
    })
    const attributeFiles = result.stdout.split('\0').filter(Boolean)
    const patterns: GitLfsPattern[] = []

    for (const filePath of attributeFiles) {
      const fullPath = resolveRepositoryPath(rootPath, filePath)
      const content = await fs.readFile(fullPath, 'utf8')

      patterns.push(...parseGitLfsPatterns(content, filePath))
    }

    return patterns
  }

  protected async listGitLfsFiles(rootPath: string): Promise<GitLfsFile[]> {
    const result = await this.git(rootPath, ['lfs', 'ls-files', '--long'], {
      allowedExitCodes: [0, 1],
      timeoutMs: 120_000
    })

    if (result.exitCode !== 0) {
      return []
    }

    return parseGitLfsFiles(result.stdout)
  }

  protected async assertValidTagName(rootPath: string, tagName: string): Promise<void> {
    const result = await this.git(rootPath, ['check-ref-format', `refs/tags/${tagName}`], {
      allowedExitCodes: [0, 1]
    })

    if (result.exitCode !== 0) {
      throw new BranchPilotUserError('invalid_tag', 'Invalid tag name.')
    }
  }

  protected async assertValidBranchName(rootPath: string, branchName: string): Promise<void> {
    const result = await this.git(rootPath, ['check-ref-format', `refs/heads/${branchName}`], {
      allowedExitCodes: [0, 1]
    })

    if (result.exitCode !== 0) {
      throw new BranchPilotUserError('invalid_branch', 'Invalid branch name.')
    }
  }

  protected async resolveRepositoryRoot(selectedPath: string): Promise<string> {
    const result = await this.git(selectedPath, ['rev-parse', '--show-toplevel'])
    return normalizeNativePath(result.stdout.trim())
  }

  protected async ensureSupportedRepository(rootPath: string): Promise<void> {
    const isBare = await this.git(rootPath, ['rev-parse', '--is-bare-repository'])

    if (isBare.stdout.trim() === 'true') {
      throw new BranchPilotUserError('unsupported_repository', 'Bare repositories are not supported yet.')
    }
  }

  protected async getPrimaryRemote(rootPath: string): Promise<{ name: string; url: string } | undefined> {
    const firstFetchRemote = (await this.listRemotes(rootPath)).find((remote) => remote.fetchUrl)

    if (!firstFetchRemote) {
      return undefined
    }

    return {
      name: firstFetchRemote.name,
      url: firstFetchRemote.fetchUrl ?? firstFetchRemote.pushUrl ?? ''
    }
  }

  protected async getConfig(rootPath: string, key: string, scope?: 'local' | 'global'): Promise<string | undefined> {
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

  protected async listRemotes(rootPath: string): Promise<RemoteSummary[]> {
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

  protected async getDefaultBranch(rootPath: string, remotes: RemoteSummary[]): Promise<GitDefaultBranchResult> {
    for (const remote of remotes) {
      const result = await this.git(rootPath, ['symbolic-ref', '--quiet', '--short', `refs/remotes/${remote.name}/HEAD`], {
        allowedExitCodes: [0, 1, 128]
      })
      const refName = result.stdout.trim()

      if (result.exitCode === 0 && refName) {
        return {
          name: refName.startsWith(`${remote.name}/`) ? refName.slice(remote.name.length + 1) : refName,
          source: 'remote',
          remote: remote.name
        }
      }
    }

    for (const branchName of ['main', 'master']) {
      if (await this.localBranchExists(rootPath, branchName)) {
        return {
          name: branchName,
          source: 'local'
        }
      }
    }

    const currentBranch = await this.getCurrentBranch(rootPath)

    if (currentBranch) {
      return {
        name: currentBranch,
        source: 'current'
      }
    }

    return { source: 'unknown' }
  }

  protected async localBranchExists(rootPath: string, branchName: string): Promise<boolean> {
    const result = await this.git(rootPath, ['show-ref', '--verify', '--quiet', `refs/heads/${branchName}`], {
      allowedExitCodes: [0, 1]
    })

    return result.exitCode === 0
  }

  protected async getCommitParentShas(rootPath: string, commitSha: string): Promise<string[]> {
    const result = await this.git(rootPath, ['rev-list', '--parents', '-n', '1', commitSha])
    const [, ...parentShas] = result.stdout.trim().split(/\s+/).filter(Boolean)

    return parentShas
  }

  protected commitDiffTreeRefs(commitSha: string, parentShas: string[]): string[] {
    if (parentShas.length > 1) return [parentShas[0], commitSha]

    return [commitSha]
  }

  protected commitDiffRefs(commitSha: string, parentShas: string[]): string[] {
    if (parentShas.length > 0) return [parentShas[0], commitSha]

    return [commitSha]
  }

  protected async getCommitFiles(rootPath: string, commitSha: string, parentShas?: string[]): Promise<CommitFileChange[]> {
    const resolvedParentShas = parentShas ?? (await this.getCommitParentShas(rootPath, commitSha))
    const result = await this.git(rootPath, [
      'diff-tree',
      '--root',
      '-r',
      '--name-status',
      '-z',
      '--find-renames',
      '--no-commit-id',
      ...this.commitDiffTreeRefs(commitSha, resolvedParentShas)
    ])

    return parseNameStatusRecords(result.stdout)
  }

  protected async getBranchComparisonFiles(rootPath: string, range: string): Promise<CommitFileChange[]> {
    const result = await this.git(rootPath, [
      'diff',
      '--name-status',
      '-z',
      '--find-renames',
      range
    ])

    return parseNameStatusRecords(result.stdout)
  }

  protected async getCommitContainingBranches(rootPath: string, commitSha: string): Promise<string[]> {
    const result = await this.git(rootPath, ['branch', '--format=%(refname:short)', '--contains', commitSha])

    return result.stdout
      .split('\n')
      .map((branch) => branch.trim())
      .filter(Boolean)
  }

  protected async getCurrentBranch(rootPath: string): Promise<string> {
    const result = await this.git(rootPath, ['branch', '--show-current'], {
      allowedExitCodes: [0, 1]
    })

    return result.stdout.trim()
  }

  protected async assertCurrentBranch(rootPath: string, action: string): Promise<string> {
    const branch = await this.getCurrentBranch(rootPath)

    if (!branch) {
      throw new BranchPilotUserError('git_detached_head', `Cannot ${action} from a detached HEAD. Switch to a branch first.`)
    }

    return branch
  }

  protected async assertHasAnyRemote(rootPath: string): Promise<void> {
    const remotes = await this.listRemotes(rootPath)

    if (remotes.length === 0) {
      throw new BranchPilotUserError('git_no_remote', 'This repository has no remotes configured.')
    }
  }

  protected async assertRemoteExists(rootPath: string, remoteName: string): Promise<string> {
    const remotes = await this.listRemotes(rootPath)

    if (remotes.length === 0) {
      throw new BranchPilotUserError('git_no_remote', 'This repository has no remotes configured.')
    }

    if (!remotes.some((remote) => remote.name === remoteName)) {
      throw new BranchPilotUserError('git_no_remote', `Remote "${remoteName}" is not configured for this repository.`)
    }

    return remoteName
  }

  protected async assertLocalBranchExists(rootPath: string, branchName: string): Promise<void> {
    const result = await this.git(rootPath, ['show-ref', '--verify', '--quiet', `refs/heads/${branchName}`], {
      allowedExitCodes: [0, 1]
    })

    if (result.exitCode !== 0) {
      throw new BranchPilotUserError('invalid_branch', 'Local branch does not exist.')
    }
  }

  protected async assertBranchDoesNotExist(rootPath: string, branchName: string): Promise<void> {
    const result = await this.git(rootPath, ['show-ref', '--verify', '--quiet', `refs/heads/${branchName}`], {
      allowedExitCodes: [0, 1]
    })

    if (result.exitCode === 0) {
      throw new BranchPilotUserError('branch_exists', 'Local branch already exists.')
    }
  }

  protected async assertRemoteTrackingBranchExists(rootPath: string, upstream: string): Promise<void> {
    const result = await this.git(rootPath, ['show-ref', '--verify', '--quiet', `refs/remotes/${upstream}`], {
      allowedExitCodes: [0, 1]
    })

    if (result.exitCode !== 0) {
      throw new BranchPilotUserError('invalid_upstream', 'Remote tracking branch does not exist. Fetch first or choose another upstream.')
    }
  }

  protected async assertRemoteMissing(rootPath: string, name: string): Promise<void> {
    if (await this.remoteExists(rootPath, name)) {
      throw new BranchPilotUserError('remote_exists', 'Remote already exists.')
    }
  }

  protected async remoteExists(rootPath: string, name: string): Promise<boolean> {
    const result = await this.git(rootPath, ['remote', 'get-url', name], {
      allowedExitCodes: [0, 1, 2]
    })

    return result.exitCode === 0
  }

  protected async assertValidBaseRef(rootPath: string, baseRef: string): Promise<void> {
    const result = await this.git(rootPath, ['rev-parse', '--verify', `${baseRef}^{commit}`], {
      allowedExitCodes: [0, 128]
    })

    if (result.exitCode !== 0) {
      throw new BranchPilotUserError('invalid_ref', 'Base ref does not resolve to a commit.')
    }
  }

  protected async assertHasUpstream(rootPath: string, action: string): Promise<void> {
    const upstream = await this.git(rootPath, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], {
      allowedExitCodes: [0, 128]
    })

    if (upstream.exitCode !== 0 || !upstream.stdout.trim()) {
      throw new BranchPilotUserError('git_no_upstream', `Publish this branch before ${action}.`)
    }
  }

  protected async assertNoActiveOperation(rootPath: string): Promise<void> {
    const mergeState = await this.getMergeState(rootPath, [])

    if (mergeState.operation !== 'none') {
      throw new BranchPilotUserError('git_operation_active', `A ${mergeState.operation} operation is already in progress.`)
    }
  }

  protected async assertNoConflicts(rootPath: string, actionLabel: string): Promise<void> {
    const statusOutput = await this.git(rootPath, ['status', '--porcelain=v2', '-z', '--branch', '--untracked-files=all'])
    const parsedStatus = parseGitStatus(statusOutput.stdout)

    if (parsedStatus.counts.conflicted > 0) {
      throw new BranchPilotUserError('conflicts_present', `Resolve conflicted files before ${actionLabel}.`)
    }
  }

  protected async getMergeState(rootPath: string, conflictFiles: MergeState['files']): Promise<MergeState> {
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

    // Conflicts can exist without an operation marker (e.g. after stash apply).
    // Reporting 'merge' here would offer Continue/Abort actions that git rejects.
    return {
      operation: 'none',
      files: conflictFiles
    }
  }

  protected async isUntracked(rootPath: string, filePath: string): Promise<boolean> {
    const result = await this.git(rootPath, ['ls-files', '--error-unmatch', '--', filePath], {
      allowedExitCodes: [0, 1]
    })

    return result.exitCode === 1
  }

  protected async getUntrackedFilePreview(rootPath: string, filePath: string): Promise<DiffResult> {
    return readUntrackedFilePreview(rootPath, filePath, {
      maxDiffBytes: MAX_DIFF_BYTES,
      maxOutputBytes: MAX_DIFF_OUTPUT_BYTES
    })
  }

  protected async gitCommitWithMessageFile(rootPath: string, argsPrefix: string[], message: string): Promise<void> {
    const messageFile = path.join(os.tmpdir(), `branchpilot-commit-${Date.now()}.txt`)

    await fs.writeFile(messageFile, message, 'utf8')

    try {
      await this.git(rootPath, [...argsPrefix, messageFile], { timeoutMs: 120_000 })
    } finally {
      await fs.rm(messageFile, { force: true })
    }
  }

  protected async git(
    cwd: string,
    args: string[],
    options: { allowedExitCodes?: number[]; input?: string; timeoutMs?: number; maxOutputBytes?: number } = {}
  ) {
    const result = await this.runner.run(GIT_EXECUTABLE, args, {
      cwd,
      allowedExitCodes: options.allowedExitCodes,
      input: options.input,
      timeoutMs: options.timeoutMs,
      maxOutputBytes: options.maxOutputBytes
    })

    if (!isReadOnlyGitCommand(args)) {
      this.onRepositoryWrite()
    }

    return result
  }

  /**
   * Called after any Git command that was not a pure read. Subclasses that keep
   * warm caches use it to drop them; the base keeps no state of its own.
   */
  protected onRepositoryWrite(): void {}
}
