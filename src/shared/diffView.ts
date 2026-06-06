import type { DiffLine } from './branchPilot.js'

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
