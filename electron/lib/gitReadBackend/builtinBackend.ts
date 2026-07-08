import fs, { existsSync, statSync } from 'node:fs'
import path from 'node:path'
import git from 'isomorphic-git'
import type { FileChange } from '../../../src/shared/branchPilot.js'
import { assertNoPossibleRename, mapStatusRow } from './statusMapping.js'
import type { BuiltinBackendUnsupportedReason, GitReadBackend } from './types.js'
import { BuiltinBackendUnsupported, isBuiltinBackendUnsupported } from './types.js'

/**
 * In-progress operation marker files/dirs that live directly in the git
 * directory. Any of them means the repository is mid-operation and the working
 * tree may contain unmerged entries the status matrix cannot represent.
 */
const IN_PROGRESS_MARKERS: Array<{ name: string; reason: BuiltinBackendUnsupportedReason }> = [
  { name: 'MERGE_HEAD', reason: 'merge-in-progress' },
  { name: 'rebase-merge', reason: 'rebase-in-progress' },
  { name: 'rebase-apply', reason: 'rebase-in-progress' },
  { name: 'CHERRY_PICK_HEAD', reason: 'cherry-pick-in-progress' },
  { name: 'REVERT_HEAD', reason: 'revert-in-progress' }
]

/**
 * Built-in, pure-JS git read backend powered by isomorphic-git.
 *
 * Correctness-first: it only serves a request when it can reproduce the console
 * path's output exactly. For anything it cannot represent faithfully it throws
 * {@link BuiltinBackendUnsupported} so the caller falls back to the console
 * backend. See the module doc comments for the exact supported/unsupported set.
 */
export class BuiltinGitReadBackend implements GitReadBackend {
  async readWorkingTreeStatus(rootPath: string): Promise<FileChange[]> {
    const gitdir = resolveGitDir(rootPath)

    // Guard rails before touching the matrix: bail on any state the matrix
    // cannot faithfully represent.
    assertNoInProgressOperation(gitdir)
    assertNoSubmodules(rootPath)

    let matrix
    try {
      matrix = await git.statusMatrix({ fs, dir: rootPath, gitdir })
    } catch (error) {
      throw new BuiltinBackendUnsupported(
        'git-error',
        `isomorphic-git statusMatrix failed for "${rootPath}"`,
        { cause: error }
      )
    }

    const changes: FileChange[] = []
    for (const row of matrix) {
      // mapStatusRow throws BuiltinBackendUnsupported on unrepresentable rows.
      const change = mapStatusRow(row)
      if (change) {
        changes.push(change)
      }
    }

    // The matrix cannot detect renames; defer if one might be hiding as add+delete.
    assertNoPossibleRename(changes)

    return changes
  }
}

/**
 * Resolve the git directory for a working tree. A `.git` file (linked worktree
 * or submodule gitdir pointer) is treated as unsupported so we never
 * mis-resolve state — the console backend handles those correctly.
 */
function resolveGitDir(rootPath: string): string {
  const dotGit = path.join(rootPath, '.git')
  try {
    const stats = statSync(dotGit)
    if (stats.isDirectory()) {
      return dotGit
    }
  } catch (error) {
    throw new BuiltinBackendUnsupported(
      'git-error',
      `Cannot access git directory for "${rootPath}"`,
      { cause: error }
    )
  }

  // `.git` exists but is a file (gitdir pointer) — linked worktree / submodule.
  throw new BuiltinBackendUnsupported(
    'git-error',
    `"${dotGit}" is a gitdir pointer (linked worktree or submodule); deferring to console backend`
  )
}

/** Throw if the repo is mid merge/rebase/cherry-pick/revert. */
function assertNoInProgressOperation(gitdir: string): void {
  for (const marker of IN_PROGRESS_MARKERS) {
    if (existsSync(path.join(gitdir, marker.name))) {
      throw new BuiltinBackendUnsupported(
        marker.reason,
        `In-progress operation detected (${marker.name}); deferring to console backend`
      )
    }
  }
}

/**
 * Throw if the working tree declares submodules. isomorphic-git's status matrix
 * does not represent gitlinks/submodule state faithfully, so we defer.
 */
function assertNoSubmodules(rootPath: string): void {
  if (existsSync(path.join(rootPath, '.gitmodules'))) {
    throw new BuiltinBackendUnsupported(
      'submodules',
      'Repository declares submodules (.gitmodules); deferring to console backend'
    )
  }
}

export { isBuiltinBackendUnsupported }
