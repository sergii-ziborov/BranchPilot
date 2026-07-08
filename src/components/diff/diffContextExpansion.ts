import type { DiffFile, DiffHunk, DiffLine } from '../../shared/branchPilot'
import type { DiffContextDirection, ExtraContextEntry, ExtraContextMap } from './diffViewTypes'

function hunkHasHiddenContextAfter(file: DiffFile, index: number): boolean {
  return index < file.hunks.length - 1
}

function contextLineNumber(line: DiffLine): number | undefined {
  return line.newLineNumber ?? line.oldLineNumber
}

function firstContextLineNumber(lines: DiffLine[]): number | undefined {
  for (const line of lines) {
    const lineNumber = contextLineNumber(line)
    if (lineNumber) return lineNumber
  }

  return undefined
}

function lastContextLineNumber(lines: DiffLine[]): number | undefined {
  for (let index = lines.length - 1; index >= 0; index--) {
    const lineNumber = contextLineNumber(lines[index])
    if (lineNumber) return lineNumber
  }

  return undefined
}

export function hunkContextKey(file: DiffFile, hunk: DiffHunk): string {
  return `${file.newPath}:${hunk.oldStart}:${hunk.newStart}:${hunk.header}`
}

export function firstVisibleLineNumber(hunk: DiffHunk, entry?: ExtraContextEntry): number | undefined {
  return firstContextLineNumber(entry?.above.length ? entry.above : hunk.lines)
}

export function lastVisibleLineNumber(hunk: DiffHunk, entry?: ExtraContextEntry): number | undefined {
  return lastContextLineNumber(entry?.below.length ? entry.below : hunk.lines)
}

export function mergeContextLines(existing: DiffLine[], incoming: DiffLine[], direction: DiffContextDirection): DiffLine[] {
  const byLine = new Map<number, DiffLine>()
  const ordered = direction === 'up' ? [...incoming, ...existing] : [...existing, ...incoming]

  for (const line of ordered) {
    const lineNumber = contextLineNumber(line)
    if (!lineNumber || byLine.has(lineNumber)) continue
    byLine.set(lineNumber, line)
  }

  return [...byLine.values()].sort((a, b) => (contextLineNumber(a) ?? 0) - (contextLineNumber(b) ?? 0))
}

function hunkLineOffset(hunk: DiffHunk, direction: DiffContextDirection): number {
  if (direction === 'up') return hunk.oldStart - hunk.newStart
  return hunk.oldStart + hunk.oldLines - (hunk.newStart + hunk.newLines)
}

export function alignLoadedContextLineNumbers(
  lines: DiffLine[],
  hunk: DiffHunk,
  direction: DiffContextDirection
): DiffLine[] {
  const oldOffset = hunkLineOffset(hunk, direction)

  return lines.map((line) => {
    const newLineNumber = line.newLineNumber ?? line.oldLineNumber
    if (!newLineNumber) return line
    const oldLineNumber = newLineNumber + oldOffset

    return {
      ...line,
      oldLineNumber: oldLineNumber > 0 ? oldLineNumber : undefined,
      newLineNumber
    }
  })
}

export function contextBoundaryBefore(file: DiffFile, hunkIndex: number, extraContext: ExtraContextMap = {}): number {
  const previous = file.hunks[hunkIndex - 1]
  const previousEntry = previous ? extraContext[hunkContextKey(file, previous)] : undefined
  const previousLast = previous ? lastVisibleLineNumber(previous, previousEntry) : undefined
  return previousLast ? previousLast + 1 : 1
}

export function contextBoundaryAfter(
  file: DiffFile,
  hunkIndex: number,
  totalLines?: number,
  extraContext: ExtraContextMap = {}
): number | undefined {
  const next = file.hunks[hunkIndex + 1]
  const nextEntry = next ? extraContext[hunkContextKey(file, next)] : undefined
  const nextFirst = next ? firstVisibleLineNumber(next, nextEntry) : undefined
  if (nextFirst) return nextFirst - 1
  return totalLines
}

export function canExpandContext(
  file: DiffFile,
  hunk: DiffHunk,
  hunkIndex: number,
  entry: ExtraContextEntry | undefined,
  direction: DiffContextDirection,
  extraContext: ExtraContextMap = {}
): boolean {
  if (direction === 'up') {
    const firstVisible = firstVisibleLineNumber(hunk, entry)
    return Boolean(firstVisible && firstVisible > contextBoundaryBefore(file, hunkIndex, extraContext))
  }

  const lastVisible = lastVisibleLineNumber(hunk, entry)
  const upperBoundary = contextBoundaryAfter(file, hunkIndex, entry?.totalLines, extraContext)
  if (upperBoundary === undefined) return hunkHasHiddenContextAfter(file, hunkIndex)

  return Boolean(lastVisible && lastVisible < upperBoundary)
}

export function trimIncomingContextLines(
  lines: DiffLine[],
  file: DiffFile,
  hunk: DiffHunk,
  hunkIndex: number,
  direction: DiffContextDirection,
  currentEntry: ExtraContextEntry,
  currentContext: ExtraContextMap,
  totalLines: number
): DiffLine[] {
  const lowerBoundary = contextBoundaryBefore(file, hunkIndex, currentContext)
  const upperBoundary = contextBoundaryAfter(file, hunkIndex, totalLines, currentContext)
  const firstVisible = firstVisibleLineNumber(hunk, currentEntry)
  const lastVisible = lastVisibleLineNumber(hunk, currentEntry)

  return lines.filter((line) => {
    const lineNumber = contextLineNumber(line)
    if (!lineNumber) return false

    if (direction === 'up') {
      return lineNumber >= lowerBoundary && Boolean(!firstVisible || lineNumber < firstVisible)
    }

    if (upperBoundary !== undefined && lineNumber > upperBoundary) return false
    return Boolean(!lastVisible || lineNumber > lastVisible)
  })
}
