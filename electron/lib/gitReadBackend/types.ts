import type { FileChange } from '../../../src/shared/branchPilot.js'

/**
 * Read-only git operations that can be served either by the console backend
 * (shells out to the git CLI) or by the built-in backend (isomorphic-git).
 *
 * The built-in backend is intentionally limited: whenever it encounters any
 * state it cannot represent with perfect fidelity, it throws
 * {@link BuiltinBackendUnsupported} so the caller falls back to the console
 * backend. The console backend remains the accurate default.
 */
export interface GitReadBackend {
  /**
   * Read the working-tree changes for the repository at `rootPath`.
   *
   * Returns the exact same {@link FileChange}[] shape the console path produces
   * for working-tree changes (see `parseGitStatus` in `gitStatusParser.ts`),
   * so a caller cannot tell which backend produced the result.
   *
   * @throws {BuiltinBackendUnsupported} when the repository is in a state the
   *   backend cannot faithfully represent (merge/rebase/conflict, submodules,
   *   possible renames, or any underlying git error).
   */
  readWorkingTreeStatus(rootPath: string): Promise<FileChange[]>
}

/**
 * Reasons the built-in backend refuses to serve a request and defers to the
 * console backend. Useful for logging/telemetry when a fallback occurs.
 */
export type BuiltinBackendUnsupportedReason =
  | 'merge-in-progress'
  | 'rebase-in-progress'
  | 'cherry-pick-in-progress'
  | 'revert-in-progress'
  | 'unmerged-entries'
  | 'submodules'
  | 'possible-rename'
  | 'unrepresentable-status'
  | 'git-error'

/**
 * Thrown by the built-in backend whenever it cannot faithfully represent the
 * requested read. The caller is expected to catch this and fall back to the
 * console backend for that call. It is a well-typed sentinel (never surfaced
 * to the user) — the console result is what the user sees.
 */
export class BuiltinBackendUnsupported extends Error {
  readonly reason: BuiltinBackendUnsupportedReason

  constructor(reason: BuiltinBackendUnsupportedReason, message?: string, options?: { cause?: unknown }) {
    super(message ?? `Built-in git backend cannot handle: ${reason}`, options)
    this.name = 'BuiltinBackendUnsupported'
    this.reason = reason
  }
}

/** Type guard for {@link BuiltinBackendUnsupported}. */
export function isBuiltinBackendUnsupported(error: unknown): error is BuiltinBackendUnsupported {
  return error instanceof BuiltinBackendUnsupported
}
