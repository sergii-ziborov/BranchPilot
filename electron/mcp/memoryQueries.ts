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

export type ProjectHealthSeverity = 'critical' | 'warning' | 'notice' | 'healthy'

export interface ProjectHealthOptions extends MemoryQueryOptions {
  limit?: number
  minimumSeverity?: ProjectHealthSeverity
  includeHealthy?: boolean
}

export interface ProjectHealthIssue {
  code: string
  severity: Exclude<ProjectHealthSeverity, 'healthy'>
  title: string
  detail: string
}

export interface ProjectHealthFileReport {
  path: string
  extension: string
  language?: string
  sizeBytes: number
  symbolCount: number
  importCount: number
  exportedSymbolCount: number
  externalImportCount: number
  severity: ProjectHealthSeverity
  score: number
  issues: ProjectHealthIssue[]
}

export interface WikiPageOptions extends MemoryQueryOptions {
  pageId: ProjectWikiPageId
}

export const MCP_RESOURCE_URIS = [
  'branchpilot://repo/current/summary',
  'branchpilot://repo/current/health',
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

export async function getProjectHealth(options: ProjectHealthOptions) {
  const snapshot = await loadProjectMemorySnapshot(options)
  const context = buildProjectHealthContext(snapshot)
  const reports = snapshot.files.map((file) => buildProjectHealthFileReport(file, context))
  const minimumSeverity = options.minimumSeverity ?? (options.includeHealthy ? 'healthy' : 'notice')
  const filteredReports = reports
    .filter((report) => options.includeHealthy || report.severity !== 'healthy')
    .filter((report) => severityRank(report.severity) >= severityRank(minimumSeverity))
    .sort((left, right) =>
      severityRank(right.severity) - severityRank(left.severity) ||
      right.score - left.score ||
      left.path.localeCompare(right.path)
    )
    .slice(0, normalizeLimit(options.limit))

  const reportedFiles = reports.filter((report) => report.severity !== 'healthy')

  return {
    scannedAt: snapshot.scannedAt,
    repository: snapshot.repository,
    summary: {
      totalFiles: reports.length,
      reportedFiles: reportedFiles.length,
      healthyFiles: reports.length - reportedFiles.length,
      criticalFiles: reports.filter((report) => report.severity === 'critical').length,
      warningFiles: reports.filter((report) => report.severity === 'warning').length,
      noticeFiles: reports.filter((report) => report.severity === 'notice').length,
      totalIssues: reports.reduce((total, report) => total + report.issues.length, 0),
      criticalIssues: countIssuesBySeverity(reports, 'critical'),
      warningIssues: countIssuesBySeverity(reports, 'warning'),
      noticeIssues: countIssuesBySeverity(reports, 'notice')
    },
    files: filteredReports
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

  if (uri === 'branchpilot://repo/current/health') {
    return getProjectHealth({ ...options, limit: 100 })
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
      'Start with project_summary, get_project_health, get_repository_status, and get_repository_diff, then search_symbols/search_files for affected modules.',
      'Focus on consistency, security, correctness, and maintainability. Do not mutate files from MCP.'
    ].join('\n')
  }

  if (name === 'prepare-change-plan') {
    return [
      'Use BranchPilot Project Memory to map relevant files, symbols, imports, and recent commits.',
      'Use get_project_health and live repository tools to identify high-risk files, diffs, refs, and current worktree state.',
      'Return a concise implementation plan with risks, tests, and files likely to change.'
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
      'Use search_commit_history, get_recent_commits, get_agent_activity, and project_summary to summarize recent project work.',
      'Group changes by theme and identify follow-up work. Do not invent commits not present in Git, Project Memory, or Activity Log.'
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
  let firstSnapshotError: Error | undefined

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) {
      continue
    }

    try {
      snapshots.push(await readSnapshot(path.join(directoryPath, entry.name)))
    } catch (error) {
      if (!firstSnapshotError && error instanceof Error && !error.message.startsWith('No Project Memory snapshot found')) {
        firstSnapshotError = error
      }
    }
  }

  if (snapshots.length === 0 && firstSnapshotError) {
    throw firstSnapshotError
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

interface ProjectHealthContext {
  exportedSymbolsByPath: Map<string, number>
  externalImportsByPath: Map<string, number>
}

function buildProjectHealthContext(snapshot: ProjectMemorySnapshot): ProjectHealthContext {
  const exportedSymbolsByPath = new Map<string, number>()
  const externalImportsByPath = new Map<string, number>()

  for (const symbol of snapshot.symbols) {
    if (!symbol.exported) continue
    exportedSymbolsByPath.set(symbol.path, (exportedSymbolsByPath.get(symbol.path) ?? 0) + 1)
  }

  for (const entry of snapshot.imports) {
    if (!isExternalImport(entry.source)) continue
    externalImportsByPath.set(entry.path, (externalImportsByPath.get(entry.path) ?? 0) + 1)
  }

  return {
    exportedSymbolsByPath,
    externalImportsByPath
  }
}

function buildProjectHealthFileReport(
  file: ProjectMemoryFile,
  context: ProjectHealthContext
): ProjectHealthFileReport {
  const issues: ProjectHealthIssue[] = []
  const fileName = file.path.split('/').pop()?.toLowerCase() ?? file.path.toLowerCase()
  const exportedSymbolCount = context.exportedSymbolsByPath.get(file.path) ?? 0
  const externalImportCount = context.externalImportsByPath.get(file.path) ?? 0
  const generated = isGeneratedOrLockFile(fileName, file.path)

  if (generated && file.sizeBytes >= 128 * 1024) {
    issues.push({
      code: 'large-generated-file',
      severity: 'warning',
      title: 'Large generated or lock file',
      detail: `${formatBytes(file.sizeBytes)} is usually better treated as generated context. Inspect deliberately before changing.`
    })
  } else if (file.sizeBytes >= 512 * 1024) {
    issues.push({
      code: 'large-file',
      severity: 'critical',
      title: 'Very large file',
      detail: `${formatBytes(file.sizeBytes)} may be chunked or slow to inspect. Prefer targeted reads and tests.`
    })
  } else if (file.sizeBytes >= 128 * 1024) {
    issues.push({
      code: 'large-file',
      severity: 'warning',
      title: 'Large file',
      detail: `${formatBytes(file.sizeBytes)} can hide wide impact and is easier to review in chunks.`
    })
  }

  if (file.symbolCount >= 80) {
    issues.push({
      code: 'dense-symbols',
      severity: 'critical',
      title: 'Dense symbol surface',
      detail: `${file.symbolCount} indexed symbols suggest a broad behavior surface in one file.`
    })
  } else if (file.symbolCount >= 35) {
    issues.push({
      code: 'dense-symbols',
      severity: 'warning',
      title: 'Many symbols',
      detail: `${file.symbolCount} indexed symbols can make edits harder to reason about.`
    })
  }

  if (file.importCount >= 30) {
    issues.push({
      code: 'dense-imports',
      severity: 'critical',
      title: 'High dependency pressure',
      detail: `${file.importCount} imports mean changes may couple many modules or packages.`
    })
  } else if (file.importCount >= 15) {
    issues.push({
      code: 'dense-imports',
      severity: 'warning',
      title: 'Import-heavy file',
      detail: `${file.importCount} imports are worth checking before editing.`
    })
  }

  if (externalImportCount >= 20) {
    issues.push({
      code: 'external-import-pressure',
      severity: 'warning',
      title: 'Many external imports',
      detail: `${externalImportCount} package imports can increase integration and upgrade risk.`
    })
  }

  if (exportedSymbolCount >= 20) {
    issues.push({
      code: 'wide-export-surface',
      severity: 'warning',
      title: 'Wide export surface',
      detail: `${exportedSymbolCount} exported symbols can be consumed from many places.`
    })
  } else if (exportedSymbolCount >= 8) {
    issues.push({
      code: 'wide-export-surface',
      severity: 'notice',
      title: 'Notable export surface',
      detail: `${exportedSymbolCount} exported symbols make this a useful file to inspect during planning.`
    })
  }

  if (!generated && isEntrypointFile(fileName, file.path)) {
    issues.push({
      code: 'entrypoint',
      severity: 'notice',
      title: 'Entrypoint or routed surface',
      detail: 'Changes here can affect startup, routing, rendering, or application composition.'
    })
  }

  if (!generated && isConfigFile(fileName, file.path)) {
    issues.push({
      code: 'configuration',
      severity: 'notice',
      title: 'Configuration surface',
      detail: 'Small changes here can affect tooling, builds, tests, or runtime behavior.'
    })
  }

  const severity = fileSeverity(issues)
  const score = severityRank(severity) * 1000 +
    Math.round(file.sizeBytes / 1024) +
    file.symbolCount * 5 +
    file.importCount * 4 +
    exportedSymbolCount * 6 +
    externalImportCount * 3

  return {
    path: file.path,
    extension: file.extension,
    language: file.language,
    sizeBytes: file.sizeBytes,
    symbolCount: file.symbolCount,
    importCount: file.importCount,
    exportedSymbolCount,
    externalImportCount,
    severity,
    score,
    issues
  }
}

function fileSeverity(issues: ProjectHealthIssue[]): ProjectHealthSeverity {
  if (issues.some((issue) => issue.severity === 'critical')) return 'critical'
  if (issues.some((issue) => issue.severity === 'warning')) return 'warning'
  if (issues.some((issue) => issue.severity === 'notice')) return 'notice'
  return 'healthy'
}

function countIssuesBySeverity(
  reports: ProjectHealthFileReport[],
  severity: Exclude<ProjectHealthSeverity, 'healthy'>
): number {
  return reports.reduce(
    (total, report) => total + report.issues.filter((issue) => issue.severity === severity).length,
    0
  )
}

function severityRank(severity: ProjectHealthSeverity): number {
  if (severity === 'critical') return 3
  if (severity === 'warning') return 2
  if (severity === 'notice') return 1
  return 0
}

function isGeneratedOrLockFile(fileName: string, filePath: string): boolean {
  const normalized = filePath.toLowerCase()
  return /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb|composer\.lock|cargo\.lock|poetry\.lock)$/.test(normalized) ||
    /\.(min\.js|map|lock|snap)$/.test(fileName) ||
    /(^|\/)(dist|build|coverage|vendor|node_modules)\//.test(normalized)
}

function isEntrypointFile(fileName: string, filePath: string): boolean {
  const normalized = filePath.toLowerCase()
  return /^(main|index|app|router|routes|layout|page|server|client)\.(tsx|ts|jsx|js|mjs|cjs|vue|svelte)$/.test(fileName) ||
    /(^|\/)(main|index|app|router|routes|layout|page)\.(tsx|ts|jsx|js|mjs|cjs)$/.test(normalized)
}

function isConfigFile(fileName: string, filePath: string): boolean {
  const normalized = filePath.toLowerCase()
  return /(^|\/)(package\.json|tsconfig[^/]*\.json|vite\.config\.(ts|js|mjs|cjs)|eslint\.config\.(ts|js|mjs|cjs)|knip\.json|prettier[^/]*|tailwind\.config\.(ts|js|mjs|cjs))$/.test(normalized) ||
    /\.(config|rc)\.(ts|js|json|jsonc|mjs|cjs)$/.test(fileName)
}

function isExternalImport(source: string): boolean {
  return Boolean(source) && !source.startsWith('.') && !source.startsWith('/') && !source.startsWith('@/') && !source.startsWith('#')
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  }

  if (bytes >= 1024) {
    return `${Math.round(bytes / 1024)} KB`
  }

  return `${bytes} B`
}

function repositoryId(rootPath: string): string {
  return createHash('sha256').update(rootPath).digest('hex').slice(0, 16)
}

export type BranchPilotMcpToolName =
  | 'project_summary'
  | 'get_project_health'
  | 'search_files'
  | 'search_symbols'
  | 'get_file_outline'
  | 'get_symbol_context'
  | 'get_recent_commits'
  | 'get_current_git_state'
  | 'get_repository_status'
  | 'list_repository_refs'
  | 'list_repository_files'
  | 'read_repository_file'
  | 'search_repository_text'
  | 'get_repository_diff'
  | 'search_commit_history'
  | 'get_commit_details'
  | 'get_file_history'
  | 'get_repository_blame'
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
    name: 'get_project_health',
    description: 'Return file-level health signals from Project Memory, including large files, dense modules, import pressure, configs, and entrypoints.'
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
    name: 'get_repository_status',
    description: 'Return live local Git status, branch/upstream divergence, and changed files.'
  },
  {
    name: 'list_repository_refs',
    description: 'Return live local branches, remote branches, tags, remotes, and worktrees.'
  },
  {
    name: 'list_repository_files',
    description: 'List tracked and optionally untracked non-ignored files from the live repository worktree.'
  },
  {
    name: 'read_repository_file',
    description: 'Read a repository file from the working tree or a Git revision with line and byte limits.'
  },
  {
    name: 'search_repository_text',
    description: 'Search literal text across non-ignored repository files with optional path, extension, and context filters.'
  },
  {
    name: 'get_repository_diff',
    description: 'Return live Git diff/stat for the working tree, staged changes, one path, or a base/head comparison.'
  },
  {
    name: 'search_commit_history',
    description: 'Search live Git commit history by grep query and optional path filter.'
  },
  {
    name: 'get_commit_details',
    description: 'Return live Git commit metadata, changed files, stat text, and optional patch text.'
  },
  {
    name: 'get_file_history',
    description: 'Return live Git history for one file, following renames.'
  },
  {
    name: 'get_repository_blame',
    description: 'Return live Git blame metadata for a bounded range of one file.'
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
