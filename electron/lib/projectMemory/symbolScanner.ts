import type {
  ProjectMemoryImport,
  ProjectMemorySymbol
} from '../../../src/shared/branchPilot.js'

const METHOD_KEYWORDS = new Set([
  'catch',
  'constructor',
  'describe',
  'for',
  'if',
  'it',
  'return',
  'switch',
  'while'
])

export interface SymbolScanResult {
  symbols: ProjectMemorySymbol[]
  imports: ProjectMemoryImport[]
}

export function scanSymbols(filePath: string, extension: string, text: string): SymbolScanResult {
  const symbols: ProjectMemorySymbol[] = []
  const imports: ProjectMemoryImport[] = []
  const lines = text.split('\n')
  let currentClass: { name: string; depth: number } | null = null
  let braceDepth = 0

  lines.forEach((line, index) => {
    const lineNumber = index + 1
    const trimmed = line.trim()

    for (const entry of scanImports(filePath, trimmed, lineNumber)) {
      imports.push(entry)
    }

    const exported = /^export\s+/.test(trimmed)
    const classMatch = trimmed.match(/^(?:export\s+)?(?:default\s+)?class\s+([A-Za-z_$][\w$]*)/)

    if (classMatch) {
      const name = classMatch[1]
      symbols.push(makeSymbol(filePath, lineNumber, name, 'class', exported))
      currentClass = { name, depth: braceDepth + countBraceDelta(line) }
    }

    const interfaceMatch = trimmed.match(/^(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/)

    if (interfaceMatch) {
      symbols.push(makeSymbol(filePath, lineNumber, interfaceMatch[1], 'interface', exported))
    }

    const typeMatch = trimmed.match(/^(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\s*=/)

    if (typeMatch) {
      symbols.push(makeSymbol(filePath, lineNumber, typeMatch[1], 'type', exported))
    }

    const functionMatch = trimmed.match(/^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/)

    if (functionMatch) {
      const name = functionMatch[1]
      symbols.push(makeSymbol(filePath, lineNumber, name, symbolKindForFunction(name, extension), exported))
    }

    const constantMatch = trimmed.match(/^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/)

    if (constantMatch) {
      const name = constantMatch[1]
      symbols.push(makeSymbol(filePath, lineNumber, name, symbolKindForConstant(name, extension, trimmed), exported))
    }

    const namedExportMatch = trimmed.match(/^export\s+\{([^}]+)\}/)

    if (namedExportMatch) {
      for (const name of namedExportMatch[1].split(',').map((entry) => entry.trim().split(/\s+as\s+/)[0].trim())) {
        if (name) {
          symbols.push(makeSymbol(filePath, lineNumber, name, 'export', true))
        }
      }
    }

    if (currentClass && !classMatch) {
      const methodMatch = trimmed.match(/^(?:(?:public|private|protected|static|async|get|set)\s+)*([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*(?::[^{]+)?\{?/)

      if (methodMatch && !METHOD_KEYWORDS.has(methodMatch[1])) {
        symbols.push(makeSymbol(filePath, lineNumber, methodMatch[1], 'method', false, currentClass.name))
      }
    }

    braceDepth += countBraceDelta(line)

    if (currentClass && braceDepth <= 0) {
      currentClass = null
    }
  })

  return { symbols: dedupeSymbols(symbols), imports }
}

function scanImports(filePath: string, trimmedLine: string, line: number): ProjectMemoryImport[] {
  const imports: ProjectMemoryImport[] = []
  const importFromMatch = trimmedLine.match(/^import\s+(.+?)\s+from\s+['"]([^'"]+)['"]/)
  const sideEffectImportMatch = trimmedLine.match(/^import\s+['"]([^'"]+)['"]/)
  const exportFromMatch = trimmedLine.match(/^export\s+.+?\s+from\s+['"]([^'"]+)['"]/)
  const requireMatch = trimmedLine.match(/(?:const|let|var)\s+(.+?)\s*=\s*require\(['"]([^'"]+)['"]\)/)

  if (importFromMatch) {
    imports.push({
      path: filePath,
      source: importFromMatch[2],
      specifiers: parseImportSpecifiers(importFromMatch[1]),
      line
    })
  } else if (sideEffectImportMatch) {
    imports.push({
      path: filePath,
      source: sideEffectImportMatch[1],
      specifiers: [],
      line
    })
  }

  if (exportFromMatch) {
    imports.push({
      path: filePath,
      source: exportFromMatch[1],
      specifiers: ['export'],
      line
    })
  }

  if (requireMatch) {
    imports.push({
      path: filePath,
      source: requireMatch[2],
      specifiers: parseImportSpecifiers(requireMatch[1]),
      line
    })
  }

  return imports
}

function parseImportSpecifiers(rawSpecifiers: string): string[] {
  return rawSpecifiers
    .replace(/[{}*]/g, '')
    .split(',')
    .map((specifier) => specifier.trim().split(/\s+as\s+/)[0].trim())
    .filter(Boolean)
}

function symbolKindForFunction(name: string, extension: string): ProjectMemorySymbol['kind'] {
  return isComponentName(name) && (extension === '.tsx' || extension === '.jsx') ? 'component' : 'function'
}

function symbolKindForConstant(name: string, extension: string, line: string): ProjectMemorySymbol['kind'] {
  const isArrowFunction = /=>/.test(line)

  if (isArrowFunction && isComponentName(name) && (extension === '.tsx' || extension === '.jsx')) {
    return 'component'
  }

  return isArrowFunction ? 'function' : 'constant'
}

function isComponentName(name: string): boolean {
  return /^[A-Z]/.test(name)
}

function makeSymbol(
  filePath: string,
  line: number,
  name: string,
  kind: ProjectMemorySymbol['kind'],
  exported: boolean,
  parentName?: string
): ProjectMemorySymbol {
  return {
    id: `${filePath}:${line}:${kind}:${parentName ? `${parentName}.` : ''}${name}`,
    name,
    kind,
    path: filePath,
    line,
    exported,
    parentName
  }
}

function dedupeSymbols(symbols: ProjectMemorySymbol[]): ProjectMemorySymbol[] {
  const seen = new Set<string>()

  return symbols.filter((symbol) => {
    if (seen.has(symbol.id)) {
      return false
    }

    seen.add(symbol.id)
    return true
  })
}

function countBraceDelta(line: string): number {
  let delta = 0

  for (const character of line) {
    if (character === '{') {
      delta += 1
    } else if (character === '}') {
      delta -= 1
    }
  }

  return delta
}
