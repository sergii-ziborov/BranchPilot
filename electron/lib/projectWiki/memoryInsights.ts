import type {
  ProjectMemoryFile,
  ProjectMemorySnapshot,
  ProjectMemorySymbol
} from '../../../src/shared/branchPilot.js'

export const MAX_LIST_ITEMS = 20
const MAX_MODULE_WIKI_PAGES = 32

export function summarizeDirectories(files: ProjectMemoryFile[], depth = 1, limit = MAX_LIST_ITEMS) {
  const directories = new Map<string, { name: string; files: number; symbols: number; imports: number; sizeBytes: number }>()

  for (const file of files) {
    const directory = directoryKey(file.path, depth)
    const entry = directories.get(directory) ?? { name: directory, files: 0, symbols: 0, imports: 0, sizeBytes: 0 }
    entry.files += 1
    entry.symbols += file.symbolCount
    entry.imports += file.importCount
    entry.sizeBytes += file.sizeBytes
    directories.set(directory, entry)
  }

  return [...directories.values()]
    .sort((left, right) => right.files - left.files || right.symbols - left.symbols || left.name.localeCompare(right.name))
    .slice(0, limit)
}

export function wikiModuleDirectories(snapshot: ProjectMemorySnapshot) {
  return summarizeDirectories(snapshot.files, 2, MAX_MODULE_WIKI_PAGES)
    .filter((entry) => entry.name !== '.' && !isLowSignalPath(entry.name))
}

function directoryKey(filePath: string, depth: number): string {
  if (!filePath.includes('/')) {
    return '.'
  }

  const parts = filePath.split('/').filter(Boolean)

  return parts.slice(0, Math.min(depth, parts.length - 1)).join('/') || '.'
}

export function scoreFileForModule(file: ProjectMemoryFile): number {
  const pathScore = /(^|\/)(index|main|app|layout|route|server|service|controller|provider|config|vite|package)\./i.test(file.path) ? 20 : 0

  return pathScore + file.symbolCount * 3 + file.importCount + Math.min(file.sizeBytes / 2048, 10)
}

export function summarizeModuleImports(snapshot: ProjectMemorySnapshot, moduleName: string) {
  const counts = new Map<string, number>()

  for (const entry of snapshot.imports) {
    if (!entry.path.startsWith(`${moduleName}/`) || isLocalImport(entry.source)) continue
    counts.set(entry.source, (counts.get(entry.source) ?? 0) + 1)
  }

  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name))
}

export function summarizeExternalImports(snapshot: ProjectMemorySnapshot) {
  const counts = new Map<string, number>()

  for (const entry of snapshot.imports) {
    if (isLocalImport(entry.source)) continue
    const name = externalPackageName(entry.source)
    counts.set(name, (counts.get(name) ?? 0) + 1)
  }

  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name))
}

function isLocalImport(source: string): boolean {
  return source.startsWith('.') || source.startsWith('/') || source.startsWith('@/') || source.startsWith('~/')
}

function externalPackageName(source: string): string {
  if (source.startsWith('@')) {
    return source.split('/').slice(0, 2).join('/')
  }

  return source.split('/')[0] || source
}

export function findEntrypoints(files: ProjectMemoryFile[]) {
  return files
    .filter((file) => /(^|\/)(main|index|app|layout|route|server|preload|renderer)\.(tsx?|jsx?|mjs|cjs)$/.test(file.path))
    .sort((left, right) => scoreFileForModule(right) - scoreFileForModule(left) || left.path.localeCompare(right.path))
    .slice(0, 16)
}

export function findConfigFiles(files: ProjectMemoryFile[]) {
  return files
    .filter((file) =>
      /(^|\/)(package|tsconfig|vite|electron-builder|eslint|prettier|tailwind|postcss|wrangler|next|nuxt|astro|svelte|jest|vitest|playwright|docker|compose|cargo|pyproject|requirements|go\.mod|pom|gradle)/i.test(file.path) ||
      /\.(config|rc)\.(js|ts|mjs|cjs|json|yaml|yml)$/i.test(file.path)
    )
    .sort((left, right) => left.path.localeCompare(right.path))
    .slice(0, 24)
}

export function moduleRole(moduleName: string): string {
  const normalized = moduleName.toLowerCase()

  if (/(^|\/)(app|pages|routes|screens)(\/|$)/.test(normalized)) return 'application routes and user-facing screens'
  if (/(^|\/)(components|ui|widgets)(\/|$)/.test(normalized)) return 'reusable UI components and view primitives'
  if (/(^|\/)(hooks|stores|state)(\/|$)/.test(normalized)) return 'frontend state, hooks, and view orchestration'
  if (/(^|\/)(services|service|lib|core|domain)(\/|$)/.test(normalized)) return 'domain services, shared logic, and integration helpers'
  if (/(^|\/)(electron|main|preload)(\/|$)/.test(normalized)) return 'desktop runtime, IPC, filesystem, and native shell integration'
  if (/(^|\/)(api|server|backend|worker|workers|functions)(\/|$)/.test(normalized)) return 'server/API runtime and external service boundary'
  if (/(^|\/)(providers|integrations|adapters)(\/|$)/.test(normalized)) return 'provider adapters and external integrations'
  if (/(^|\/)(styles|css|theme|themes)(\/|$)/.test(normalized)) return 'visual system, themes, and presentation styling'
  if (/(^|\/)(test|tests|spec|__tests__)(\/|$)/.test(normalized)) return 'test coverage and verification fixtures'
  if (/(^|\/)(docs|doc|wiki|md)(\/|$)/.test(normalized)) return 'project documentation and local knowledge base'
  if (/(^|\/)(scripts|tools|bin)(\/|$)/.test(normalized)) return 'developer automation and maintenance scripts'
  if (/(^|\/)(config|configs|\.github)(\/|$)/.test(normalized)) return 'configuration, CI, and repository metadata'

  return 'project module; inspect key files and symbols before editing'
}

export function folderPurpose(folderName: string): string {
  return isLowSignalPath(folderName)
    ? 'low-signal generated, dependency, cache, build, or repository metadata path'
    : moduleRole(folderName)
}

export function isLowSignalPath(folderName: string): boolean {
  const normalized = folderName.toLowerCase()

  return /(^|\/)(node_modules|dist|build|coverage|out|tmp|temp|cache|\.cache|\.git|\.next|\.turbo|\.vite|vendor)(\/|$)/.test(normalized)
}

export function summarizeLanguages(files: ProjectMemoryFile[]) {
  const languages = new Map<string, { name: string; files: number }>()

  for (const file of files) {
    const language = file.language ?? file.extension ?? 'unknown'
    const entry = languages.get(language) ?? { name: language, files: 0 }
    entry.files += 1
    languages.set(language, entry)
  }

  return [...languages.values()]
    .sort((left, right) => right.files - left.files || left.name.localeCompare(right.name))
    .slice(0, MAX_LIST_ITEMS)
}

export function compareSymbolsForImportance(left: ProjectMemorySymbol, right: ProjectMemorySymbol): number {
  const kindScore = scoreSymbolKind(right.kind) - scoreSymbolKind(left.kind)

  if (kindScore !== 0) {
    return kindScore
  }

  if (left.exported !== right.exported) {
    return left.exported ? -1 : 1
  }

  return left.path.localeCompare(right.path) || left.line - right.line
}

function scoreSymbolKind(kind: ProjectMemorySymbol['kind']): number {
  if (kind === 'class' || kind === 'component') return 4
  if (kind === 'interface' || kind === 'type') return 3
  if (kind === 'function') return 2
  return 1
}
