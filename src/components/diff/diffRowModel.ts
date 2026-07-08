import type { DiffFile, DiffHunk, DiffLine } from '../../shared/branchPilot'
import { buildSplitDiffRows, type SplitDiffRow } from '../../shared/diffView'
import { langFromPath } from '../../lib/highlight'
import { isCssColorFile } from './CssColorSwatch'
import { splitRowSelectKeys } from './diffLineUtils'
import { canExpandContext, hunkContextKey } from './diffContextExpansion'
import type { DiffContextDirection, DiffDisplayMode, ExtraContextMap } from './diffViewTypes'

/**
 * Shared render metadata for the run of diff lines that came from one source
 * (a hunk's body, or a block of loaded above/below context). Selection keys are
 * only meaningful on the hunk body, so `keyPrefix`/`selectable` are unset for
 * context blocks — mirroring how DiffView passes props to the eager list.
 */
export interface DiffLineGroup {
  id: string
  lines: DiffLine[]
  lang: string
  filePath: string
  canEditCssColors: boolean
  keyPrefix?: string
  selectable: boolean
}

export interface DiffSectionHeadingRow {
  id: string
  kind: 'section-heading'
  label: string
  description?: string
  stats?: { additions: number; deletions: number } | null
}

export interface DiffFileHeadingRow {
  id: string
  kind: 'file-heading'
  newPath: string
  oldPath?: string
}

export interface DiffHunkHeadingRow {
  id: string
  kind: 'hunk-heading'
  header: string
  hunk: DiffHunk
}

export interface DiffExpanderRow {
  id: string
  kind: 'expander'
  direction: DiffContextDirection
  file: DiffFile
  hunk: DiffHunk
  hunkIndex: number
}

export interface DiffUnifiedLineRow {
  id: string
  kind: 'u-line'
  group: DiffLineGroup
  lineIndex: number
  line: DiffLine
  selectKey: string
}

export interface DiffSplitLineRow {
  id: string
  kind: 's-row'
  group: DiffLineGroup
  row: SplitDiffRow
  oldKey?: string
  newKey?: string
}

export type DiffRow =
  | DiffSectionHeadingRow
  | DiffFileHeadingRow
  | DiffHunkHeadingRow
  | DiffExpanderRow
  | DiffUnifiedLineRow
  | DiffSplitLineRow

export interface DiffRowModel {
  rows: DiffRow[]
  /** Line groups in document order; used to precompute unified word-diff maps. */
  groups: DiffLineGroup[]
  /** Cumulative top offset of each row (length = rows.length + 1). */
  offsets: number[]
  totalHeight: number
  lineCount: number
}

export interface BuildDiffRowsParams {
  files: DiffFile[]
  displayMode: DiffDisplayMode
  hideFileHeading: boolean
  extraContext: ExtraContextMap
  expanded: boolean
  canSelectLines: boolean
  canLoadMoreContext: boolean
  hasCssColorEditor: boolean
  sectionLabel?: string
  sectionDescription?: string
  sectionStats?: { additions: number; deletions: number } | null
}

// Row heights are estimates used only to size the leading/trailing scroll
// spacers and pick the visible window. Rows still render at their natural
// height in normal flow, so an imperfect estimate can only shift the scroll
// slightly — it can never hide or overlap a row. Line rows are exact (CSS pins
// them at 24px with `white-space: pre`, so they never wrap).
const LINE_ROW_HEIGHT = 24
const HUNK_HEADING_HEIGHT = 35
const FILE_HEADING_HEIGHT = 35
const SECTION_HEADING_HEIGHT = 39
const EXPANDER_HEIGHT = 29

function rowHeight(row: DiffRow): number {
  switch (row.kind) {
    case 'u-line':
    case 's-row':
      return LINE_ROW_HEIGHT
    case 'hunk-heading':
      return HUNK_HEADING_HEIGHT
    case 'file-heading':
      return FILE_HEADING_HEIGHT
    case 'section-heading':
      return SECTION_HEADING_HEIGHT
    case 'expander':
      return EXPANDER_HEIGHT
  }
}

function pushLineGroup(
  rows: DiffRow[],
  groups: DiffLineGroup[],
  displayMode: DiffDisplayMode,
  group: DiffLineGroup
): number {
  groups.push(group)
  if (group.lines.length === 0) return 0

  if (displayMode === 'split') {
    const splitRows = buildSplitDiffRows(group.lines)
    const keys = splitRowSelectKeys(group.lines, splitRows, group.keyPrefix, group.selectable)
    splitRows.forEach((row, rowIndex) => {
      rows.push({
        id: `${group.id}:r${rowIndex}`,
        kind: 's-row',
        group,
        row,
        oldKey: keys[rowIndex].oldKey,
        newKey: keys[rowIndex].newKey
      })
    })
    return splitRows.length
  }

  group.lines.forEach((line, lineIndex) => {
    rows.push({
      id: `${group.id}:l${lineIndex}`,
      kind: 'u-line',
      group,
      lineIndex,
      line,
      selectKey: `${group.keyPrefix}:${lineIndex}`
    })
  })
  return group.lines.length
}

/**
 * Flattens `diff.files -> hunks -> lines` into one ordered list of render rows,
 * preserving the exact order the eager nested render produces (including
 * above/below context blocks and the up/down context expanders).
 */
export function buildDiffRows(params: BuildDiffRowsParams): DiffRowModel {
  const rows: DiffRow[] = []
  const groups: DiffLineGroup[] = []
  let lineCount = 0

  if (params.sectionLabel) {
    rows.push({
      id: 'section-heading',
      kind: 'section-heading',
      label: params.sectionLabel,
      description: params.sectionDescription,
      stats: params.sectionStats
    })
  }

  params.files.forEach((file, fileIndex) => {
    if (!params.hideFileHeading) {
      rows.push({
        id: `file:${fileIndex}`,
        kind: 'file-heading',
        newPath: file.newPath,
        oldPath: file.oldPath
      })
    }

    const lang = langFromPath(file.newPath)
    const canEditCssColors = Boolean(params.hasCssColorEditor && isCssColorFile(file.newPath))

    file.hunks.forEach((hunk, hunkIndex) => {
      const contextKey = hunkContextKey(file, hunk)
      const contextEntry = params.extraContext[contextKey]
      const canExpandBefore =
        params.canLoadMoreContext &&
        !params.expanded &&
        hunkIndex === 0 &&
        canExpandContext(file, hunk, hunkIndex, contextEntry, 'up', params.extraContext)
      const canExpandAfter =
        params.canLoadMoreContext &&
        !params.expanded &&
        canExpandContext(file, hunk, hunkIndex, contextEntry, 'down', params.extraContext)

      if (canExpandBefore) {
        rows.push({ id: `exp-up:${fileIndex}:${hunkIndex}`, kind: 'expander', direction: 'up', file, hunk, hunkIndex })
      }

      rows.push({ id: `hunk:${fileIndex}:${hunkIndex}`, kind: 'hunk-heading', header: hunk.header, hunk })

      if (contextEntry?.above.length) {
        lineCount += pushLineGroup(rows, groups, params.displayMode, {
          id: `g:${fileIndex}:${hunkIndex}:above`,
          lines: contextEntry.above,
          lang,
          filePath: file.newPath,
          canEditCssColors,
          selectable: false
        })
      }

      lineCount += pushLineGroup(rows, groups, params.displayMode, {
        id: `g:${fileIndex}:${hunkIndex}:main`,
        lines: hunk.lines,
        lang,
        filePath: file.newPath,
        canEditCssColors,
        keyPrefix: `${fileIndex}:${hunkIndex}`,
        selectable: params.canSelectLines
      })

      if (contextEntry?.below.length) {
        lineCount += pushLineGroup(rows, groups, params.displayMode, {
          id: `g:${fileIndex}:${hunkIndex}:below`,
          lines: contextEntry.below,
          lang,
          filePath: file.newPath,
          canEditCssColors,
          selectable: false
        })
      }

      if (canExpandAfter) {
        rows.push({ id: `exp-down:${fileIndex}:${hunkIndex}`, kind: 'expander', direction: 'down', file, hunk, hunkIndex })
      }
    })
  })

  const offsets = new Array<number>(rows.length + 1)
  offsets[0] = 0
  for (let i = 0; i < rows.length; i += 1) {
    offsets[i + 1] = offsets[i] + rowHeight(rows[i])
  }

  return { rows, groups, offsets, totalHeight: offsets[rows.length], lineCount }
}

export interface DiffRowWindow {
  startIndex: number
  endIndex: number
  offsetBefore: number
  offsetAfter: number
}

/** First index `i` with `offsets[i] > value` (strict) or `>= value` (loose). */
function bisect(offsets: number[], value: number, strict: boolean): number {
  let low = 0
  let high = offsets.length
  while (low < high) {
    const mid = (low + high) >>> 1
    const passed = strict ? offsets[mid] > value : offsets[mid] >= value
    if (passed) high = mid
    else low = mid + 1
  }
  return low
}

/**
 * Selects the slice of rows intersecting the viewport (plus a pixel overscan)
 * and the spacer heights that reserve the space of the hidden rows above/below.
 */
export function getDiffRowWindow(
  model: Pick<DiffRowModel, 'offsets' | 'totalHeight' | 'rows'>,
  scrollTop: number,
  viewportHeight: number,
  overscanPx: number
): DiffRowWindow {
  const rowCount = model.rows.length
  if (rowCount === 0) return { startIndex: 0, endIndex: 0, offsetBefore: 0, offsetAfter: 0 }

  const top = Math.max(0, scrollTop - overscanPx)
  const bottom = scrollTop + viewportHeight + overscanPx
  const startIndex = Math.max(0, bisect(model.offsets, top, true) - 1)
  const endIndex = Math.min(rowCount, Math.max(startIndex, bisect(model.offsets, bottom, false)))

  return {
    startIndex,
    endIndex,
    offsetBefore: model.offsets[startIndex],
    offsetAfter: model.totalHeight - model.offsets[endIndex]
  }
}
