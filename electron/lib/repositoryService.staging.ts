import type {
  FileChange,
  FileActionRequest,
  HunkActionRequest,
  RepositorySnapshot
} from '../../src/shared/branchPilot.js'
import { promises as fs } from 'node:fs'
import { CommandExecutionError, type CommandRunResult } from './commandRunner.js'
import { BranchPilotUserError } from './errors.js'
import { parseGitStatus } from './gitStatusParser.js'
import {
  isWindowsReservedPath,
  normalizeHunkPatch,
  normalizeRelativePath,
  resolveRepositoryPath
} from './repositoryService.helpers.js'

const STAGING_CHUNK_SIZE = 80
const STAGING_OUTPUT_LIMIT = 24_000

/** Outcome of running a batched staging command over a set of paths. */
interface StagingChunkResult {
  /** Number of unique paths the command was actually asked to process. */
  attempted: number
  /** Paths git could not stage (only populated in resilient mode). */
  failedPaths: string[]
  /** Last error seen while staging (used to surface a real failure when nothing staged). */
  lastError?: unknown
}

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
    // Git can't index a reserved-device-name file on Windows; fail fast with an
    // actionable message instead of a generic "Git command failed".
    if (isWindowsReservedPath(filePath)) throw reservedNameError([filePath])
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

    // Bulk staging is resilient: a single un-stageable file (e.g. a Windows
    // reserved name like NUL.css) must not abort staging for every other file,
    // nor surface a generic "Git command failed" when the rest staged fine.
    const deletedResult = await this.stageDeletedPaths(rootPath, deletedPaths, true)
    const addResult = await this.runPathspecChunks(rootPath, ['add', '-A'], addPaths, true)

    const reservedFailures = [...deletedResult.failedPaths, ...addResult.failedPaths].filter(isWindowsReservedPath)
    assertBulkStagingProgress([deletedResult, addResult], 'Git could not stage any of the selected changes.', reservedFailures)
    return this.kernel.getStatusOnlySnapshot(rootPath)
  }

  async unstageAll(repoPath: string): Promise<RepositorySnapshot> {
    const rootPath = await this.kernel.resolveRepositoryRoot(repoPath)
    const changes = await this.listStatusChanges(rootPath)
    const stagedPaths = changes
      .filter((change) => !change.conflicted && change.staged)
      .map((change) => normalizeRelativePath(change.path))

    const result = await this.runPathspecChunks(rootPath, ['restore', '--staged'], stagedPaths, true)

    assertBulkStagingProgress([result], 'Git could not unstage any of the staged changes.')
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
    const filePath = normalizeRelativePath(request.filePath)

    if (isWindowsReservedPath(filePath)) {
      // `git clean` opens the file through the Win32 layer and fails on reserved
      // device names; Node's fs can remove them, so bypass Git for these.
      await fs.rm(resolveRepositoryPath(rootPath, filePath), { force: true, recursive: true })
    } else {
      await this.kernel.git(rootPath, ['clean', '-f', '--', filePath])
    }

    return this.kernel.getStatusOnlySnapshot(rootPath)
  }

  private async listStatusChanges(rootPath: string): Promise<FileChange[]> {
    const result = await this.kernel.git(rootPath, ['status', '--porcelain=v2', '-z', '--branch', '--untracked-files=all'])
    return parseGitStatus(result.stdout).changes
  }

  // Strict (non-resilient) helper: the first un-stageable path aborts the batch.
  // Only safe for the single-file fallback in stageFile(); a future multi-path
  // caller should route through the resilient stageAll() path instead.
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

  private stageDeletedPaths(rootPath: string, paths: string[], resilient = false): Promise<StagingChunkResult> {
    return this.runStagingChunks(paths, resilient, (chunk) =>
      this.kernel.git(rootPath, ['update-index', '--remove', '-z', '--stdin'], {
        input: nulSeparated(chunk),
        timeoutMs: 60_000,
        maxOutputBytes: STAGING_OUTPUT_LIMIT
      })
    )
  }

  private runPathspecChunks(rootPath: string, args: string[], paths: string[], resilient = false): Promise<StagingChunkResult> {
    return this.runStagingChunks(paths, resilient, (chunk) =>
      this.kernel.git(rootPath, [...args, '--pathspec-from-file=-', '--pathspec-file-nul'], {
        input: nulSeparated(chunk),
        timeoutMs: 60_000,
        maxOutputBytes: STAGING_OUTPUT_LIMIT
      })
    )
  }

  /**
   * Runs a staging command over `paths` in chunks. In strict mode (default) the
   * first failing chunk rejects, matching the old behavior for targeted single-file
   * actions. In resilient mode a failing chunk is retried path-by-path so one
   * un-stageable file can't drop the whole batch; the offending paths are reported
   * back instead of thrown.
   */
  private async runStagingChunks(
    paths: string[],
    resilient: boolean,
    runChunk: (chunk: string[]) => Promise<CommandRunResult>
  ): Promise<StagingChunkResult> {
    const uniquePaths = uniquePathsForGit(paths)
    if (uniquePaths.length === 0) return { attempted: 0, failedPaths: [] }

    const failedPaths: string[] = []
    let lastError: unknown

    for (const chunk of chunks(uniquePaths, STAGING_CHUNK_SIZE)) {
      try {
        await runChunk(chunk)
      } catch (error) {
        if (!resilient) throw error
        lastError = error

        if (chunk.length === 1) {
          failedPaths.push(chunk[0])
          continue
        }

        // Isolate the offending path(s): re-run each file on its own so the
        // rest of the chunk still stages.
        for (const singlePath of chunk) {
          try {
            await runChunk([singlePath])
          } catch (singleError) {
            lastError = singleError
            failedPaths.push(singlePath)
          }
        }
      }
    }

    return { attempted: uniquePaths.length, failedPaths, lastError }
  }
}

/** Throws when a resilient bulk operation made no progress at all (every path failed). */
function assertBulkStagingProgress(
  results: StagingChunkResult[],
  noProgressMessage: string,
  reservedFailures: string[] = []
): void {
  const attempted = results.reduce((total, result) => total + result.attempted, 0)
  const failed = results.reduce((total, result) => total + result.failedPaths.length, 0)

  if (attempted === 0 || failed < attempted) return

  // Nothing staged. If reserved Windows names are why, say so plainly rather than
  // surfacing git's raw "unable to index file" as a generic failure.
  if (reservedFailures.length > 0) throw reservedNameError(reservedFailures)

  const lastError = results.map((result) => result.lastError).find((error) => error !== undefined)
  if (lastError !== undefined) throw lastError

  throw new BranchPilotUserError('git_command_failed', noProgressMessage)
}

/** Actionable error for files Git can't stage because of a Windows reserved name. */
function reservedNameError(paths: string[]): BranchPilotUserError {
  const names = paths.map((filePath) => filePath.split(/[\\/]/).pop() ?? filePath)
  const single = names.length === 1

  return new BranchPilotUserError(
    'reserved_windows_name',
    `${names.join(', ')} ${single ? 'uses a reserved Windows device name' : 'use reserved Windows device names'} ` +
      `(NUL, CON, COM1…) that Git can't stage. Delete or rename ${single ? 'it' : 'them'}.`
  )
}

function uniquePathsForGit(paths: string[]): string[] {
  const seen = new Set<string>()
  const unique: string[] = []

  for (const path of paths) {
    const normalized = normalizeRelativePath(path)
    // Dedup on the exact path, not a lowercased key: on a case-sensitive
    // filesystem `Foo.txt` and `foo.txt` are distinct files, and folding them
    // together would silently drop one from staging (and from the attempted/
    // failed accounting).
    if (seen.has(normalized)) continue
    seen.add(normalized)
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
