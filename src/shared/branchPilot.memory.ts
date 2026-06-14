import type {
  CommitSummary
} from './branchPilot.core'

export interface ProjectMemoryRepository {
  id: string
  rootPath: string
  name: string
  currentBranch: string
  remoteName?: string
  remoteUrl?: string
}

export interface ProjectMemoryStackHint {
  id: string
  label: string
  source: string
}

export type ProjectMemorySymbolKind =
  | 'function'
  | 'class'
  | 'method'
  | 'component'
  | 'constant'
  | 'type'
  | 'interface'
  | 'export'

export interface ProjectMemoryFile {
  path: string
  extension: string
  sizeBytes: number
  language?: string
  symbolCount: number
  importCount: number
}

export interface ProjectMemorySymbol {
  id: string
  name: string
  kind: ProjectMemorySymbolKind
  path: string
  line: number
  exported: boolean
  parentName?: string
}

export interface ProjectMemoryImport {
  path: string
  source: string
  specifiers: string[]
  line: number
}

export interface ProjectMemorySnapshot {
  version: 1
  scannedAt: string
  repository: ProjectMemoryRepository
  files: ProjectMemoryFile[]
  symbols: ProjectMemorySymbol[]
  imports: ProjectMemoryImport[]
  stackHints: ProjectMemoryStackHint[]
  recentCommits: CommitSummary[]
}

export interface ProjectMemoryScanResult {
  snapshot: ProjectMemorySnapshot
  durationMs: number
  scannedFileCount: number
  skippedFileCount: number
}

export interface ProjectMemoryMcpConfig {
  memoryDir: string
  activityDir: string
  wikiDir: string
  serverPath: string
  repoPath: string
  codexCommand: string
  codexToml: string
  serverExists: boolean
}

export type ProjectWikiPageId =
  | 'overview'
  | 'module_map'
  | 'important_symbols'
  | 'workflows'
  | 'assistant_policy'
  | 'recent_timeline'

export interface ProjectWikiPage {
  id: ProjectWikiPageId
  title: string
  summary: string
  markdown: string
}

export interface ProjectWikiSnapshot {
  version: 1
  generatedAt: string
  sourceMemoryScannedAt: string
  repository: ProjectMemoryRepository
  pages: ProjectWikiPage[]
}

export interface ProjectWikiGenerationResult {
  wiki: ProjectWikiSnapshot
  memory: ProjectMemoryScanResult
}

