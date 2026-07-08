export interface DiffRequest {
  repoPath: string
  filePath: string
  staged: boolean
  ignoreWhitespace?: boolean
  /** Lines of unchanged context around each hunk. Large value ≈ show the whole file. */
  contextLines?: number
}

export interface DiffContextRequest {
  repoPath: string
  filePath: string
  staged: boolean
  lineStart: number
  maxLines: number
}

export interface CssColorEditRequest {
  repoPath: string
  filePath: string
  lineNumber: number
  columnStart: number
  oldValue: string
  newValue: string
}

export type DiffLineType = 'context' | 'add' | 'remove' | 'meta'

export interface DiffLine {
  type: DiffLineType
  content: string
  oldLineNumber?: number
  newLineNumber?: number
}

export interface DiffHunk {
  header: string
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  lines: DiffLine[]
  patch: string
}

export interface DiffFile {
  oldPath?: string
  newPath: string
  hunks: DiffHunk[]
}

export interface DiffResult {
  filePath: string
  staged: boolean
  text: string
  binary: boolean
  tooLarge: boolean
  files: DiffFile[]
}

export interface DiffContextResult {
  filePath: string
  staged: boolean
  lineStart: number
  lineEnd: number
  totalLines: number
  lines: DiffLine[]
  hasMoreBefore: boolean
  hasMoreAfter: boolean
}
