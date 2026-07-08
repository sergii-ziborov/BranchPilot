export interface EditorSelectionStatus {
  lineNumber: number
  column: number
  selectedChars: number
  selectedLines: number
}

export type EditorLineEnding = 'LF' | 'CRLF' | 'CR' | 'Mixed'
export type EditorIndentKind = 'spaces' | 'tabs' | 'mixed' | 'none'

export interface EditorLineEndingInfo {
  kind: EditorLineEnding
  lf: number
  crlf: number
  cr: number
}

export interface EditorIndentInfo {
  kind: EditorIndentKind
  size: number
}

export interface FileLineSearchTarget {
  lineNumber: number
  column: number
}

export interface RepositoryContentSearchMatch {
  filePath: string
  lineNumber: number
  column: number
  length: number
  byteOffset: number
  preview: string
}

export interface RepositoryContentSearchState {
  status: 'idle' | 'searching' | 'done'
  scanned: number
  truncated: boolean
  error: string | null
}
