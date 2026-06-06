import type { DiffFile, DiffLine, DiffResult } from './branchPilot.js'

export interface DiffStats {
  additions: number
  deletions: number
}

export interface SplitDiffRow {
  oldLine?: DiffLine
  newLine?: DiffLine
}

export function buildSplitDiffRows(lines: DiffLine[]): SplitDiffRow[] {
  const rows: SplitDiffRow[] = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index]

    if (line.type === 'remove') {
      const removed: DiffLine[] = []
      const added: DiffLine[] = []

      while (lines[index]?.type === 'remove') {
        removed.push(lines[index])
        index += 1
      }

      while (lines[index]?.type === 'add') {
        added.push(lines[index])
        index += 1
      }

      const rowCount = Math.max(removed.length, added.length)

      for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
        rows.push({
          oldLine: removed[rowIndex],
          newLine: added[rowIndex]
        })
      }

      continue
    }

    if (line.type === 'add') {
      rows.push({ newLine: line })
      index += 1
      continue
    }

    rows.push({
      oldLine: line,
      newLine: line
    })
    index += 1
  }

  return rows
}

export function getDiffStats(diff: DiffResult): DiffStats {
  if (diff.files.length > 0) {
    return diff.files.reduce<DiffStats>((stats, file) => {
      const fileStats = getDiffFileStats(file)

      return {
        additions: stats.additions + fileStats.additions,
        deletions: stats.deletions + fileStats.deletions
      }
    }, emptyStats())
  }

  return getRawDiffStats(diff.text)
}

export function getDiffFileStats(file: DiffFile): DiffStats {
  return file.hunks.reduce<DiffStats>((stats, hunk) => {
    const hunkStats = getDiffLineStats(hunk.lines)

    return {
      additions: stats.additions + hunkStats.additions,
      deletions: stats.deletions + hunkStats.deletions
    }
  }, emptyStats())
}

function getDiffLineStats(lines: DiffLine[]): DiffStats {
  return lines.reduce<DiffStats>((stats, line) => {
    if (line.type === 'add') {
      return { ...stats, additions: stats.additions + 1 }
    }

    if (line.type === 'remove') {
      return { ...stats, deletions: stats.deletions + 1 }
    }

    return stats
  }, emptyStats())
}

function getRawDiffStats(text: string): DiffStats {
  return text.split('\n').reduce<DiffStats>((stats, line) => {
    if (line.startsWith('+++') || line.startsWith('---')) {
      return stats
    }

    if (line.startsWith('+')) {
      return { ...stats, additions: stats.additions + 1 }
    }

    if (line.startsWith('-')) {
      return { ...stats, deletions: stats.deletions + 1 }
    }

    return stats
  }, emptyStats())
}

function emptyStats(): DiffStats {
  return {
    additions: 0,
    deletions: 0
  }
}
