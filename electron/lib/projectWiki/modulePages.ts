import type { ProjectMemorySnapshot, ProjectWikiPageId } from '../../../src/shared/branchPilot.js'
import {
  compareSymbolsForImportance,
  findConfigFiles,
  moduleRole,
  scoreFileForModule,
  summarizeLanguages,
  summarizeModuleImports
} from './memoryInsights.js'
import { formatBytes, listOrEmpty, sanitizeWikiFileName, symbolLabel } from './wikiText.js'

export function moduleDetailLines(
  snapshot: ProjectMemorySnapshot,
  module: { name: string; files: number; symbols: number; imports: number; sizeBytes: number },
  includePageLink = false
): string[] {
  const files = snapshot.files
    .filter((file) => file.path === module.name || file.path.startsWith(`${module.name}/`))
    .sort((left, right) => scoreFileForModule(right) - scoreFileForModule(left) || left.path.localeCompare(right.path))
  const symbols = snapshot.symbols
    .filter((symbol) => symbol.path.startsWith(`${module.name}/`))
    .sort(compareSymbolsForImportance)
    .slice(0, 6)
  const imports = summarizeModuleImports(snapshot, module.name).slice(0, 6)
  const languages = summarizeLanguages(files).slice(0, 4)
  const keyFiles = files.slice(0, 6)

  return [
    `### ${includePageLink ? `[${module.name}](${modulePageFileName(module.name)})` : module.name}`,
    `- Role: ${moduleRole(module.name)}`,
    `- Scale: ${module.files} files, ${module.symbols} symbols, ${module.imports} imports, ${formatBytes(module.sizeBytes)} indexed.`,
    `- Languages: ${languages.length > 0 ? languages.map((entry) => `${entry.name} (${entry.files})`).join(', ') : 'unknown'}.`,
    `- Key files: ${keyFiles.length > 0 ? keyFiles.map((file) => file.path).join(', ') : 'none indexed'}.`,
    `- Key symbols: ${symbols.length > 0 ? symbols.map(symbolLabel).join(', ') : 'none detected'}.`,
    `- External imports: ${imports.length > 0 ? imports.map((entry) => `${entry.name} (${entry.count})`).join(', ') : 'none detected'}.`,
    ''
  ]
}

export function modulePageMarkdown(
  snapshot: ProjectMemorySnapshot,
  module: { name: string; files: number; symbols: number; imports: number; sizeBytes: number }
): string {
  const files = snapshot.files
    .filter((file) => file.path === module.name || file.path.startsWith(`${module.name}/`))
    .sort((left, right) => scoreFileForModule(right) - scoreFileForModule(left) || left.path.localeCompare(right.path))
  const symbols = snapshot.symbols
    .filter((symbol) => symbol.path.startsWith(`${module.name}/`))
    .sort(compareSymbolsForImportance)
  const imports = summarizeModuleImports(snapshot, module.name)
  const languages = summarizeLanguages(files)
  const entrypoints = files
    .filter((file) => /(^|\/)(main|index|app|layout|route|server|preload|renderer|service|controller|provider)\.(tsx?|jsx?|mjs|cjs)$/i.test(file.path))
    .slice(0, 16)
  const configFiles = findConfigFiles(files)
  const largestFiles = [...files]
    .sort((left, right) => right.sizeBytes - left.sizeBytes)
    .slice(0, 12)

  return [
    `# ${modulePageTitle(module.name)}`,
    '',
    `Module path: ${module.name}`,
    `Role: ${moduleRole(module.name)}`,
    `Scale: ${module.files} files, ${module.symbols} symbols, ${module.imports} imports, ${formatBytes(module.sizeBytes)} indexed.`,
    '',
    '## Languages',
    ...listOrEmpty(languages.slice(0, 10).map((entry) => `${entry.name}: ${entry.files} files`)),
    '',
    '## Key Files',
    ...listOrEmpty(files.slice(0, 18).map((file) =>
      `${file.path}: ${file.language ?? file.extension}, ${file.symbolCount} symbols, ${file.importCount} imports, ${formatBytes(file.sizeBytes)}`
    )),
    '',
    '## Entrypoints And Config',
    ...listOrEmpty([
      ...entrypoints.map((file) => `${file.path}: entrypoint or orchestration file`),
      ...configFiles.map((file) => `${file.path}: configuration surface`)
    ]),
    '',
    '## Important Symbols',
    ...listOrEmpty(symbols.slice(0, 24).map((symbol) =>
      `${symbolLabel(symbol)} - ${symbol.kind}, ${symbol.path}:${symbol.line}${symbol.exported ? ', exported' : ''}`
    )),
    '',
    '## External Imports',
    ...listOrEmpty(imports.slice(0, 16).map((entry) => `${entry.name}: ${entry.count} imports`)),
    '',
    '## Largest Files',
    ...listOrEmpty(largestFiles.map((file) => `${file.path}: ${formatBytes(file.sizeBytes)}`))
  ].join('\n')
}

export function modulePageId(moduleName: string): ProjectWikiPageId {
  return `module_${moduleName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'root'}`
}

export function modulePageTitle(moduleName: string): string {
  return `Module: ${moduleName}`
}

function modulePageFileName(moduleName: string): string {
  return `${sanitizeWikiFileName(modulePageTitle(moduleName))}.md`
}
