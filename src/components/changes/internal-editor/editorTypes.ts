import type { CssColorToken } from '../../diff/CssColorSwatch'

export interface EditorFileMenu {
  x: number
  y: number
  path: string
}

export interface LiveLineChange {
  lineNumber: number
  kind: 'added' | 'removed' | 'modified'
  before: string
  after: string
}

export interface EditorOverviewMarker {
  lineNumber: number
  kind: 'added' | 'removed' | 'modified' | 'search' | 'diagnostic'
  title: string
}

export interface EditorMinimapLine {
  lineNumber: number
  widthPercent: number
  kind: 'added' | 'removed' | 'modified' | 'search' | 'diagnostic' | 'multi-edit' | 'plain'
}

export interface EditorCssColorToken extends CssColorToken {
  lineNumber: number
  renderLineIndex: number
}

export interface ChunkedTextMarker {
  offset: number
  lineNumber: number
}

export interface ChunkedTextPreview {
  filePath: string
  text: string
  byteSize: number
  startOffset: number
  endOffset: number
  startLine: number
  hasMore: boolean
  markers: ChunkedTextMarker[]
  pageIndex: number
  loading: boolean
  error: string | null
}

export interface EditorDiagnostic {
  lineNumber: number
  column: number
  message: string
  source: 'JSON' | 'JSONC' | 'JS/TS' | 'JSX/TSX'
}
