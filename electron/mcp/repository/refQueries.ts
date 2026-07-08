import type { MemoryQueryOptions } from '../memoryQueries.js'
import { git, requireRepositoryPath } from './gitCommand.js'

export async function listRepositoryRefs(options: MemoryQueryOptions) {
  const repoPath = await requireRepositoryPath(options)
  const [localBranches, remoteBranches, tags, remotes, worktrees] = await Promise.all([
    git(repoPath, ['branch', '--format=%(refname:short)%00%(objectname:short)%00%(upstream:short)%00%(committerdate:iso8601)%00%(subject)']),
    git(repoPath, ['branch', '-r', '--format=%(refname:short)%00%(objectname:short)%00%(committerdate:iso8601)%00%(subject)']),
    git(repoPath, ['tag', '--sort=-creatordate', '--format=%(refname:short)%00%(objectname:short)%00%(creatordate:iso8601)%00%(subject)']),
    git(repoPath, ['remote', '-v']),
    git(repoPath, ['worktree', 'list', '--porcelain'])
  ])

  return {
    repository: {
      rootPath: repoPath
    },
    localBranches: parseLocalBranches(localBranches.stdout),
    remoteBranches: parseRemoteBranches(remoteBranches.stdout),
    tags: parseTags(tags.stdout),
    remotes: parseRemotes(remotes.stdout),
    worktrees: parseWorktrees(worktrees.stdout)
  }
}

function parseLocalBranches(raw: string) {
  return raw.split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [name, shortSha, upstream, committedAt, subject] = line.split('\0')
      return { name, shortSha, upstream: upstream || null, committedAt: committedAt || null, subject: subject || '' }
    })
}

function parseRemoteBranches(raw: string) {
  return raw.split(/\r?\n/)
    .filter(Boolean)
    .filter((line) => !line.startsWith('origin/HEAD'))
    .map((line) => {
      const [name, shortSha, committedAt, subject] = line.split('\0')
      return { name, shortSha, committedAt: committedAt || null, subject: subject || '' }
    })
}

function parseTags(raw: string) {
  return raw.split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [name, shortSha, createdAt, subject] = line.split('\0')
      return { name, shortSha, createdAt: createdAt || null, subject: subject || '' }
    })
}

function parseRemotes(raw: string) {
  const remotes = new Map<string, { name: string; fetchUrl?: string; pushUrl?: string }>()

  for (const line of raw.split(/\r?\n/).filter(Boolean)) {
    const match = line.match(/^(\S+)\s+(\S+)\s+\((fetch|push)\)$/)
    if (!match) continue
    const entry = remotes.get(match[1]) ?? { name: match[1] }
    if (match[3] === 'fetch') entry.fetchUrl = match[2]
    if (match[3] === 'push') entry.pushUrl = match[2]
    remotes.set(entry.name, entry)
  }

  return [...remotes.values()]
}

function parseWorktrees(raw: string) {
  const worktrees: Array<Record<string, string | boolean>> = []
  let current: Record<string, string | boolean> | null = null

  for (const line of raw.split(/\r?\n/)) {
    if (line.startsWith('worktree ')) {
      current = { path: line.slice('worktree '.length) }
      worktrees.push(current)
      continue
    }

    if (!current || !line) continue

    if (line === 'bare' || line === 'detached') {
      current[line] = true
      continue
    }

    const [key, ...rest] = line.split(' ')
    current[key] = rest.join(' ')
  }

  return worktrees
}
