import { promises as fs } from 'node:fs'
import path from 'node:path'
import { CommandRunner } from '../../lib/commandRunner.js'
import { WHICH_EXECUTABLE } from '../../lib/platformExecutables.js'

export async function resolveExecutablePath(runner: CommandRunner, executable: string): Promise<string | undefined> {
  if (process.platform === 'win32') {
    return resolveWindowsExecutablePath(runner, executable)
  }

  try {
    const result = await runner.run(WHICH_EXECUTABLE, [executable], {
      timeoutMs: 5_000
    })
    return result.stdout.split('\n').map((line) => line.trim()).filter(Boolean)[0] ?? executable
  } catch {
    return undefined
  }
}

async function resolveWindowsExecutablePath(runner: CommandRunner, executable: string): Promise<string | undefined> {
  const candidates = await findWithWhere(runner, executable)
  const normalized = await Promise.all(candidates.map((candidate) => normalizeWindowsExecutableCandidate(candidate, executable)))
  const unique = uniquePaths(normalized.filter((candidate): candidate is string => Boolean(candidate)))

  return unique.sort(compareWindowsExecutablePreference)[0]
}

async function findWithWhere(runner: CommandRunner, executable: string): Promise<string[]> {
  try {
    const result = await runner.run(WHICH_EXECUTABLE, [executable], {
      timeoutMs: 5_000
    })

    return result.stdout.split('\n').map((line) => line.trim()).filter(Boolean)
  } catch {
    return []
  }
}

async function normalizeWindowsExecutableCandidate(candidate: string, executable: string): Promise<string | undefined> {
  if (!isWindowsPath(candidate)) {
    return candidate
  }

  const directCandidate = await existingFile(candidate)

  if (!directCandidate) {
    return undefined
  }

  if (path.extname(directCandidate).toLowerCase() === '.exe') {
    return directCandidate
  }

  const shimFileTarget = await resolveWindowsShimFileTarget(directCandidate)

  if (shimFileTarget) {
    return shimFileTarget
  }

  const shimTarget = await resolveKnownWindowsShimTarget(directCandidate, executable)

  if (shimTarget) {
    return shimTarget
  }

  return undefined
}

async function resolveKnownWindowsShimTarget(shimPath: string, executable: string): Promise<string | undefined> {
  const directory = path.dirname(shimPath)
  const knownTargets: Record<string, string[]> = {
    claude: [
      path.join(directory, 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe')
    ],
    codex: [
      path.join(directory, 'node_modules', '@openai', 'codex', 'bin', 'codex.exe'),
      path.join(directory, 'node_modules', '@openai', 'codex', 'bin', 'codex-x86_64-pc-windows-msvc.exe')
    ]
  }

  for (const target of knownTargets[executable] ?? []) {
    const existingTarget = await existingFile(target)

    if (existingTarget) {
      return existingTarget
    }
  }

  return undefined
}

async function resolveWindowsShimFileTarget(shimPath: string): Promise<string | undefined> {
  let content: string

  try {
    content = await fs.readFile(shimPath, 'utf8')
  } catch {
    return undefined
  }

  const directory = path.dirname(shimPath)
  const targetPatterns = [
    /"%dp0%[\\/](?<target>[^"]+?\.exe)"/i,
    /"\$basedir[\\/](?<target>[^"]+?\.exe)"/i
  ]

  for (const pattern of targetPatterns) {
    const match = content.match(pattern)
    const target = match?.groups?.target

    if (!target) {
      continue
    }

    const resolvedTarget = await existingFile(path.join(directory, target.replaceAll('/', path.sep).replaceAll('\\', path.sep)))

    if (resolvedTarget) {
      return resolvedTarget
    }
  }

  return undefined
}

async function existingFile(filePath: string): Promise<string | undefined> {
  try {
    const stats = await fs.stat(filePath)

    return stats.isFile() ? path.normalize(filePath) : undefined
  } catch {
    return undefined
  }
}

function isWindowsPath(candidate: string): boolean {
  return /^[a-z]:[\\/]/i.test(candidate) || candidate.startsWith('\\\\')
}

function uniquePaths(paths: Array<string | undefined>): string[] {
  const seen = new Set<string>()
  const unique: string[] = []

  for (const candidate of paths) {
    if (!candidate) {
      continue
    }

    const key = candidate.toLowerCase()

    if (!seen.has(key)) {
      seen.add(key)
      unique.push(candidate)
    }
  }

  return unique
}

function compareWindowsExecutablePreference(left: string, right: string): number {
  return windowsExecutablePreference(left) - windowsExecutablePreference(right)
}

function windowsExecutablePreference(filePath: string): number {
  const normalized = filePath.toLowerCase()

  if (normalized.includes('\\.vscode\\extensions\\openai.chatgpt-')) {
    return 0
  }

  if (normalized.endsWith('\\claude.exe') || normalized.endsWith('\\codex.exe')) {
    return 1
  }

  if (path.extname(normalized) === '.exe') {
    return 2
  }

  return 3
}
