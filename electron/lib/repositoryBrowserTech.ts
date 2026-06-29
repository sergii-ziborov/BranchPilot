import fs from 'node:fs/promises'
import path from 'node:path'
import type { RepositoryBrowserTechSummary } from '../../src/shared/branchPilot.js'

const MAX_SCAN_DEPTH = 3
const MAX_SCAN_FILES = 360
const MAX_SCAN_DIRS = 90
const LANGUAGE_BADGE_LIMIT = 2

const IGNORED_DIRECTORIES = new Set([
  '.git',
  '.hg',
  '.svn',
  '.cache',
  '.next',
  '.nuxt',
  '.output',
  '.parcel-cache',
  '.turbo',
  '.vercel',
  '.vite',
  'bin',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'out',
  'target',
  'vendor'
])

const IGNORED_FILES = new Set([
  'bun.lock',
  'composer.lock',
  'package-lock.json',
  'pnpm-lock.yaml',
  'poetry.lock',
  'yarn.lock'
])

const LANGUAGE_BY_EXTENSION = new Map<string, string>([
  ['.c', 'C'],
  ['.cc', 'C++'],
  ['.cpp', 'C++'],
  ['.cs', 'C#'],
  ['.css', 'CSS'],
  ['.dart', 'Dart'],
  ['.ex', 'Elixir'],
  ['.exs', 'Elixir'],
  ['.go', 'Go'],
  ['.h', 'C/C++'],
  ['.hpp', 'C++'],
  ['.html', 'HTML'],
  ['.java', 'Java'],
  ['.js', 'JavaScript'],
  ['.jsx', 'JavaScript'],
  ['.kt', 'Kotlin'],
  ['.less', 'CSS'],
  ['.lua', 'Lua'],
  ['.mjs', 'JavaScript'],
  ['.php', 'PHP'],
  ['.ps1', 'PowerShell'],
  ['.py', 'Python'],
  ['.rb', 'Ruby'],
  ['.rs', 'Rust'],
  ['.sass', 'CSS'],
  ['.scala', 'Scala'],
  ['.scss', 'CSS'],
  ['.sh', 'Shell'],
  ['.sql', 'SQL'],
  ['.svelte', 'Svelte'],
  ['.swift', 'Swift'],
  ['.ts', 'TypeScript'],
  ['.tsx', 'TypeScript'],
  ['.vue', 'Vue']
])

const FRAMEWORK_BY_PACKAGE = [
  ['next', 'Next.js'],
  ['@remix-run/react', 'Remix'],
  ['@angular/core', 'Angular'],
  ['@sveltejs/kit', 'SvelteKit'],
  ['svelte', 'Svelte'],
  ['astro', 'Astro'],
  ['vue', 'Vue'],
  ['nuxt', 'Nuxt'],
  ['react', 'React'],
  ['electron', 'Electron'],
  ['tauri', 'Tauri'],
  ['three', 'Three.js'],
  ['@nestjs/core', 'NestJS'],
  ['fastify', 'Fastify'],
  ['express', 'Express']
] as const

const FRAMEWORK_BY_PYTHON_PACKAGE = [
  ['django', 'Django'],
  ['fastapi', 'FastAPI'],
  ['flask', 'Flask'],
  ['streamlit', 'Streamlit']
] as const

const FRAMEWORK_BY_MARKER = new Map<string, string>([
  ['angular.json', 'Angular'],
  ['astro.config.js', 'Astro'],
  ['astro.config.mjs', 'Astro'],
  ['astro.config.ts', 'Astro'],
  ['next.config.js', 'Next.js'],
  ['next.config.mjs', 'Next.js'],
  ['next.config.ts', 'Next.js'],
  ['nuxt.config.js', 'Nuxt'],
  ['nuxt.config.ts', 'Nuxt'],
  ['svelte.config.js', 'SvelteKit'],
  ['svelte.config.ts', 'SvelteKit'],
  ['tauri.conf.json', 'Tauri'],
  ['vite.config.js', 'Vite'],
  ['vite.config.mjs', 'Vite'],
  ['vite.config.ts', 'Vite'],
  ['vue.config.js', 'Vue']
])

interface ScanState {
  directories: number
  files: number
  languageCounts: Map<string, number>
  framework?: string
}

export async function detectRepositoryBrowserTech(directoryPath: string): Promise<RepositoryBrowserTechSummary | undefined> {
  const state: ScanState = {
    directories: 0,
    files: 0,
    languageCounts: new Map<string, number>()
  }

  await scanDirectory(directoryPath, 0, state)

  const languageEntries = [...state.languageCounts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))

  if (languageEntries.length === 0 && !state.framework) {
    return undefined
  }

  return {
    languages: languageEntries.slice(0, LANGUAGE_BADGE_LIMIT).map(([language]) => language),
    extraLanguageCount: Math.max(0, languageEntries.length - LANGUAGE_BADGE_LIMIT),
    framework: state.framework
  }
}

async function scanDirectory(directoryPath: string, depth: number, state: ScanState): Promise<void> {
  if (depth > MAX_SCAN_DEPTH || state.files >= MAX_SCAN_FILES || state.directories >= MAX_SCAN_DIRS) return
  state.directories += 1

  const entries = await fs.readdir(directoryPath, { withFileTypes: true }).catch(() => [])

  await detectFrameworkMarkers(directoryPath, entries, state)

  for (const entry of entries) {
    if (state.files >= MAX_SCAN_FILES || state.directories >= MAX_SCAN_DIRS) return

    if (entry.isDirectory()) {
      if (IGNORED_DIRECTORIES.has(entry.name) || entry.name.startsWith('.')) continue
      await scanDirectory(path.join(directoryPath, entry.name), depth + 1, state)
      continue
    }

    if (!entry.isFile() || IGNORED_FILES.has(entry.name)) continue
    state.files += 1
    recordLanguage(entry.name, state)
  }
}

async function detectFrameworkMarkers(directoryPath: string, entries: import('node:fs').Dirent[], state: ScanState): Promise<void> {
  const names = new Set(entries.map((entry) => entry.name))

  if (names.has('package.json')) {
    state.framework = await detectPackageJsonFramework(path.join(directoryPath, 'package.json'))
  }

  if (!state.framework) {
    for (const entry of entries) {
      const marker = FRAMEWORK_BY_MARKER.get(entry.name)
      if (marker) {
        state.framework = marker
        break
      }
    }
  }

  if (state.framework) return

  if (!state.framework && names.has('requirements.txt')) {
    state.framework = await detectTextDependencyFramework(path.join(directoryPath, 'requirements.txt'), FRAMEWORK_BY_PYTHON_PACKAGE)
  }
  if (!state.framework && names.has('pyproject.toml')) {
    state.framework = await detectTextDependencyFramework(path.join(directoryPath, 'pyproject.toml'), FRAMEWORK_BY_PYTHON_PACKAGE)
  }
  if (!state.framework && names.has('pubspec.yaml')) {
    state.framework = 'Flutter'
  }
  if (!state.framework && names.has('Cargo.toml')) {
    state.framework = 'Cargo'
  }
  if (!state.framework && names.has('go.mod')) {
    state.framework = 'Go module'
  }
}

async function detectPackageJsonFramework(packageJsonPath: string): Promise<string | undefined> {
  const raw = await fs.readFile(packageJsonPath, 'utf8').catch(() => '')
  if (!raw) return undefined

  try {
    const parsed = JSON.parse(raw) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
      peerDependencies?: Record<string, string>
    }
    const dependencies = {
      ...parsed.dependencies,
      ...parsed.devDependencies,
      ...parsed.peerDependencies
    }

    return FRAMEWORK_BY_PACKAGE.find(([name]) => dependencies[name])?.[1]
  } catch {
    return undefined
  }
}

async function detectTextDependencyFramework(
  filePath: string,
  candidates: readonly (readonly [string, string])[]
): Promise<string | undefined> {
  const raw = await fs.readFile(filePath, 'utf8').catch(() => '')
  const lowered = raw.toLowerCase()

  return candidates.find(([name]) => lowered.includes(name))?.[1]
}

function recordLanguage(fileName: string, state: ScanState): void {
  const language = languageForFileName(fileName)
  if (!language) return
  state.languageCounts.set(language, (state.languageCounts.get(language) ?? 0) + 1)
}

function languageForFileName(fileName: string): string | undefined {
  if (fileName.endsWith('.d.ts')) return undefined
  if (fileName === 'Dockerfile') return 'Docker'
  if (fileName === 'Makefile') return 'Makefile'

  const extension = path.extname(fileName).toLowerCase()
  return LANGUAGE_BY_EXTENSION.get(extension)
}
