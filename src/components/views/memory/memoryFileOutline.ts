import type { ProjectMemorySnapshot } from '../../../shared/branchPilot'

export interface MemorySymbolGroup {
  id: string
  kind: string
  name: string
  exported: boolean
  lines: number[]
  count: number
}

export function compactMemorySymbols(symbols: ProjectMemorySnapshot['symbols']): MemorySymbolGroup[] {
  const groups = new Map<string, MemorySymbolGroup>()

  for (const symbol of symbols) {
    const name = symbol.parentName ? `${symbol.parentName}.${symbol.name}` : symbol.name
    const key = `${symbol.kind}:${name}:${symbol.exported ? 'exported' : 'local'}`
    const group = groups.get(key) ?? {
      id: key,
      kind: symbol.kind,
      name,
      exported: symbol.exported,
      lines: [],
      count: 0
    }

    group.lines.push(symbol.line)
    group.count += 1
    groups.set(key, group)
  }

  return [...groups.values()]
    .map((group) => ({ ...group, lines: [...new Set(group.lines)].sort((left, right) => left - right) }))
    .sort((left, right) => (left.lines[0] ?? 0) - (right.lines[0] ?? 0) || left.name.localeCompare(right.name))
}

export interface MemoryImportGroup {
  id: string
  source: string
  specifiers: string[]
  lines: number[]
  count: number
  title: string
}

export function compactMemoryImports(imports: ProjectMemorySnapshot['imports']): MemoryImportGroup[] {
  const groups = new Map<string, MemoryImportGroup>()

  for (const entry of imports) {
    const specifiers = [...new Set(entry.specifiers)].sort()
    const key = `${entry.source}:${specifiers.join(',')}`
    const group = groups.get(key) ?? {
      id: key,
      source: entry.source,
      specifiers,
      lines: [],
      count: 0,
      title: ''
    }

    group.lines.push(entry.line)
    group.count += 1
    group.title = `${entry.source}${specifiers.length > 0 ? ` - ${specifiers.join(', ')}` : ''}`
    groups.set(key, group)
  }

  return [...groups.values()]
    .map((group) => ({ ...group, lines: [...new Set(group.lines)].sort((left, right) => left - right) }))
    .sort((left, right) => (left.lines[0] ?? 0) - (right.lines[0] ?? 0) || left.source.localeCompare(right.source))
}

export function formatLines(lines: number[]): string {
  if (lines.length === 0) return 'no lines'
  if (lines.length === 1) return `line ${lines[0]}`

  const preview = lines.slice(0, 4).join(', ')
  return lines.length > 4 ? `lines ${preview} +${lines.length - 4}` : `lines ${preview}`
}
