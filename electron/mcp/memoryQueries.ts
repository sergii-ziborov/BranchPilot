import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type {
  ActivityLogActor,
  ActivityLogEventType,
  ActivityLogStatus,
  ProjectMemoryFile,
  ProjectMemoryImport,
  ProjectMemorySnapshot,
  ProjectMemorySymbol,
  ProjectMemorySymbolKind,
  ProjectWikiPageId,
  ProjectWikiSnapshot
} from '../../src/shared/branchPilot.js'
import { ActivityLogService } from '../lib/activityLogService.js'
import { ProjectWikiStore } from '../lib/projectWikiService.js'

export interface MemoryQueryOptions {
  memoryDir: string
  activityDir?: string
  wikiDir?: string
  repoPath?: string
}

export interface SearchFilesOptions extends MemoryQueryOptions {
  query?: string
  language?: string
  limit?: number
}

export interface SearchSymbolsOptions extends MemoryQueryOptions {
  query?: string
  kind?: ProjectMemorySymbolKind
  path?: string
  limit?: number
}

export interface FileOutlineOptions extends MemoryQueryOptions {
  path: string
}

export interface SymbolContextOptions extends MemoryQueryOptions {
  symbolId?: string
  name?: string
  path?: string
}

export interface RecentCommitsOptions extends MemoryQueryOptions {
  limit?: number
}

export type CurrentGitStateOptions = MemoryQueryOptions

export interface AgentActivityOptions extends MemoryQueryOptions {
  types?: ActivityLogEventType[]
  actor?: ActivityLogActor
  status?: ActivityLogStatus
  limit?: number
}

export interface WikiPageOptions extends MemoryQueryOptions {
  pageId: ProjectWikiPageId
}

export const MCP_RESOURCE_URIS = [
  'branchpilot://repo/current/summary',
  'branchpilot://repo/current/tree',
  'branchpilot://repo/current/symbols',
  'branchpilot://repo/current/commits',
  'branchpilot://repo/current/activity',
  'branchpilot://repo/current/wiki'
] as const

const DEFAULT_LIMIT = 25
const MAX_LIMIT = 100
const MAX_RESOURCE_ITEMS = 500
const SNAPSHOT_VERSION = 1

export async function loadProjectMemorySnapshot(options: MemoryQueryOptions): Promise<ProjectMemorySnapshot> {
  if (!options.memoryDir.trim()) {
    throw new Error('Project Memory directory is required.')
  }

  if (options.repoPath) {
    const legacyFilePath = path.join(options.memoryDir, `${repositoryId(options.repoPath)}.json`)

    try {
      return await readSnapshot(legacyFilePath)
    } catch {
      const snapshots = await readSnapshots(options.memoryDir)
      const normalizedRepoPath = normalizePath(options.repoPath)
      const matchingSnapshots = snapshots.filter((snapshot) => normalizePath(snapshot.repository.rootPath) === normalizedRepoPath)

      matchingSnapshots.sort((left, right) => right.scannedAt.localeCompare(left.scannedAt))

      const match = matchingSnapshots[0]

      if (match) {
        return match
      }

      throw new Error('No Project Memory snapshot found for this repository. Open the repository in BranchPilot and run Memory > Rescan.')
    }
  }

  const snapshots = await readSnapshots(options.memoryDir)

  snapshots.sort((left, right) => right.scannedAt.localeCompare(left.scannedAt))

  const latest = snapshots[0]

  if (!latest) {
    throw new Error('No Project Memory snapshot found. Open the repository in BranchPilot and run Memory > Rescan.')
  }

  return latest
}

export async function loadProjectWikiSnapshot(options: MemoryQueryOptions): Promise<ProjectWikiSnapshot> {
  const snapshot = await loadProjectMemorySnapshot(options)

  if (!options.wikiDir?.trim()) {
    throw new Error('Project Wiki directory is required. Recopy the BranchPilot MCP config from Reports > MCP.')
  }

  const wiki = await new ProjectWikiStore(options.wikiDir).read(snapshot.repository)

  if (!wiki) {
    throw new Error('No Project Wiki snapshot found. Open the repository in BranchPilot and run Memory > Generate wiki.')
  }

  return wiki
}

export async function getProjectSummary(options: MemoryQueryOptions) {
  const snapshot = await loadProjectMemorySnapshot(options)
  const activity = await getAgentActivity({ ...options, limit: 10 })

  return {
    scannedAt: snapshot.scannedAt,
    repository: snapshot.repository,
    counts: {
      files: snapshot.files.length,
      symbols: snapshot.symbols.length,
      imports: snapshot.imports.length,
      recentCommits: snapshot.recentCommits.length,
      recentActivity: activity.totalCount
    },
    stackHints: snapshot.stackHints,
    recentCommits: snapshot.recentCommits.slice(0, 10),
    recentActivity: activity.entries
  }
}

export async function getProjectWiki(options: MemoryQueryOptions) {
  const wiki = await loadProjectWikiSnapshot(options)

  return {
    generatedAt: wiki.generatedAt,
    sourceMemoryScannedAt: wiki.sourceMemoryScannedAt,
    repository: wiki.repository,
    pages: wiki.pages.map((page) => ({
      id: page.id,
      title: page.title,
      summary: page.summary
    }))
  }
}

export async function getWikiPage(options: WikiPageOptions) {
  const wiki = await loadProjectWikiSnapshot(options)
  const page = wiki.pages.find((candidate) => candidate.id === options.pageId)

  if (!page) {
    throw new Error(`Project Wiki page "${options.pageId}" was not found.`)
  }

  return {
    generatedAt: wiki.generatedAt,
    sourceMemoryScannedAt: wiki.sourceMemoryScannedAt,
    repository: wiki.repository,
    page
  }
}

export async function searchFiles(options: SearchFilesOptions) {
  const snapshot = await loadProjectMemorySnapshot(options)
  const query = normalizeQuery(options.query)
  const language = normalizeQuery(options.language)

  const files = snapshot.files
    .filter((file) => matchesQuery(file.path, query) || matchesQuery(file.language, query))
    .filter((file) => !language || matchesQuery(file.language, language) || matchesQuery(file.extension, language))
    .slice(0, normalizeLimit(options.limit))

  return {
    scannedAt: snapshot.scannedAt,
    repository: snapshot.repository,
    files
  }
}

export async function searchSymbols(options: SearchSymbolsOptions) {
  const snapshot = await loadProjectMemorySnapshot(options)
  const query = normalizeQuery(options.query)
  const pathQuery = normalizeQuery(options.path)

  const symbols = snapshot.symbols
    .filter((symbol) => matchesQuery(symbol.name, query) || matchesQuery(symbol.parentName, query))
    .filter((symbol) => !options.kind || symbol.kind === options.kind)
    .filter((symbol) => !pathQuery || matchesQuery(symbol.path, pathQuery))
    .slice(0, normalizeLimit(options.limit))

  return {
    scannedAt: snapshot.scannedAt,
    repository: snapshot.repository,
    symbols
  }
}

export async function getFileOutline(options: FileOutlineOptions) {
  const snapshot = await loadProjectMemorySnapshot(options)
  const file = snapshot.files.find((candidate) => candidate.path === options.path)

  if (!file) {
    throw new Error(`File "${options.path}" is not indexed in Project Memory.`)
  }

  return {
    scannedAt: snapshot.scannedAt,
    repository: snapshot.repository,
    file,
    symbols: snapshot.symbols.filter((symbol) => symbol.path === file.path),
    imports: snapshot.imports.filter((entry) => entry.path === file.path)
  }
}

export async function getSymbolContext(options: SymbolContextOptions) {
  const snapshot = await loadProjectMemorySnapshot(options)
  const symbol = findSymbol(snapshot.symbols, options)

  if (!symbol) {
    throw new Error('Symbol was not found in Project Memory.')
  }

  const sameFileSymbols = snapshot.symbols.filter((candidate) => candidate.path === symbol.path)
  const index = sameFileSymbols.findIndex((candidate) => candidate.id === symbol.id)
  const nearbySymbols = sameFileSymbols.slice(Math.max(0, index - 5), index + 6)
  const imports = snapshot.imports.filter((entry) => entry.path === symbol.path)

  return {
    scannedAt: snapshot.scannedAt,
    repository: snapshot.repository,
    symbol,
    file: snapshot.files.find((file) => file.path === symbol.path),
    imports,
    nearbySymbols
  }
}

export async function getRecentCommits(options: RecentCommitsOptions) {
  const snapshot = await loadProjectMemorySnapshot(options)

  return {
    scannedAt: snapshot.scannedAt,
    repository: snapshot.repository,
    commits: snapshot.recentCommits.slice(0, normalizeLimit(options.limit))
  }
}

export async function getCurrentGitState(options: CurrentGitStateOptions) {
  const snapshot = await loadProjectMemorySnapshot(options)

  return {
    scannedAt: snapshot.scannedAt,
    indexedState: true,
    repository: snapshot.repository
  }
}

export async function getAgentActivity(options: AgentActivityOptions) {
  const snapshot = await loadProjectMemorySnapshot(options)

  if (!options.activityDir) {
    return {
      scannedAt: snapshot.scannedAt,
      repository: snapshot.repository,
      totalCount: 0,
      entries: []
    }
  }

  const activity = await new ActivityLogService(options.activityDir).getActivityLog({
    repoPath: snapshot.repository.rootPath,
    types: options.types,
    actor: options.actor,
    status: options.status,
    limit: normalizeLimit(options.limit)
  })

  return {
    scannedAt: snapshot.scannedAt,
    repository: snapshot.repository,
    totalCount: activity.totalCount,
    entries: activity.entries
  }
}

export async function getResourcePayload(options: MemoryQueryOptions, uri: string): Promise<unknown> {
  const snapshot = await loadProjectMemorySnapshot(options)

  if (uri === 'branchpilot://repo/current/summary') {
    return getProjectSummary(options)
  }

  if (uri === 'branchpilot://repo/current/tree') {
    return {
      scannedAt: snapshot.scannedAt,
      repository: snapshot.repository,
      files: snapshot.files.slice(0, MAX_RESOURCE_ITEMS)
    }
  }

  if (uri === 'branchpilot://repo/current/symbols') {
    return {
      scannedAt: snapshot.scannedAt,
      repository: snapshot.repository,
      symbols: snapshot.symbols.slice(0, MAX_RESOURCE_ITEMS)
    }
  }

  if (uri === 'branchpilot://repo/current/commits') {
    return {
      scannedAt: snapshot.scannedAt,
      repository: snapshot.repository,
      commits: snapshot.recentCommits
    }
  }

  if (uri === 'branchpilot://repo/current/activity') {
    return getAgentActivity({ ...options, limit: 100 })
  }

  if (uri === 'branchpilot://repo/current/wiki') {
    return loadProjectWikiSnapshot(options)
  }

  throw new Error(`Unknown BranchPilot resource: ${uri}`)
}

export function getPromptText(name: string): string {
  if (name === 'review-current-work') {
    return [
      'Use BranchPilot Project Memory to understand the repository structure before reviewing changes.',
      'Start with project_summary, then search_symbols/search_files for affected modules.',
      'Focus on consistency, security, correctness, and maintainability. Do not mutate files from MCP.'
    ].join('\n')
  }

  if (name === 'prepare-change-plan') {
    return [
      'Use BranchPilot Project Memory to map relevant files, symbols, imports, and recent commits.',
      'Return a concise implementation plan with risks, tests, and files likely to change.',
      'Use shell/git separately only when live state is needed.'
    ].join('\n')
  }

  if (name === 'explain-module') {
    return [
      'Use get_file_outline and search_symbols to explain the requested module.',
      'Summarize responsibilities, important symbols, dependencies, and likely extension points.',
      'Mention Project Memory scannedAt so the user understands freshness.'
    ].join('\n')
  }

  if (name === 'summarize-recent-work') {
    return [
      'Use get_recent_commits and project_summary to summarize recent project work.',
      'Group changes by theme and identify follow-up work. Do not invent commits not present in Project Memory.'
    ].join('\n')
  }

  throw new Error(`Unknown BranchPilot prompt: ${name}`)
}

export function toJsonText(payload: unknown): string {
  return JSON.stringify(payload, null, 2)
}

async function readSnapshot(filePath: string): Promise<ProjectMemorySnapshot> {
  let raw: string

  try {
    raw = await fs.readFile(filePath, 'utf8')
  } catch {
    throw new Error('No Project Memory snapshot found. Open the repository in BranchPilot and run Memory > Rescan.')
  }

  try {
    const parsed = JSON.parse(raw) as ProjectMemorySnapshot

    if (parsed.version !== SNAPSHOT_VERSION || !parsed.repository?.rootPath || !Array.isArray(parsed.files)) {
      throw new Error('Invalid Project Memory snapshot.')
    }

    return parsed
  } catch (error) {
    if (error instanceof Error && error.message === 'Invalid Project Memory snapshot.') {
      throw error
    }

    throw new Error('Project Memory snapshot is malformed. Run Memory > Rescan in BranchPilot.', {
      cause: error
    })
  }
}

async function readSnapshots(directoryPath: string): Promise<ProjectMemorySnapshot[]> {
  const entries = await fs.readdir(directoryPath, { withFileTypes: true }).catch(() => [])
  const snapshots: ProjectMemorySnapshot[] = []

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) {
      continue
    }

    try {
      snapshots.push(await readSnapshot(path.join(directoryPath, entry.name)))
    } catch {
      continue
    }
  }

  return snapshots
}

function normalizePath(filePath: string): string {
  return path.resolve(filePath)
}

function findSymbol(symbols: ProjectMemorySymbol[], options: SymbolContextOptions): ProjectMemorySymbol | undefined {
  if (options.symbolId) {
    return symbols.find((symbol) => symbol.id === options.symbolId)
  }

  const query = normalizeQuery(options.name)
  const pathQuery = normalizeQuery(options.path)

  return symbols.find((symbol) =>
    (matchesQuery(symbol.name, query) || matchesQuery(symbol.parentName, query)) &&
    (!pathQuery || matchesQuery(symbol.path, pathQuery))
  )
}

function matchesQuery(value: string | undefined, query: string): boolean {
  if (!query) {
    return true
  }

  return normalizeQuery(value).includes(query)
}

function normalizeQuery(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase()
}

function normalizeLimit(limit: number | undefined): number {
  if (!limit || !Number.isFinite(limit)) {
    return DEFAULT_LIMIT
  }

  return Math.min(MAX_LIMIT, Math.max(1, Math.floor(limit)))
}

function repositoryId(rootPath: string): string {
  return createHash('sha256').update(rootPath).digest('hex').slice(0, 16)
}

export type BranchPilotMcpToolName =
  | 'project_summary'
  | 'search_files'
  | 'search_symbols'
  | 'get_file_outline'
  | 'get_symbol_context'
  | 'get_recent_commits'
  | 'get_current_git_state'
  | 'get_agent_activity'
  | 'get_project_wiki'
  | 'get_wiki_page'

export interface BranchPilotMcpToolDefinition {
  name: BranchPilotMcpToolName
  description: string
}

export const BRANCHPILOT_MCP_TOOLS: BranchPilotMcpToolDefinition[] = [
  {
    name: 'project_summary',
    description: 'Return repository identity, stack hints, counts, and recent commit summary from Project Memory.'
  },
  {
    name: 'search_files',
    description: 'Search indexed Project Memory files by path, language, or extension.'
  },
  {
    name: 'search_symbols',
    description: 'Search indexed functions, classes, methods, components, types, interfaces, and exports.'
  },
  {
    name: 'get_file_outline',
    description: 'Return symbols and imports for one indexed file path.'
  },
  {
    name: 'get_symbol_context',
    description: 'Return one symbol plus nearby symbols and imports from the same file.'
  },
  {
    name: 'get_recent_commits',
    description: 'Return recent commits stored in Project Memory.'
  },
  {
    name: 'get_current_git_state',
    description: 'Return branch and remote state from the latest Project Memory snapshot.'
  },
  {
    name: 'get_agent_activity',
    description: 'Return recent BranchPilot activity for this repository from the local Activity Log.'
  },
  {
    name: 'get_project_wiki',
    description: 'Return Project Wiki page summaries generated locally by BranchPilot.'
  },
  {
    name: 'get_wiki_page',
    description: 'Return one generated Project Wiki page by page id.'
  }
]

export function sortFilesForDisplay(files: ProjectMemoryFile[]): ProjectMemoryFile[] {
  return [...files].sort((left, right) => left.path.localeCompare(right.path))
}

export function sortImportsForDisplay(imports: ProjectMemoryImport[]): ProjectMemoryImport[] {
  return [...imports].sort((left, right) => left.path.localeCompare(right.path) || left.line - right.line)
}
