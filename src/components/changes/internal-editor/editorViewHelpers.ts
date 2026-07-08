import type { RepositoryFileChunkResult } from '../../../shared/branchPilot'
import { clamp } from './editorPrimitives'
import type { ChunkedTextMarker, ChunkedTextPreview } from './editorTypes'
import type {
  EditorIndentInfo,
  EditorLineEnding,
  EditorLineEndingInfo,
  EditorSelectionStatus,
  FileLineSearchTarget
} from './editorStateTypes'
import { lineColumnFromOffset } from './editorLintHelpers'
import { textLines } from './liveLineChanges'
import {
  EDITOR_DETAIL_MIN_WIDTH,
  EDITOR_INITIAL_RENDER_LINES,
  EDITOR_LARGE_FILE_LINE_THRESHOLD,
  EDITOR_LINE_HEIGHT,
  EDITOR_RENDER_BATCH_SIZE,
  EDITOR_RENDER_LOOKAHEAD,
  EDITOR_SEARCH_MATCH_LIMIT,
  EDITOR_SIDEBAR_DEFAULT_WIDTH,
  EDITOR_SIDEBAR_MAX_WIDTH,
  EDITOR_SIDEBAR_MIN_WIDTH,
  EDITOR_SIDEBAR_STORAGE_KEY,
  EDITOR_SPLITTER_WIDTH,
  PREVIEWABLE_IMAGE_RE
} from './editorViewConstants'

export type EditorViewMode = 'code' | 'image' | 'json' | 'svg-editor' | 'hex'

export interface EditorLineWindow {
  start: number
  end: number
  offsetTop: number
  rendered: number
  virtual: boolean
}

export interface EditorTextHistoryEntry {
  text: string
  selectionStart: number
  selectionEnd: number
}

export interface EditorTextRange {
  start: number
  end: number
}

export interface FileSearchMatch {
  lineNumber: number
  column: number
  length: number
}

export function isNativeEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  return target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
}

export function clampEditorSidebarWidth(width: number, containerWidth?: number): number {
  const maxForContainer = containerWidth && containerWidth > 0
    ? Math.max(EDITOR_SIDEBAR_MIN_WIDTH, containerWidth - EDITOR_SPLITTER_WIDTH - EDITOR_DETAIL_MIN_WIDTH)
    : EDITOR_SIDEBAR_MAX_WIDTH

  return Math.round(clamp(width, EDITOR_SIDEBAR_MIN_WIDTH, Math.min(EDITOR_SIDEBAR_MAX_WIDTH, maxForContainer)))
}

export function editorLineWindowForScroll(
  totalLines: number,
  scrollTop: number,
  viewportHeight: number,
  lineHeight = EDITOR_LINE_HEIGHT
): EditorLineWindow {
  if (totalLines <= 0) {
    return { start: 0, end: 0, offsetTop: 0, rendered: 0, virtual: false }
  }

  if (totalLines <= EDITOR_LARGE_FILE_LINE_THRESHOLD) {
    return { start: 0, end: totalLines, offsetTop: 0, rendered: totalLines, virtual: false }
  }

  const safeLineHeight = Number.isFinite(lineHeight) && lineHeight > 4 ? lineHeight : EDITOR_LINE_HEIGHT
  const viewportLines = Math.max(
    1,
    Math.ceil((viewportHeight || EDITOR_INITIAL_RENDER_LINES * safeLineHeight) / safeLineHeight)
  )
  const firstVisibleLine = Math.max(0, Math.floor(scrollTop / safeLineHeight))
  const rawStart = Math.max(0, firstVisibleLine - EDITOR_RENDER_LOOKAHEAD)
  const rawEnd = Math.min(totalLines, firstVisibleLine + viewportLines + EDITOR_RENDER_LOOKAHEAD)
  const start = Math.floor(rawStart / EDITOR_RENDER_BATCH_SIZE) * EDITOR_RENDER_BATCH_SIZE
  const end = Math.min(
    totalLines,
    Math.max(start + EDITOR_RENDER_BATCH_SIZE, Math.ceil(rawEnd / EDITOR_RENDER_BATCH_SIZE) * EDITOR_RENDER_BATCH_SIZE)
  )

  return {
    start,
    end,
    offsetTop: start * safeLineHeight,
    rendered: Math.max(0, end - start),
    virtual: true
  }
}

export function closeOpenEditorDetails(root: HTMLElement | null, except?: Element | null): void {
  if (!root) return
  root.querySelectorAll<HTMLDetailsElement>('details[open]').forEach((details) => {
    if (except && details.contains(except)) return
    details.removeAttribute('open')
  })
}

export function readStoredEditorSidebarWidth(): number {
  try {
    const rawWidth = window.localStorage.getItem(EDITOR_SIDEBAR_STORAGE_KEY)
    if (rawWidth === null) return EDITOR_SIDEBAR_DEFAULT_WIDTH

    const stored = Number(rawWidth)
    if (Number.isFinite(stored)) return clampEditorSidebarWidth(stored)
  } catch {
    /* ignore unavailable storage */
  }

  return EDITOR_SIDEBAR_DEFAULT_WIDTH
}

export function lineBreakCount(text: string): number {
  return text.match(/\n/g)?.length ?? 0
}

export function textareaVisualLineCount(text: string): number {
  return Math.max(1, lineBreakCount(text) + 1)
}

export function editorTextSourceKey(text: string): string {
  if (!text) return '0'

  const middle = Math.floor(text.length / 2)
  return [
    text.length,
    text.charCodeAt(0),
    text.charCodeAt(middle),
    text.charCodeAt(text.length - 1)
  ].join(':')
}

export function chunkedTextPreviewFromResult(
  result: RepositoryFileChunkResult,
  options: { startLine: number; markers: ChunkedTextMarker[]; pageIndex: number }
): ChunkedTextPreview {
  return {
    filePath: result.filePath,
    text: result.text,
    byteSize: result.byteSize,
    startOffset: result.startOffset,
    endOffset: result.endOffset,
    startLine: options.startLine,
    hasMore: result.hasMore,
    markers: options.markers,
    pageIndex: options.pageIndex,
    loading: false,
    error: null
  }
}

export function defaultViewModeForPath(filePath: string): EditorViewMode {
  if (PREVIEWABLE_IMAGE_RE.test(filePath)) return 'image'
  return 'code'
}

export function editorSelectionStatusFromOffsets(text: string, selectionStart: number, selectionEnd: number, lineBase: number): EditorSelectionStatus {
  const start = clamp(Math.min(selectionStart, selectionEnd), 0, text.length)
  const end = clamp(Math.max(selectionStart, selectionEnd), 0, text.length)
  const startLocation = lineColumnFromOffset(text, start)
  const endLocation = lineColumnFromOffset(text, end)

  return {
    lineNumber: lineBase + startLocation.lineNumber - 1,
    column: startLocation.column,
    selectedChars: end - start,
    selectedLines: end > start ? Math.max(1, endLocation.lineNumber - startLocation.lineNumber + 1) : 0
  }
}

export function detectEditorLineEnding(text: string): EditorLineEndingInfo {
  const crlf = text.match(/\r\n/g)?.length ?? 0
  const withoutCrlf = text.replace(/\r\n/g, '')
  const lf = withoutCrlf.match(/\n/g)?.length ?? 0
  const cr = withoutCrlf.match(/\r/g)?.length ?? 0
  const used = [crlf > 0, lf > 0, cr > 0].filter(Boolean).length
  const kind: EditorLineEnding = used > 1
    ? 'Mixed'
    : crlf > 0
      ? 'CRLF'
      : cr > 0
        ? 'CR'
        : 'LF'

  return { kind, lf, crlf, cr }
}

export function convertEditorLineEnding(text: string, target: Exclude<EditorLineEnding, 'Mixed'>): string {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  if (target === 'CRLF') return normalized.replace(/\n/g, '\r\n')
  if (target === 'CR') return normalized.replace(/\n/g, '\r')
  return normalized
}

export function detectEditorIndent(text: string): EditorIndentInfo {
  const spaceRuns = new Map<number, number>()
  let tabLines = 0
  let mixedLines = 0

  for (const line of textLines(text)) {
    const match = line.match(/^([ \t]+)\S/)
    if (!match) continue

    const indent = match[1]
    const hasTabs = indent.includes('\t')
    const hasSpaces = indent.includes(' ')
    if (hasTabs && hasSpaces) {
      mixedLines += 1
      continue
    }
    if (hasTabs) {
      tabLines += 1
      continue
    }

    spaceRuns.set(indent.length, (spaceRuns.get(indent.length) ?? 0) + 1)
  }

  const sortedSpaceRuns = [...spaceRuns.entries()].sort((left, right) => right[1] - left[1] || left[0] - right[0])
  const commonSpaceSize = sortedSpaceRuns[0]?.[0] ?? 2
  if (mixedLines > 0 || (tabLines > 0 && spaceRuns.size > 0)) return { kind: 'mixed', size: commonSpaceSize }
  if (tabLines > 0) return { kind: 'tabs', size: commonSpaceSize }
  if (spaceRuns.size > 0) return { kind: 'spaces', size: commonSpaceSize }
  return { kind: 'none', size: 2 }
}

export function convertEditorIndent(text: string, target: 'tabs' | 'spaces', size: number): string {
  const safeSize = clamp(Math.round(size), 1, 8)
  return text.replace(/^[ \t]+/gm, (indent) => {
    const columns = [...indent].reduce((total, char) => total + (char === '\t' ? safeSize : 1), 0)
    if (target === 'tabs') {
      return `${'\t'.repeat(Math.floor(columns / safeSize))}${' '.repeat(columns % safeSize)}`
    }
    return ' '.repeat(columns)
  })
}

export function selectedTextRange(text: string, start: number, end: number): EditorTextRange | null {
  const safeStart = clamp(Math.min(start, end), 0, text.length)
  const safeEnd = clamp(Math.max(start, end), 0, text.length)
  if (safeStart !== safeEnd) return { start: safeStart, end: safeEnd }

  const isWord = (char: string) => /[\p{L}\p{N}_$-]/u.test(char)
  let wordStart = safeStart
  let wordEnd = safeEnd
  while (wordStart > 0 && isWord(text[wordStart - 1] ?? '')) wordStart -= 1
  while (wordEnd < text.length && isWord(text[wordEnd] ?? '')) wordEnd += 1
  return wordStart === wordEnd ? null : { start: wordStart, end: wordEnd }
}

export function selectedSearchText(text: string, start: number, end: number): string {
  const safeStart = clamp(Math.min(start, end), 0, text.length)
  const safeEnd = clamp(Math.max(start, end), 0, text.length)
  if (safeStart === safeEnd) return ''

  return text
    .slice(safeStart, safeEnd)
    .replace(/\r\n/g, '\n')
    .split('\n')[0]
    .trim()
    .slice(0, 160)
}

export function shortcutKey(event: Pick<KeyboardEvent, 'code' | 'key'>): string {
  if (event.code === 'KeyD') return 'd'
  if (event.code === 'KeyF') return 'f'
  if (event.code === 'KeyY') return 'y'
  if (event.code === 'KeyZ') return 'z'
  return event.key.toLowerCase()
}

export function isEditorNavigationKey(key: string): boolean {
  return (
    key === 'ArrowLeft' ||
    key === 'ArrowRight' ||
    key === 'ArrowUp' ||
    key === 'ArrowDown' ||
    key === 'Home' ||
    key === 'End' ||
    key === 'PageUp' ||
    key === 'PageDown'
  )
}

export function rangesOverlap(a: EditorTextRange, b: EditorTextRange): boolean {
  return a.start < b.end && b.start < a.end
}

export function normalizeTextRanges(ranges: EditorTextRange[]): EditorTextRange[] {
  return [...ranges]
    .map((range) => ({ start: Math.min(range.start, range.end), end: Math.max(range.start, range.end) }))
    .sort((a, b) => a.start - b.start || a.end - b.end)
}

export function textRangesForLine(lineStartOffset: number, line: string, ranges: EditorTextRange[]): EditorTextRange[] {
  const lineEndOffset = lineStartOffset + line.length
  const result: EditorTextRange[] = []

  for (const range of normalizeTextRanges(ranges)) {
    if (range.start === range.end) {
      if (range.start >= lineStartOffset && range.start <= lineEndOffset) {
        const cursor = range.start - lineStartOffset
        result.push({ start: cursor, end: cursor })
      }
      continue
    }

    if (range.start > lineEndOffset || range.end < lineStartOffset) continue
    const start = clamp(range.start - lineStartOffset, 0, line.length)
    const end = clamp(range.end - lineStartOffset, 0, line.length)
    if (start === end) continue
    result.push({ start, end })
  }

  return result
}

export function buildLineOffsets(lines: string[]): number[] {
  const offsets: number[] = []
  let offset = 0

  for (const line of lines) {
    offsets.push(offset)
    offset += line.length + 1
  }

  return offsets
}

export function findFileSearchMatches(lines: string[], needle: string): FileSearchMatch[] {
  const query = needle.trim()
  if (!query) return []

  const lowerQuery = query.toLowerCase()
  const matches: FileSearchMatch[] = []

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex]
    const lowerLine = line.toLowerCase()
    let column = lowerLine.indexOf(lowerQuery)

    while (column !== -1) {
      matches.push({ lineNumber: lineIndex + 1, column, length: query.length })
      if (matches.length >= EDITOR_SEARCH_MATCH_LIMIT) return matches
      column = lowerLine.indexOf(lowerQuery, column + Math.max(1, lowerQuery.length))
    }
  }

  return matches
}

export function parseFileLineSearchQuery(query: string): FileLineSearchTarget | null {
  const match = query.trim().match(/^(?:(?:line|ln|l)\s*)?(?:[:#])?\s*(\d+)(?::(\d+))?$/i)
  if (!match) return null

  const lineNumber = Number(match[1])
  const column = match[2] ? Number(match[2]) : 1
  if (!Number.isInteger(lineNumber) || lineNumber < 1 || !Number.isInteger(column) || column < 1) return null
  return { lineNumber, column: column - 1 }
}
