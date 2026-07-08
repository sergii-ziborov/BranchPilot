import type { DiffLine, DiffResult } from '../../../shared/branchPilot'
import { clamp } from './editorPrimitives'
import type { LiveLineChange } from './editorTypes'

const EDITOR_LIVE_DIFF_LCS_CELL_LIMIT = 240_000

interface EditableTextLines {
  lines: string[]
  hasTrailingNewline: boolean
}

export function textLines(text: string): string[] {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const trimmed = normalized.endsWith('\n') ? normalized.slice(0, -1) : normalized
  return trimmed ? trimmed.split('\n') : ['']
}

export function buildLiveLineChanges(originalText: string, draftText: string): LiveLineChange[] {
  const original = textLines(originalText)
  const draft = textLines(draftText)
  let prefixLength = 0

  while (
    prefixLength < original.length &&
    prefixLength < draft.length &&
    original[prefixLength] === draft[prefixLength]
  ) {
    prefixLength += 1
  }

  let suffixLength = 0
  while (
    suffixLength + prefixLength < original.length &&
    suffixLength + prefixLength < draft.length &&
    original[original.length - 1 - suffixLength] === draft[draft.length - 1 - suffixLength]
  ) {
    suffixLength += 1
  }

  const originalMiddle = original.slice(prefixLength, original.length - suffixLength)
  const draftMiddle = draft.slice(prefixLength, draft.length - suffixLength)

  return compactLiveLineChanges(
    buildMiddleLiveLineChanges(originalMiddle, draftMiddle, prefixLength)
  )
}

function putLineChange(map: Map<number, LiveLineChange>, change: LiveLineChange) {
  const current = map.get(change.lineNumber)
  if (!current) {
    map.set(change.lineNumber, change)
    return
  }

  if (current.kind === 'modified' || change.kind === current.kind) return
  map.set(change.lineNumber, { ...change, kind: 'modified' })
}

export function buildGitLineChanges(diffs: DiffResult[], filePath: string): LiveLineChange[] {
  const byLine = new Map<number, LiveLineChange>()

  for (const diff of diffs) {
    for (const file of diff.files) {
      if (file.newPath !== filePath && file.oldPath !== filePath) continue

      for (const hunk of file.hunks) {
        for (let index = 0; index < hunk.lines.length;) {
          const line = hunk.lines[index]

          if (line.type === 'remove') {
            const removed: DiffLine[] = []
            while (hunk.lines[index]?.type === 'remove') {
              removed.push(hunk.lines[index])
              index += 1
            }

            const added: DiffLine[] = []
            while (hunk.lines[index]?.type === 'add') {
              added.push(hunk.lines[index])
              index += 1
            }

            const pairCount = Math.min(removed.length, added.length)
            for (let pairIndex = 0; pairIndex < pairCount; pairIndex += 1) {
              const addedLine = added[pairIndex]
              const removedLine = removed[pairIndex]
              putLineChange(byLine, {
                lineNumber: addedLine.newLineNumber ?? removedLine.oldLineNumber ?? hunk.newStart,
                kind: 'modified',
                before: removedLine.content,
                after: addedLine.content
              })
            }
            for (let addIndex = pairCount; addIndex < added.length; addIndex += 1) {
              const addedLine = added[addIndex]
              putLineChange(byLine, {
                lineNumber: addedLine.newLineNumber ?? hunk.newStart,
                kind: 'added',
                before: '',
                after: addedLine.content
              })
            }
            for (let removeIndex = pairCount; removeIndex < removed.length; removeIndex += 1) {
              const removedLine = removed[removeIndex]
              putLineChange(byLine, {
                lineNumber: removedLine.oldLineNumber ?? hunk.newStart,
                kind: 'removed',
                before: removedLine.content,
                after: ''
              })
            }
            continue
          }

          if (line.type === 'add') {
            putLineChange(byLine, {
              lineNumber: line.newLineNumber ?? hunk.newStart,
              kind: 'added',
              before: '',
              after: line.content
            })
          }

          index += 1
        }
      }
    }
  }

  return [...byLine.values()].sort((a, b) => a.lineNumber - b.lineNumber)
}

function buildMiddleLiveLineChanges(original: string[], draft: string[], startIndex: number): LiveLineChange[] {
  const changes: LiveLineChange[] = []

  if (original.length * draft.length > EDITOR_LIVE_DIFF_LCS_CELL_LIMIT) {
    const pairedCount = Math.min(original.length, draft.length)
    for (let index = 0; index < pairedCount; index += 1) {
      if (original[index] === draft[index]) continue
      changes.push({
        lineNumber: startIndex + index + 1,
        kind: 'modified',
        before: original[index],
        after: draft[index]
      })
    }
    for (let index = pairedCount; index < draft.length; index += 1) {
      changes.push({
        lineNumber: startIndex + index + 1,
        kind: 'added',
        before: '',
        after: draft[index]
      })
    }
    for (let index = pairedCount; index < original.length; index += 1) {
      changes.push({
        lineNumber: startIndex + pairedCount + 1,
        kind: 'removed',
        before: original[index],
        after: ''
      })
    }
    return changes
  }

  const table = Array.from({ length: original.length + 1 }, () => new Uint32Array(draft.length + 1))
  for (let left = original.length - 1; left >= 0; left -= 1) {
    for (let right = draft.length - 1; right >= 0; right -= 1) {
      table[left][right] = original[left] === draft[right]
        ? table[left + 1][right + 1] + 1
        : Math.max(table[left + 1][right], table[left][right + 1])
    }
  }

  let left = 0
  let right = 0
  while (left < original.length || right < draft.length) {
    if (left < original.length && right < draft.length && original[left] === draft[right]) {
      left += 1
      right += 1
    } else if (left < original.length && (right >= draft.length || table[left + 1][right] >= table[left][right + 1])) {
      changes.push({
        lineNumber: startIndex + right + 1,
        kind: 'removed',
        before: original[left],
        after: ''
      })
      left += 1
    } else if (right < draft.length) {
      changes.push({
        lineNumber: startIndex + right + 1,
        kind: 'added',
        before: '',
        after: draft[right]
      })
      right += 1
    }
  }

  return changes
}

function compactLiveLineChanges(changes: LiveLineChange[]): LiveLineChange[] {
  const compacted: LiveLineChange[] = []

  for (let index = 0; index < changes.length; index += 1) {
    const change = changes[index]
    const next = changes[index + 1]

    if (change.kind === 'removed' && next?.kind === 'added' && change.lineNumber === next.lineNumber) {
      compacted.push({
        lineNumber: next.lineNumber,
        kind: 'modified',
        before: change.before,
        after: next.after
      })
      index += 1
      continue
    }

    compacted.push(change)
  }

  return compacted
}

function editableTextLines(text: string): EditableTextLines {
  const hasTrailingNewline = /\r?\n$/.test(text)
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  if (hasTrailingNewline && lines[lines.length - 1] === '') lines.pop()

  return { lines, hasTrailingNewline }
}

function joinEditableTextLines({ lines, hasTrailingNewline }: EditableTextLines): string {
  return `${lines.join('\n')}${hasTrailingNewline ? '\n' : ''}`
}

function nearestLineIndex(lines: string[], targetIndex: number, expectedLine: string): number {
  if (lines.length === 0) return -1
  const safeTarget = clamp(targetIndex, 0, lines.length - 1)
  if (lines[safeTarget] === expectedLine) return safeTarget

  for (let distance = 1; distance < lines.length; distance += 1) {
    const before = safeTarget - distance
    const after = safeTarget + distance
    if (before >= 0 && lines[before] === expectedLine) return before
    if (after < lines.length && lines[after] === expectedLine) return after
  }

  return -1
}

export function updateLineInText(text: string, lineNumber: number, nextLine: string | null): string {
  const editable = editableTextLines(text)
  const lines = editable.lines
  const index = lineNumber - 1

  if (index < 0 || index > lines.length) return text

  if (nextLine === null) {
    lines.splice(index, 1)
  } else if (index === lines.length) {
    lines.push(nextLine)
  } else {
    lines[index] = nextLine
  }

  return joinEditableTextLines(editable)
}

export function revertLiveChangeInText(text: string, change: LiveLineChange): string {
  const editable = editableTextLines(text)
  const lines = editable.lines
  const targetIndex = Math.max(0, change.lineNumber - 1)

  if (change.kind === 'added') {
    const index = nearestLineIndex(lines, targetIndex, change.after)
    if (index === -1) return text
    lines.splice(index, 1)
    return joinEditableTextLines(editable)
  }

  if (change.kind === 'modified') {
    const index = nearestLineIndex(lines, targetIndex, change.after)
    if (index === -1) return updateLineInText(text, change.lineNumber, change.before)
    lines[index] = change.before
    return joinEditableTextLines(editable)
  }

  const insertIndex = Math.max(0, Math.min(targetIndex, lines.length))
  if (lines[insertIndex] === change.before || lines[insertIndex - 1] === change.before) return text
  lines.splice(insertIndex, 0, change.before)
  return joinEditableTextLines(editable)
}
