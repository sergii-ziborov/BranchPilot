import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type {
  CommitSummary,
  ProjectMemoryFile,
  ProjectMemoryImport,
  ProjectMemoryRepository,
  ProjectMemoryScanResult,
  ProjectMemorySnapshot,
  ProjectMemoryStackHint,
  ProjectMemorySymbol,
  RemoteSummary
} from '../../src/shared/branchPilot.js'
import { CommandRunner } from './commandRunner.js'
import { GIT_EXECUTABLE, normalizeNativePath } from './platformExecutables.js'

const MEMORY_VERSION = 1
const MAX_INDEXED_FILE_BYTES = 500_000
const RECENT_COMMIT_LIMIT = 50
const IGNORED_DIRECTORIES = new Set([
  '.git',
  '.hg',
  '.svn',
  '.cache',
  '.next',
  '.nuxt',
  '.turbo',
  '.vite',
  'coverage',
  'dist',
  'dist-electron',
  'build',
  'node_modules',
  'out',
  'target'
])
const SYMBOL_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx'])
const LANGUAGE_BY_EXTENSION = new Map([
  ['.js', 'JavaScript'],
  ['.jsx', 'React JSX'],
  ['.ts', 'TypeScript'],
  ['.tsx', 'React TSX'],
  ['.json', 'JSON'],
  ['.css', 'CSS'],
  ['.html', 'HTML'],
  ['.md', 'Markdown']
])
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

interface ScanState {
  files: ProjectMemoryFile[]
  symbols: ProjectMemorySymbol[]
  imports: ProjectMemoryImport[]
  scannedFileCount: number
  skippedFileCount: number
}

interface PackageMetadata {
  dependencies: Record<string, string>
  devDependencies: Record<string, string>
}

interface SymbolScanResult {
  symbols: ProjectMemorySymbol[]
  imports: ProjectMemoryImport[]
}

export class ProjectMemoryService {
  constructor(
    private readonly runner: CommandRunner,
    private readonly storage: ProjectMemoryStore
  ) {}

  async getProjectMemory(repoPath: string): Promise<ProjectMemorySnapshot | null> {
    const rootPath = await this.resolveRepositoryRoot(repoPath)
    return this.storage.read(rootPath)
  }

  async scanProjectMemory(repoPath: string): Promise<ProjectMemoryScanResult> {
    const startedAt = Date.now()
    const rootPath = await this.resolveRepositoryRoot(repoPath)
    const repository = await this.getRepository(rootPath)
    const scanState = await scanProject(rootPath)
    const recentCommits = await this.getRecentCommits(rootPath)

    const snapshot: ProjectMemorySnapshot = {
      version: MEMORY_VERSION,
      scannedAt: new Date().toISOString(),
      repository,
      files: scanState.files,
      symbols: scanState.symbols,
      imports: scanState.imports,
      stackHints: await getStackHints(rootPath),
      recentCommits
    }

    await this.storage.write(snapshot)

    return {
      snapshot,
      durationMs: Date.now() - startedAt,
      scannedFileCount: scanState.scannedFileCount,
      skippedFileCount: scanState.skippedFileCount
    }
  }

  private async resolveRepositoryRoot(repoPath: string): Promise<string> {
    const result = await this.git(repoPath, ['rev-parse', '--show-toplevel'])
    return normalizeNativePath(result.stdout.trim())
  }

  private async getRepository(rootPath: string): Promise<ProjectMemoryRepository> {
    const branch = await this.git(rootPath, ['branch', '--show-current'], { allowedExitCodes: [0, 1] })
    const remote = await this.getPrimaryRemote(rootPath)

    return {
      id: repositoryId(rootPath),
      rootPath,
      name: path.basename(rootPath),
      currentBranch: branch.stdout.trim() || 'Detached HEAD',
      remoteName: remote?.name,
      remoteUrl: remote?.fetchUrl ?? remote?.pushUrl
    }
  }

  private async getPrimaryRemote(rootPath: string): Promise<RemoteSummary | undefined> {
    return (await this.listRemotes(rootPath)).find((remote) => remote.fetchUrl || remote.pushUrl)
  }

  private async listRemotes(rootPath: string): Promise<RemoteSummary[]> {
    const result = await this.git(rootPath, ['remote', '-v'], { allowedExitCodes: [0, 1] })
    const remotes = new Map<string, RemoteSummary>()

    for (const line of result.stdout.split('\n').map((entry) => entry.trim()).filter(Boolean)) {
      const match = line.match(/^(\S+)\s+(\S+)\s+\((fetch|push)\)$/)

      if (!match) {
        continue
      }

      const [, name, url, direction] = match
      const remote = remotes.get(name) ?? { name }

      if (direction === 'fetch') {
        remote.fetchUrl = url
      } else {
        remote.pushUrl = url
      }

      remotes.set(name, remote)
    }

    return [...remotes.values()]
  }

  private async getRecentCommits(rootPath: string): Promise<CommitSummary[]> {
    const result = await this.git(rootPath, [
      'log',
      `--max-count=${RECENT_COMMIT_LIMIT}`,
      '--date=iso-strict',
      '--pretty=format:%H%x00%h%x00%s%x00%P%x00%an%x00%ae%x00%ad'
    ], {
      allowedExitCodes: [0, 128]
    })

    if (result.exitCode !== 0 || !result.stdout.trim()) {
      return []
    }

    return result.stdout
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [sha, shortSha, subject, parentShasText, authorName, authorEmail, authoredAt] = line.split('\0')

        return {
          sha,
          shortSha,
          subject,
          parentShas: parentShasText ? parentShasText.split(' ').filter(Boolean) : [],
          authorName,
          authorEmail,
          authoredAt
        }
      })
  }

  private async git(
    cwd: string,
    args: string[],
    options: { allowedExitCodes?: number[] } = {}
  ) {
    return this.runner.run(GIT_EXECUTABLE, args, {
      cwd,
      allowedExitCodes: options.allowedExitCodes
    })
  }
}

export class ProjectMemoryStore {
  constructor(private readonly directoryPath: string) {}

  async read(rootPath: string): Promise<ProjectMemorySnapshot | null> {
    try {
      const raw = await fs.readFile(this.filePath(rootPath), 'utf8')
      const parsed = JSON.parse(raw) as ProjectMemorySnapshot

      return parsed.version === MEMORY_VERSION && parsed.repository?.rootPath ? parsed : null
    } catch {
      return null
    }
  }

  async write(snapshot: ProjectMemorySnapshot): Promise<void> {
    await fs.mkdir(this.directoryPath, { recursive: true })
    await fs.writeFile(this.filePath(snapshot.repository.rootPath), JSON.stringify(snapshot, null, 2), 'utf8')
  }

  private filePath(rootPath: string): string {
    return path.join(this.directoryPath, `${repositoryId(rootPath)}.json`)
  }
}

async function scanProject(rootPath: string): Promise<ScanState> {
  const state: ScanState = {
    files: [],
    symbols: [],
    imports: [],
    scannedFileCount: 0,
    skippedFileCount: 0
  }

  await scanDirectory(rootPath, '', state)

  state.files.sort((left, right) => left.path.localeCompare(right.path))
  state.symbols.sort(compareByPathAndLine)
  state.imports.sort(compareByPathAndLine)

  return state
}

async function scanDirectory(rootPath: string, relativeDirectory: string, state: ScanState): Promise<void> {
  const absoluteDirectory = path.join(rootPath, relativeDirectory)
  const entries = await fs.readdir(absoluteDirectory, { withFileTypes: true })

  const fileRelativePaths: string[] = []
  const subdirectories: string[] = []

  for (const entry of entries) {
    const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name

    if (entry.isDirectory()) {
      if (!IGNORED_DIRECTORIES.has(entry.name)) {
        subdirectories.push(relativePath)
      }

      continue
    }

    if (!entry.isFile()) {
      state.skippedFileCount += 1
      continue
    }

    fileRelativePaths.push(relativePath)
  }

  // Files in a directory are independent stat+read operations: scan them in
  // parallel. Recurse into subdirectories sequentially so the number of
  // concurrently open file handles stays bounded by one directory's width.
  await Promise.all(fileRelativePaths.map((relativePath) => scanFile(rootPath, relativePath, state)))

  for (const subdirectory of subdirectories) {
    await scanDirectory(rootPath, subdirectory, state)
  }
}

async function scanFile(rootPath: string, relativePath: string, state: ScanState): Promise<void> {
  const absolutePath = path.join(rootPath, relativePath)
  const stat = await fs.stat(absolutePath)

  if (stat.size > MAX_INDEXED_FILE_BYTES) {
    state.skippedFileCount += 1
    return
  }

  const buffer = await fs.readFile(absolutePath)

  if (buffer.includes(0)) {
    state.skippedFileCount += 1
    return
  }

  state.scannedFileCount += 1

  const extension = path.extname(relativePath)
  const text = buffer.toString('utf8')
  const symbolScan = SYMBOL_EXTENSIONS.has(extension)
    ? scanSymbols(relativePath, extension, text)
    : { symbols: [], imports: [] }

  state.symbols.push(...symbolScan.symbols)
  state.imports.push(...symbolScan.imports)
  state.files.push({
    path: relativePath,
    extension,
    sizeBytes: stat.size,
    language: LANGUAGE_BY_EXTENSION.get(extension),
    symbolCount: symbolScan.symbols.length,
    importCount: symbolScan.imports.length
  })
}

function scanSymbols(filePath: string, extension: string, text: string): SymbolScanResult {
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

async function getStackHints(rootPath: string): Promise<ProjectMemoryStackHint[]> {
  const hints = new Map<string, ProjectMemoryStackHint>()
  const packageMetadata = await readPackageMetadata(rootPath)

  if (packageMetadata) {
    addHint(hints, 'node', 'Node.js', 'package.json')
  }

  if (await pathExists(path.join(rootPath, 'tsconfig.json')) || hasPackage(packageMetadata, 'typescript')) {
    addHint(hints, 'typescript', 'TypeScript', 'tsconfig.json / package.json')
  }

  if (hasPackage(packageMetadata, 'react')) {
    addHint(hints, 'react', 'React', 'package.json')
  }

  if (hasPackage(packageMetadata, 'electron') || await pathExists(path.join(rootPath, 'electron'))) {
    addHint(hints, 'electron', 'Electron', 'package.json / electron directory')
  }

  if (hasPackage(packageMetadata, 'vite') || await pathExists(path.join(rootPath, 'vite.config.ts'))) {
    addHint(hints, 'vite', 'Vite', 'package.json / vite config')
  }

  if (hasPackage(packageMetadata, 'vitest')) {
    addHint(hints, 'vitest', 'Vitest', 'package.json')
  }

  return [...hints.values()]
}

async function readPackageMetadata(rootPath: string): Promise<PackageMetadata | null> {
  try {
    const raw = await fs.readFile(path.join(rootPath, 'package.json'), 'utf8')
    const parsed = JSON.parse(raw) as Partial<PackageMetadata>

    return {
      dependencies: parsed.dependencies ?? {},
      devDependencies: parsed.devDependencies ?? {}
    }
  } catch {
    return null
  }
}

function hasPackage(metadata: PackageMetadata | null, packageName: string): boolean {
  return Boolean(metadata?.dependencies[packageName] || metadata?.devDependencies[packageName])
}

function addHint(hints: Map<string, ProjectMemoryStackHint>, id: string, label: string, source: string): void {
  hints.set(id, { id, label, source })
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

function repositoryId(rootPath: string): string {
  return createHash('sha256').update(rootPath).digest('hex').slice(0, 16)
}

function compareByPathAndLine(
  left: { path: string; line: number },
  right: { path: string; line: number }
): number {
  return left.path.localeCompare(right.path) || left.line - right.line
}
