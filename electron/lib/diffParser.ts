import type { DiffFile, DiffHunk, DiffLine } from '../../src/shared/branchPilot.js'

const HUNK_HEADER_PATTERN = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/

interface WorkingDiffFile {
  oldPath?: string
  newPath?: string
  headerLines: string[]
  hunks: DiffHunk[]
}

export function parseUnifiedDiff(text: string): DiffFile[] {
  const normalized = text.replace(/\r\n/g, '\n')
  const lines = normalized.endsWith('\n') ? normalized.slice(0, -1).split('\n') : normalized.split('\n')
  const files: DiffFile[] = []
  let currentFile: WorkingDiffFile | undefined
  let currentHunk: DiffHunk | undefined
  let oldLineNumber = 0
  let newLineNumber = 0

  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      finalizeFile(files, currentFile)
      currentFile = startFile(line)
      currentHunk = undefined
      continue
    }

    if (!currentFile) {
      continue
    }

    const hunkMatch = line.match(HUNK_HEADER_PATTERN)

    if (hunkMatch) {
      oldLineNumber = Number(hunkMatch[1])
      newLineNumber = Number(hunkMatch[3])
      currentHunk = {
        header: line,
        oldStart: oldLineNumber,
        oldLines: Number(hunkMatch[2] ?? '1'),
        newStart: newLineNumber,
        newLines: Number(hunkMatch[4] ?? '1'),
        lines: [],
        patch: ''
      }
      currentHunk.patch = buildPatch(currentFile.headerLines, [line])
      currentFile.hunks.push(currentHunk)
      continue
    }

    if (!currentHunk) {
      currentFile.headerLines.push(line)
      updateFilePaths(currentFile, line)
      continue
    }

    const parsedLine = parseDiffLine(line, oldLineNumber, newLineNumber)

    currentHunk.lines.push(parsedLine.line)
    currentHunk.patch = buildPatch(currentFile.headerLines, [
      currentHunk.header,
      ...currentHunk.lines.map(formatDiffLineForPatch)
    ])
    oldLineNumber = parsedLine.nextOldLineNumber
    newLineNumber = parsedLine.nextNewLineNumber
  }

  finalizeFile(files, currentFile)

  return files
}

function startFile(line: string): WorkingDiffFile {
  const match = line.match(/^diff --git\s+(.+)\s+(.+)$/)
  const oldPath = match ? parseDiffPath(match[1]) : undefined
  const newPath = match ? parseDiffPath(match[2]) : undefined

  return {
    oldPath,
    newPath,
    headerLines: [line],
    hunks: []
  }
}

function updateFilePaths(file: WorkingDiffFile, line: string) {
  if (line.startsWith('--- ')) {
    file.oldPath = parseDiffPath(line.slice(4))
  } else if (line.startsWith('+++ ')) {
    file.newPath = parseDiffPath(line.slice(4))
  }
}

function parseDiffLine(
  line: string,
  oldLineNumber: number,
  newLineNumber: number
): { line: DiffLine; nextOldLineNumber: number; nextNewLineNumber: number } {
  if (line.startsWith('+')) {
    return {
      line: {
        type: 'add',
        content: line.slice(1),
        newLineNumber
      },
      nextOldLineNumber: oldLineNumber,
      nextNewLineNumber: newLineNumber + 1
    }
  }

  if (line.startsWith('-')) {
    return {
      line: {
        type: 'remove',
        content: line.slice(1),
        oldLineNumber
      },
      nextOldLineNumber: oldLineNumber + 1,
      nextNewLineNumber: newLineNumber
    }
  }

  if (line.startsWith(' ')) {
    return {
      line: {
        type: 'context',
        content: line.slice(1),
        oldLineNumber,
        newLineNumber
      },
      nextOldLineNumber: oldLineNumber + 1,
      nextNewLineNumber: newLineNumber + 1
    }
  }

  return {
    line: {
      type: 'meta',
      content: line
    },
    nextOldLineNumber: oldLineNumber,
    nextNewLineNumber: newLineNumber
  }
}

function formatDiffLineForPatch(line: DiffLine): string {
  if (line.type === 'add') return `+${line.content}`
  if (line.type === 'remove') return `-${line.content}`
  if (line.type === 'context') return ` ${line.content}`
  return line.content
}

function finalizeFile(files: DiffFile[], file: WorkingDiffFile | undefined) {
  if (!file) return

  files.push({
    oldPath: file.oldPath === '/dev/null' ? undefined : file.oldPath,
    newPath: file.newPath ?? file.oldPath ?? 'unknown',
    hunks: file.hunks
  })
}

function buildPatch(headerLines: string[], hunkLines: string[]): string {
  return `${[...headerLines, ...hunkLines].join('\n')}\n`
}

function parseDiffPath(value: string): string | undefined {
  const trimmed = value.trim()

  if (!trimmed || trimmed === '/dev/null') {
    return trimmed || undefined
  }

  const unquoted = trimmed.startsWith('"') && trimmed.endsWith('"')
    ? trimmed.slice(1, -1).replace(/\\"/g, '"')
    : trimmed

  return unquoted.replace(/^[ab]\//, '')
}
