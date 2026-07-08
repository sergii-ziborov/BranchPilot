import type { RepositoryDiffOptions } from './types.js'
import { git, requireRepositoryPath } from './gitCommand.js'
import {
  normalizeGitRef,
  normalizeMaxBytes,
  normalizeRepositoryRelativePath,
  truncateText
} from './normalization.js'

export async function getRepositoryDiff(options: RepositoryDiffOptions) {
  const repoPath = await requireRepositoryPath(options)
  const args = diffArgs(options)
  const statArgs = diffArgs({ ...options, maxBytes: undefined }).filter((arg) => arg !== '--patch')
  const [diff, stat] = await Promise.all([
    git(repoPath, args),
    git(repoPath, [...statArgs.slice(0, 1), '--stat', ...statArgs.slice(1)])
  ])

  return {
    repository: {
      rootPath: repoPath
    },
    mode: options.base || options.head ? 'compare' : options.mode ?? 'all',
    path: options.path ? normalizeRepositoryRelativePath(options.path) : undefined,
    base: options.base,
    head: options.head,
    stat: truncateText(stat.stdout.trim(), normalizeMaxBytes(options.maxBytes)),
    diff: truncateText(diff.stdout, normalizeMaxBytes(options.maxBytes))
  }
}

function diffArgs(options: RepositoryDiffOptions): string[] {
  const args = ['diff', '--no-ext-diff']
  const relativePath = options.path ? normalizeRepositoryRelativePath(options.path) : undefined

  if (options.base || options.head) {
    const base = normalizeGitRef(options.base ?? 'HEAD')
    const head = normalizeGitRef(options.head ?? 'HEAD')
    args.push(`${base}..${head}`)
  } else if (options.mode === 'staged') {
    args.push('--cached')
  } else if (options.mode === 'unstaged') {
    // plain git diff
  } else {
    args.push('HEAD')
  }

  if (relativePath) {
    args.push('--', relativePath)
  }

  return args
}
