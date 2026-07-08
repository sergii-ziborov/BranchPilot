import type { ProjectMemorySymbol } from '../../../src/shared/branchPilot.js'
import type { SymbolContextOptions } from './queryOptions.js'

const DEFAULT_LIMIT = 25
const MAX_LIMIT = 100

export function findSymbol(symbols: ProjectMemorySymbol[], options: SymbolContextOptions): ProjectMemorySymbol | undefined {
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

export function matchesQuery(value: string | undefined, query: string): boolean {
  if (!query) {
    return true
  }

  return normalizeQuery(value).includes(query)
}

export function normalizeQuery(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase()
}

export function normalizeLimit(limit: number | undefined): number {
  if (!limit || !Number.isFinite(limit)) {
    return DEFAULT_LIMIT
  }

  return Math.min(MAX_LIMIT, Math.max(1, Math.floor(limit)))
}
