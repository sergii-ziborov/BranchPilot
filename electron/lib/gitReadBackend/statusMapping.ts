import type { StatusRow } from 'isomorphic-git'
import type { FileChange, FileChangeStatus } from '../../../src/shared/branchPilot.js'
import { BuiltinBackendUnsupported } from './types.js'

/**
 * Porcelain-style X (index vs HEAD) and Y (worktree vs index) status codes for a
 * single path, derived from an isomorphic-git status-matrix row.
 */
interface PorcelainXY {
  /** Staged/index status code (X column), '.' when unchanged. */
  x: string
  /** Worktree status code (Y column), '.' when unchanged. */
  y: string
  /** True for a new, untracked file (`?` porcelain record). */
  untracked: boolean
}

/**
 * The `isomorphic-git` status matrix reports each path as
 * `[filepath, HEAD, WORKDIR, STAGE]`:
 *   - HEAD:    0 absent, 1 present
 *   - WORKDIR: 0 absent, 1 identical to HEAD, 2 different from HEAD
 *   - STAGE:   0 absent, 1 identical to HEAD, 2 identical to WORKDIR, 3 different
 *
 * Only the unambiguous, faithfully-representable combinations are mapped here.
 * The matrix cannot express renames (they appear as delete + add), merge
 * conflicts (unmerged stages), or the "re-created after staged delete" combos
 * without risking wrong data, so those are deliberately left unmapped and cause
 * a fallback via {@link toPorcelainXY} returning `null`.
 */
function toPorcelainXY(head: number, workdir: number, stage: number): PorcelainXY | null {
  const key = `${head}${workdir}${stage}`

  switch (key) {
    // new, untracked
    case '020':
      return { x: '.', y: '?', untracked: true }
    // added, staged
    case '022':
      return { x: 'A', y: '.', untracked: false }
    // added, staged, with further unstaged modifications
    case '023':
      return { x: 'A', y: 'M', untracked: false }
    // unmodified — not a change (caller filters these out)
    case '111':
      return { x: '.', y: '.', untracked: false }
    // modified, unstaged
    case '121':
      return { x: '.', y: 'M', untracked: false }
    // modified, staged
    case '122':
      return { x: 'M', y: '.', untracked: false }
    // modified, staged, with further unstaged modifications
    case '123':
      return { x: 'M', y: 'M', untracked: false }
    // deleted, unstaged (removed from worktree, still in index)
    case '101':
      return { x: '.', y: 'D', untracked: false }
    // deleted, staged
    case '100':
      return { x: 'D', y: '.', untracked: false }
    default:
      // Everything else (absent rows, staged-delete-then-recreated combos, and
      // any unmerged/unexpected state) is not safely representable.
      return null
  }
}

/** Classify a change the same way `gitStatusParser.classifyStatus` does. */
function classifyStatus(x: string, y: string): FileChangeStatus {
  const statuses = `${x}${y}`
  if (statuses.includes('U')) return 'conflicted'
  if (statuses.includes('R')) return 'renamed'
  if (statuses.includes('C')) return 'copied'
  if (statuses.includes('A')) return 'added'
  if (statuses.includes('D')) return 'deleted'
  if (statuses.includes('M')) return 'modified'
  return 'unknown'
}

/**
 * Map a single status-matrix row to a {@link FileChange}, mirroring the shape
 * produced by `parseGitStatus` for working-tree changes.
 *
 * @returns the mapped change, or `null` when the row is unmodified (no change).
 * @throws {BuiltinBackendUnsupported} when the row cannot be represented.
 */
export function mapStatusRow(row: StatusRow): FileChange | null {
  const [filePath, head, workdir, stage] = row
  const xy = toPorcelainXY(head, workdir, stage)

  if (!xy) {
    throw new BuiltinBackendUnsupported(
      'unrepresentable-status',
      `Cannot represent status matrix [${head}, ${workdir}, ${stage}] for "${filePath}"`
    )
  }

  // Unmodified — the matrix includes these; the console path never emits them.
  if (xy.x === '.' && xy.y === '.' && !xy.untracked) {
    return null
  }

  if (xy.untracked) {
    return {
      path: filePath,
      status: 'untracked',
      staged: false,
      unstaged: true,
      untracked: true,
      conflicted: false,
      unstagedStatus: '?'
    }
  }

  const staged = xy.x !== '.'
  const unstaged = xy.y !== '.'

  return {
    path: filePath,
    status: classifyStatus(xy.x, xy.y),
    stagedStatus: staged ? xy.x : undefined,
    unstagedStatus: unstaged ? xy.y : undefined,
    staged,
    unstaged,
    untracked: false,
    conflicted: xy.x === 'U' || xy.y === 'U'
  }
}

/**
 * The status matrix cannot detect renames — a rename surfaces as an unrelated
 * delete + add pair, whereas the console path (porcelain=v2 with rename
 * detection) reports it as a single renamed entry with `originalPath`.
 *
 * To guarantee the built-in backend never shows wrong data, we conservatively
 * treat the co-occurrence of a deletion and an addition/untracked file as a
 * possible rename and defer to the console backend.
 *
 * @throws {BuiltinBackendUnsupported} when a rename might be present.
 */
export function assertNoPossibleRename(changes: FileChange[]): void {
  const hasDeletion = changes.some((change) => change.status === 'deleted')
  if (!hasDeletion) return

  const hasAddition = changes.some(
    (change) => change.status === 'added' || change.untracked
  )
  if (hasAddition) {
    throw new BuiltinBackendUnsupported(
      'possible-rename',
      'Deletion co-occurs with an addition; a rename may be present and cannot be detected by the status matrix'
    )
  }
}
