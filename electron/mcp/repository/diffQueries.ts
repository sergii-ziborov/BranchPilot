import type { RepositoryDiffOptions } from './types.js'
import { git, requireRepositoryPath } from './gitCommand.js'
import {
  normalizeGitRef,
  normalizeMaxBytes,
  normalizeRepositoryRelativePath,
  truncateText
} from './normalization.js'

type DiffFormat = 'patch' | 'stat' | 'name-only'

const UNTRACKED_LIMIT = 100

export async function getRepositoryDiff(options: RepositoryDiffOptions) {
  const repoPath = await requireRepositoryPath(options)
  const format = normalizeDiffFormat(options.format)
  const relativePath = options.path ? normalizeRepositoryRelativePath(options.path) : undefined
  const range = diffRange(options)
  const maxBytes = normalizeMaxBytes(options.maxBytes)
  // git diff never shows untracked files, so working-tree diffs list them explicitly —
  // otherwise brand-new files are invisible to a review over MCP.
  const untracked = coversWorkingTree(options)
    ? await listUntrackedFiles(repoPath, relativePath)
    : undefined
  const meta = {
    repository: {
      rootPath: repoPath
    },
    mode: options.base || options.head
      ? (options.mergeBase ? 'compare-merge-base' : 'compare')
      : options.mode ?? 'all',
    format,
    path: relativePath,
    base: options.base,
    head: options.head,
    ...(untracked ? {
      untracked: untracked.slice(0, UNTRACKED_LIMIT),
      untrackedCount: untracked.length
    } : {})
  }

  if (format === 'name-only') {
    const result = await git(repoPath, diffArgs({ range, relativePath, extra: ['--name-status'] }))
    return { ...meta, files: parseNameStatus(result.stdout) }
  }

  const stat = await git(repoPath, diffArgs({ range, relativePath, extra: ['--stat'] }))

  if (format === 'stat') {
    return { ...meta, stat: truncateText(stat.stdout.trim(), maxBytes) }
  }

  const contextArgs = hasContextLines(options) ? [`--unified=${normalizeContextLines(options.contextLines)}`] : []
  const diff = await git(repoPath, diffArgs({ range, relativePath, extra: ['--patch', ...contextArgs] }))

  return {
    ...meta,
    stat: truncateText(stat.stdout.trim(), maxBytes),
    diff: truncateText(diff.stdout, maxBytes)
  }
}

function coversWorkingTree(options: RepositoryDiffOptions): boolean {
  return !options.base && !options.head && options.mode !== 'staged'
}

async function listUntrackedFiles(repoPath: string, relativePath: string | undefined): Promise<string[]> {
  const args = ['ls-files', '--others', '--exclude-standard']

  if (relativePath) {
    args.push('--', relativePath)
  }

  const result = await git(repoPath, args)
  return result.stdout
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter(Boolean)
}

function diffArgs(input: { range: string[]; relativePath?: string; extra: string[] }): string[] {
  const args = ['diff', '--no-ext-diff', ...input.extra, ...input.range]

  if (input.relativePath) {
    args.push('--', input.relativePath)
  }

  return args
}

// HEAD (all), --cached (staged), plain (unstaged), or a two-dot (base..head) / three-dot
// merge-base (base...head) comparison for PR-style review.
function diffRange(options: RepositoryDiffOptions): string[] {
  if (options.base || options.head) {
    const base = normalizeGitRef(options.base ?? 'HEAD')
    const head = normalizeGitRef(options.head ?? 'HEAD')
    return [options.mergeBase ? `${base}...${head}` : `${base}..${head}`]
  }

  if (options.mode === 'staged') {
    return ['--cached']
  }

  if (options.mode === 'unstaged') {
    return []
  }

  return ['HEAD']
}

function normalizeDiffFormat(format: string | undefined): DiffFormat {
  if (format === 'stat' || format === 'name-only') {
    return format
  }

  return 'patch'
}

function hasContextLines(options: RepositoryDiffOptions): boolean {
  return options.contextLines != null && Number.isFinite(options.contextLines)
}

function normalizeContextLines(value: number | undefined): number {
  return Math.min(50, Math.max(0, Math.floor(value ?? 3)))
}

function parseNameStatus(raw: string) {
  return raw.split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [status, filePath, nextPath] = line.split(/\t/)
      return {
        status,
        path: nextPath ?? filePath,
        originalPath: nextPath ? filePath : undefined
      }
    })
}
