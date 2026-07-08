import type { ReactNode } from 'react'
import { highlight } from '../../../lib/highlight'
import { clamp } from './editorPrimitives'
import type { EditorTextRange, FileSearchMatch } from './editorViewHelpers'

interface EditorLineDecoration {
  start: number
  end: number
  className: string
}

export function decoratedHighlightedLineContent(
  line: string,
  lang: string,
  searchQuery: string,
  activeMatch: FileSearchMatch | null,
  lineNumber: number,
  multiEditSelections: EditorTextRange[]
) {
  const query = searchQuery.trim()
  const decorations: EditorLineDecoration[] = []

  if (query) {
    const lowerLine = line.toLowerCase()
    const lowerQuery = query.toLowerCase()
    let column = lowerLine.indexOf(lowerQuery)

    while (column !== -1) {
      const active = activeMatch?.lineNumber === lineNumber && activeMatch.column === column
      decorations.push({
        start: column,
        end: column + query.length,
        className: active ? 'changes-editor-search-hit active' : 'changes-editor-search-hit'
      })
      column = lowerLine.indexOf(lowerQuery, column + Math.max(1, lowerQuery.length))
    }
  }

  for (const range of multiEditSelections) {
    decorations.push({
      start: clamp(range.start, 0, line.length),
      end: clamp(range.end, 0, line.length),
      className: range.start === range.end ? 'changes-editor-multi-cursor' : 'changes-editor-multi-edit-hit'
    })
  }

  if (decorations.length === 0) return highlight(line || ' ', lang)

  const points = new Set<number>([0, line.length])
  for (const decoration of decorations) {
    points.add(decoration.start)
    points.add(decoration.end)
  }

  const sortedPoints = [...points].sort((a, b) => a - b)
  const chunks: ReactNode[] = []
  let key = 0

  for (let index = 0; index < sortedPoints.length; index += 1) {
    const point = sortedPoints[index]
    const cursors = decorations.filter((decoration) => decoration.start === decoration.end && decoration.start === point)
    for (const cursor of cursors) {
      chunks.push(<span aria-hidden="true" className={cursor.className} key={`cursor-${key++}`} />)
    }

    const nextPoint = sortedPoints[index + 1]
    if (nextPoint === undefined || nextPoint <= point) continue

    const token = line.slice(point, nextPoint)
    const classes = decorations
      .filter((decoration) => decoration.start < nextPoint && point < decoration.end)
      .map((decoration) => decoration.className)

    if (classes.length === 0) {
      chunks.push(<span key={`plain-${key++}`}>{highlight(token, lang)}</span>)
      continue
    }

    chunks.push(
      <mark className={[...new Set(classes)].join(' ')} key={`decorated-${key++}`}>
        {highlight(token, lang)}
      </mark>
    )
  }

  return chunks.length ? chunks : highlight(line || ' ', lang)
}
