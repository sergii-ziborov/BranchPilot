import { ActivityLogService } from '../../lib/activityLogService.js'
import type {
  AgentActivityOptions,
  CurrentGitStateOptions,
  FileOutlineOptions,
  MemoryQueryOptions,
  RecentCommitsOptions,
  SearchFilesOptions,
  SearchSymbolsOptions,
  SymbolContextOptions
} from './queryOptions.js'
import { findSymbol, matchesQuery, normalizeLimit, normalizeQuery } from './queryPrimitives.js'
import { loadProjectMemorySnapshot } from './snapshotStore.js'

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
