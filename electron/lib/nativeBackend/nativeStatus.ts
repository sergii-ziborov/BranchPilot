import type { FileChange } from '../../../src/shared/branchPilot.js'
import { deriveConflicts, deriveCounts, fileChangeFromCodes } from '../gitStatusParser.js'
import type { ParsedGitStatus } from '../gitStatusParser.js'
import { SidecarClient } from './sidecarClient.js'

/** `git.status` payload from the Rust core. */
interface NativeStatusPayload {
  headOid?: string
  branch: string
  upstream?: string
  ahead: number
  behind: number
  isDetached: boolean
  entries: NativeStatusEntry[]
}

interface NativeStatusEntry {
  path: string
  originalPath?: string
  staged: string
  unstaged: string
  untracked: boolean
}

/**
 * Working-tree status served entirely by the Rust core — no `git` process at
 * all, where the console path spawns one per read.
 *
 * The core answers only when it can prove the result matches Git (it reports
 * `unsupported` for submodule worktrees, per-directory attribute rules, clean
 * filters, ambiguous renames and non-UTF-8 paths), so a caller that falls back
 * on any thrown error stays byte-identical with the console backend.
 */
export class NativeGitStatusReader {
  constructor(private readonly sidecar: SidecarClient) {}

  get available(): boolean {
    return this.sidecar.available
  }

  async readStatus(rootPath: string): Promise<ParsedGitStatus> {
    const payload = await this.sidecar.request<NativeStatusPayload>('git.status', { root: rootPath })

    return toParsedGitStatus(payload)
  }
}

export function toParsedGitStatus(payload: NativeStatusPayload): ParsedGitStatus {
  const changes: FileChange[] = payload.entries.map((entry) =>
    fileChangeFromCodes(
      entry.path,
      entry.staged,
      entry.untracked ? '?' : entry.unstaged,
      entry.originalPath
    )
  )
  const conflicts = deriveConflicts(changes)

  return {
    headOid: payload.headOid,
    branch: payload.isDetached ? 'Detached HEAD' : payload.branch,
    upstream: payload.upstream,
    ahead: payload.ahead,
    behind: payload.behind,
    isDetached: payload.isDetached,
    changes,
    conflicts,
    counts: deriveCounts(changes, conflicts)
  }
}
