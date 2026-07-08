import type { MemoryQueryOptions } from '../memoryQueries.js'
import type { RepositoryStatusChange } from './types.js'
import { git, requireRepositoryPath } from './gitCommand.js'

export async function getRepositoryStatus(options: MemoryQueryOptions) {
  const repoPath = await requireRepositoryPath(options)
  const raw = await git(repoPath, ['status', '--porcelain=v1', '-b', '--untracked-files=all'])
  const lines = raw.stdout.split(/\r?\n/).filter(Boolean)
  const branch = parseBranchLine(lines[0] ?? '')
  const changes = lines.slice(1).map(parseStatusLine)
  const counts = {
    changed: changes.length,
    staged: changes.filter((change) => change.index !== ' ' && change.index !== '?').length,
    unstaged: changes.filter((change) => change.worktree !== ' ' && change.worktree !== '?').length,
    untracked: changes.filter((change) => change.status === 'untracked').length,
    conflicted: changes.filter((change) => change.status === 'conflicted').length
  }

  return {
    repository: {
      rootPath: repoPath
    },
    branch,
    clean: changes.length === 0,
    counts,
    changes
  }
}

function parseBranchLine(line: string) {
  const value = line.replace(/^##\s*/, '')
  const detached = value.startsWith('HEAD ')
  const match = value.match(/^([^.\s]+|\S+?)(?:\.\.\.([^\s]+))?(?:\s+\[(.+)\])?/)
  const status = match?.[3] ?? ''

  return {
    name: detached ? 'HEAD' : match?.[1] ?? value,
    upstream: match?.[2],
    detached,
    ahead: Number(status.match(/ahead\s+(\d+)/)?.[1] ?? 0),
    behind: Number(status.match(/behind\s+(\d+)/)?.[1] ?? 0)
  }
}

function parseStatusLine(line: string): RepositoryStatusChange {
  const index = line[0] ?? ' '
  const worktree = line[1] ?? ' '
  const body = line.slice(3)
  const [originalPath, nextPath] = body.includes(' -> ') ? body.split(' -> ') : [undefined, body]

  return {
    path: nextPath,
    originalPath,
    index,
    worktree,
    status: statusLabel(index, worktree)
  }
}

function statusLabel(index: string, worktree: string): string {
  if (index === '?' && worktree === '?') return 'untracked'
  if (index === 'U' || worktree === 'U' || (index === 'A' && worktree === 'A') || (index === 'D' && worktree === 'D')) return 'conflicted'
  if (index !== ' ' && worktree !== ' ') return 'staged_and_unstaged'
  if (index !== ' ') return 'staged'
  if (worktree !== ' ') return 'unstaged'
  return 'clean'
}
