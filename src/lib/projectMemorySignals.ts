import type { ProjectMemoryFile, ProjectMemoryImport, ProjectMemorySnapshot } from '../shared/branchPilot'

export interface MemorySignalCount {
  label: string
  count: number
}

export function memoryFileSignalScore(file: ProjectMemoryFile): number {
  const path = file.path.toLowerCase()
  const name = path.split('/').pop() ?? path
  let score = file.symbolCount * 5 + file.importCount * 3

  if (/\.(tsx|ts|jsx|js|vue|svelte|mjs|cjs)$/.test(name)) score += 12
  if (/(\b|\/)(src|app|apps|packages|server|electron|api|components|features|services|hooks|lib)(\/|$)/.test(path)) score += 10
  if (/(main|index|app|router|routes|layout|page|view|controller|service|store|context|provider|model|schema|config)/.test(name)) score += 8
  if (file.symbolCount > 0) score += 8
  if (file.importCount > 0) score += 4

  if (/(\.d\.ts|\.map|package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$/.test(name)) score -= 60
  if (/(^|\/)(node_modules|dist|build|coverage|out|vendor|\.git|\.claude|\.codex)(\/|$)/.test(path)) score -= 80
  if (/(\.gitignore|\.env|\.lock|\.log)$/.test(name)) score -= 40

  return score
}

export function sortedMemoryFiles(files: ProjectMemoryFile[]): ProjectMemoryFile[] {
  return [...files].sort((left, right) => {
    const signalDelta = memoryFileSignalScore(right) - memoryFileSignalScore(left)
    if (signalDelta !== 0) return signalDelta

    const symbolDelta = right.symbolCount - left.symbolCount
    if (symbolDelta !== 0) return symbolDelta

    const importDelta = right.importCount - left.importCount
    if (importDelta !== 0) return importDelta

    return left.path.localeCompare(right.path)
  })
}

export function preferredMemoryFilePath(memory: ProjectMemorySnapshot): string | null {
  return sortedMemoryFiles(memory.files)[0]?.path ?? null
}

export function summarizeMemoryFolders(files: ProjectMemoryFile[], limit = 6): MemorySignalCount[] {
  return summarizeCounts(files.map((file) => memoryFolderKey(file.path)), limit)
}

export function summarizeMemoryLanguages(files: ProjectMemoryFile[], limit = 6): MemorySignalCount[] {
  return summarizeCounts(files.map((file) => file.language ?? (file.extension || 'file')), limit)
}

export function summarizeExternalMemoryImports(imports: ProjectMemoryImport[], limit = 6): MemorySignalCount[] {
  return summarizeCounts(imports.map((entry) => externalPackageName(entry.source)).filter(Boolean), limit)
}

function summarizeCounts(values: string[], limit: number): MemorySignalCount[] {
  const counts = new Map<string, number>()
  for (const value of values) {
    const label = value.trim()
    if (!label) continue
    counts.set(label, (counts.get(label) ?? 0) + 1)
  }

  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([label, count]) => ({ label, count }))
}

function memoryFolderKey(path: string): string {
  const parts = path.split('/').filter(Boolean)
  if (parts.length === 0) return '.'

  if (parts.length > 1 && ['apps', 'packages', 'services', 'libs', 'modules'].includes(parts[0])) {
    return `${parts[0]}/${parts[1]}`
  }

  return parts[0]
}

function externalPackageName(source: string): string {
  if (!source || source.startsWith('.') || source.startsWith('/') || source.startsWith('@/')) return ''
  const parts = source.split('/').filter(Boolean)
  if (parts.length === 0) return ''
  return source.startsWith('@') && parts.length > 1 ? `${parts[0]}/${parts[1]}` : parts[0]
}
