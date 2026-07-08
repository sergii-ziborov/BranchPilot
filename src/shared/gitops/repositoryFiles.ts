export interface RepositoryFileEntry {
  path: string
}

export interface RepositorySearchRequest {
  repoPath: string
  query: string
  maxResults?: number
}

export interface RepositorySearchMatch {
  filePath: string
  lineNumber: number
  column: number
  length: number
  byteOffset: number
  preview: string
}

export interface RepositorySearchResult {
  query: string
  matches: RepositorySearchMatch[]
  truncated: boolean
  engine: 'rg' | 'git-grep'
  durationMs: number
}

export interface RepositoryFileContentRequest {
  repoPath: string
  filePath: string
}

export interface RepositoryFileContentResult {
  filePath: string
  text: string
  binary: boolean
  tooLarge: boolean
}

export interface RepositoryFileChunkRequest extends RepositoryFileContentRequest {
  offset: number
  maxBytes?: number
  mode?: 'text' | 'bytes'
}

export interface RepositoryFileChunkResult {
  filePath: string
  text: string
  base64?: string
  binary: boolean
  byteSize: number
  startOffset: number
  endOffset: number
  hasMore: boolean
}

export interface RepositoryFileWriteRequest extends RepositoryFileContentRequest {
  text: string
}

export interface RepositoryFileChunkWriteRequest extends RepositoryFileContentRequest {
  startOffset: number
  endOffset: number
  text?: string
  base64?: string
}

export interface RepositoryFileBytesResult {
  filePath: string
  base64: string
  byteSize: number
  tooLarge: boolean
  maxBytes: number
}

export interface RepositoryFileBytesWriteRequest extends RepositoryFileContentRequest {
  base64: string
}

export interface RepositoryFileRenameRequest extends RepositoryFileContentRequest {
  newFilePath: string
}

export interface RepositoryFileDeleteRequest extends RepositoryFileContentRequest {
  confirmed: boolean
}

export interface ImagePreviewRequest {
  repoPath: string
  filePath: string
  /** When set, preview the image from this commit instead of the working tree. */
  commitSha?: string
}

export interface ImagePreview {
  dataUrl: string
  mimeType: string
  byteSize: number
}
