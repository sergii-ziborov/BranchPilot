import { promises as fs } from 'node:fs'
import path from 'node:path'
import type {
  ProjectMemoryFile,
  ProjectMemoryImport,
  ProjectMemorySymbol
} from '../../../src/shared/branchPilot.js'
import { scanSymbols } from './symbolScanner.js'

const MAX_INDEXED_FILE_BYTES = 500_000
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

export interface ScanState {
  files: ProjectMemoryFile[]
  symbols: ProjectMemorySymbol[]
  imports: ProjectMemoryImport[]
  scannedFileCount: number
  skippedFileCount: number
}

export async function scanProject(rootPath: string): Promise<ScanState> {
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
  const stat = await fs.stat(absolutePath).catch(() => null)

  if (!stat) {
    state.skippedFileCount += 1
    return
  }

  if (stat.size > MAX_INDEXED_FILE_BYTES) {
    state.skippedFileCount += 1
    return
  }

  const buffer = await fs.readFile(absolutePath).catch(() => null)

  if (!buffer) {
    state.skippedFileCount += 1
    return
  }

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

function compareByPathAndLine(
  left: { path: string; line: number },
  right: { path: string; line: number }
): number {
  return left.path.localeCompare(right.path) || left.line - right.line
}
