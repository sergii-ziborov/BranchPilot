import type {
  FileChange,
  FileActionRequest,
  HunkActionRequest,
  RepositorySnapshot
} from '../../src/shared/branchPilot.js'
import { CommandExecutionError, type CommandRunResult } from './commandRunner.js'
import { BranchPilotUserError } from './errors.js'
import { parseGitStatus } from './gitStatusParser.js'
import { normalizeHunkPatch, normalizeRelativePath } from './repositoryService.helpers.js'

const STAGING_CHUNK_SIZE = 80
const STAGING_OUTPUT_LIMIT = 24_000

/** Narrow kernel slice the staging domain needs (composition, not inheritance). */
export interface StagingKernel {
  resolveRepositoryRoot(selectedPath: string): Promise<string>
  git(
    cwd: string,
    args: string[],
    options?: { allowedExitCodes?: number[]; input?: string; timeoutMs?: number; maxOutputBytes?: number }
  ): Promise<CommandRunResult>
  getStatusOnlySnapshot(rootPath: string): Promise<RepositorySnapshot>
}

/** Working-tree / index staging: stage, unstage, discard (files, hunks, and all). */
export class RepositoryStagingService {
  constructor(private readonly kernel: StagingKernel) {}

  async stageFile(request: FileActionRequest): Promise<RepositorySnapshot> {
    const rootPath = await this.kernel.resolveRepositoryRoot(request.repoPath)
    const filePath = normalizeRelativePath(request.filePath)
    try {
      await this.runPathspecChunks(rootPath, ['add', '-A'], [filePath])
    } catch (error) {
      if (!isWindowsPathspecFailure(error)) throw error
      await this.stagePaths(rootPath, [filePath])
    }
    return this.kernel.getStatusOnlySnapshot(rootPath)
  }

  async unstageFile(request: FileActionRequest): Promise<RepositorySnapshot> {
    const rootPath = await this.kernel.resolveRepositoryRoot(request.repoPath)
    await this.runPathspecChunks(rootPath, ['restore', '--staged'], [normalizeRelativePath(request.filePath)])
    return this.kernel.getStatusOnlySnapshot(rootPath)
  }

  async stageHunk(request: HunkActionRequest): Promise<RepositorySnapshot> {
    const rootPath = await this.kernel.resolveRepositoryRoot(request.repoPath)
    const filePath = normalizeRelativePath(request.filePath)
    const patch = normalizeHunkPatch(request.patch, filePath)

    await this.kernel.git(rootPath, ['apply', '--cached', '--whitespace=nowarn'], {
      input: patch,
      timeoutMs: 30_000
    })

    return this.kernel.getStatusOnlySnapshot(rootPath)
  }

  async unstageHunk(request: HunkActionRequest): Promise<RepositorySnapshot> {
    const rootPath = await this.kernel.resolveRepositoryRoot(request.repoPath)
    const filePath = normalizeRelativePath(request.filePath)
    const patch = normalizeHunkPatch(request.patch, filePath)

    await this.kernel.git(rootPath, ['apply', '--reverse', '--cached', '--whitespace=nowarn'], {
      input: patch,
      timeoutMs: 30_000
    })

    return this.kernel.getStatusOnlySnapshot(rootPath)
  }

  /** Permanently reverts a single unstaged hunk in the working tree (GitHub-Desktop-style discard). */
  async discardHunk(request: HunkActionRequest): Promise<RepositorySnapshot> {
    const rootPath = await this.kernel.resolveRepositoryRoot(request.repoPath)
    const filePath = normalizeRelativePath(request.filePath)
    const patch = normalizeHunkPatch(request.patch, filePath)

    await this.kernel.git(rootPath, ['apply', '--reverse', '--whitespace=nowarn'], {
      input: patch,
      timeoutMs: 30_000
    })

    return this.kernel.getStatusOnlySnapshot(rootPath)
  }

  async stageAll(repoPath: string): Promise<RepositorySnapshot> {
    const rootPath = await this.kernel.resolveRepositoryRoot(repoPath)
    const changes = await this.listStatusChanges(rootPath)
    const deletedPaths = changes
      .filter((change) => !change.conflicted && !change.untracked && change.unstagedStatus === 'D')
      .map((change) => normalizeRelativePath(change.path))
    const addPaths = changes
      .filter((change) => !change.conflicted && (change.untracked || change.unstaged) && change.unstagedStatus !== 'D')
      .map((change) => normalizeRelativePath(change.path))

    await this.stageDeletedPaths(rootPath, deletedPaths)
    await this.runPathspecChunks(rootPath, ['add', '-A'], addPaths)
    return this.kernel.getStatusOnlySnapshot(rootPath)
  }

  async unstageAll(repoPath: string): Promise<RepositorySnapshot> {
    const rootPath = await this.kernel.resolveRepositoryRoot(repoPath)
    const changes = await this.listStatusChanges(rootPath)
    const stagedPaths = changes
      .filter((change) => !change.conflicted && change.staged)
      .map((change) => normalizeRelativePath(change.path))

    await this.runPathspecChunks(rootPath, ['restore', '--staged'], stagedPaths)
    return this.kernel.getStatusOnlySnapshot(rootPath)
  }

  async discardFile(request: FileActionRequest & { confirmed: boolean }): Promise<RepositorySnapshot> {
    if (!request.confirmed) {
      throw new BranchPilotUserError('confirmation_required', 'Discard requires explicit confirmation.')
    }

    const rootPath = await this.kernel.resolveRepositoryRoot(request.repoPath)
    await this.kernel.git(rootPath, ['restore', '--', normalizeRelativePath(request.filePath)])
    return this.kernel.getStatusOnlySnapshot(rootPath)
  }

  async deleteUntrackedFile(request: FileActionRequest & { confirmed: boolean }): Promise<RepositorySnapshot> {
    if (!request.confirmed) {
      throw new BranchPilotUserError('confirmation_required', 'Deleting an untracked file requires explicit confirmation.')
    }

    const rootPath = await this.kernel.resolveRepositoryRoot(request.repoPath)
    await this.kernel.git(rootPath, ['clean', '-f', '--', normalizeRelativePath(request.filePath)])
    return this.kernel.getStatusOnlySnapshot(rootPath)
  }

  private async listStatusChanges(rootPath: string): Promise<FileChange[]> {
    const result = await this.kernel.git(rootPath, ['status', '--porcelain=v2', '-z', '--branch', '--untracked-files=all'])
    return parseGitStatus(result.stdout).changes
  }

  private async stagePaths(rootPath: string, paths: string[]): Promise<void> {
    const wanted = new Set(paths.map((path) => normalizeRelativePath(path).toLowerCase()))
    const changes = await this.listStatusChanges(rootPath)
    const deletedPaths: string[] = []
    const addPaths: string[] = []

    for (const change of changes) {
      const normalizedPath = normalizeRelativePath(change.path)
      if (!wanted.has(normalizedPath.toLowerCase()) || change.conflicted) continue
      if (!change.untracked && change.unstagedStatus === 'D') deletedPaths.push(normalizedPath)
      else addPaths.push(normalizedPath)
    }

    await this.stageDeletedPaths(rootPath, deletedPaths)
    await this.runPathspecChunks(rootPath, ['add', '-A'], addPaths)
  }

  private async stageDeletedPaths(rootPath: string, paths: string[]): Promise<void> {
    const uniquePaths = uniquePathsForGit(paths)
    if (uniquePaths.length === 0) return

    for (const chunk of chunks(uniquePaths, STAGING_CHUNK_SIZE)) {
      await this.kernel.git(rootPath, ['update-index', '--remove', '-z', '--stdin'], {
        input: nulSeparated(chunk),
        timeoutMs: 60_000,
        maxOutputBytes: STAGING_OUTPUT_LIMIT
      })
    }
  }

  private async runPathspecChunks(rootPath: string, args: string[], paths: string[]): Promise<void> {
    const uniquePaths = uniquePathsForGit(paths)
    if (uniquePaths.length === 0) return

    for (const chunk of chunks(uniquePaths, STAGING_CHUNK_SIZE)) {
      await this.kernel.git(rootPath, [...args, '--pathspec-from-file=-', '--pathspec-file-nul'], {
        input: nulSeparated(chunk),
        timeoutMs: 60_000,
        maxOutputBytes: STAGING_OUTPUT_LIMIT
      })
    }
  }
}

function uniquePathsForGit(paths: string[]): string[] {
  const seen = new Set<string>()
  const unique: string[] = []

  for (const path of paths) {
    const normalized = normalizeRelativePath(path)
    const key = normalized.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(normalized)
  }

  return unique
}

function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size))
  }
  return result
}

function nulSeparated(paths: string[]): string {
  return paths.length > 0 ? `${paths.join('\0')}\0` : ''
}

function isWindowsPathspecFailure(error: unknown): boolean {
  if (!(error instanceof CommandExecutionError)) return false
  const output = `${error.result.stderr}\n${error.result.stdout}`.toLowerCase()
  return output.includes('mmap failed') || output.includes('invalid argument')
}
