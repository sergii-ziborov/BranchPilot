import type {
  ConflictFile,
  FileChange,
  FileChangeStatus,
  RepositoryCounts
} from '../../src/shared/branchPilot.js'

export interface ParsedGitStatus {
  headOid?: string
  branch: string
  upstream?: string
  ahead: number
  behind: number
  isDetached: boolean
  changes: FileChange[]
  counts: RepositoryCounts
  conflicts: ConflictFile[]
}

export function parseGitStatus(output: string): ParsedGitStatus {
  const records = output.split('\0').filter(Boolean)
  const changes: FileChange[] = []
  let branch = ''
  let headOid: string | undefined
  let upstream: string | undefined
  let ahead = 0
  let behind = 0

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]

    if (record.startsWith('# ')) {
      const [key, ...valueParts] = record.slice(2).split(' ')
      const value = valueParts.join(' ')

      if (key === 'branch.oid') {
        headOid = value === '(initial)' ? undefined : value
      } else if (key === 'branch.head') {
        branch = value
      } else if (key === 'branch.upstream') {
        upstream = value
      } else if (key === 'branch.ab') {
        const aheadMatch = value.match(/\+(\d+)/)
        const behindMatch = value.match(/-(\d+)/)
        ahead = aheadMatch ? Number(aheadMatch[1]) : 0
        behind = behindMatch ? Number(behindMatch[1]) : 0
      }

      continue
    }

    if (record.startsWith('1 ')) {
      changes.push(parseOrdinaryChange(record))
      continue
    }

    if (record.startsWith('2 ')) {
      const parsed = parseRenamedChange(record, records[index + 1])
      changes.push(parsed.change)
      index += parsed.consumedOriginalPath ? 1 : 0
      continue
    }

    if (record.startsWith('u ')) {
      changes.push(parseUnmergedChange(record))
      continue
    }

    if (record.startsWith('? ')) {
      const filePath = record.slice(2)
      changes.push({
        path: filePath,
        status: 'untracked',
        staged: false,
        unstaged: true,
        untracked: true,
        conflicted: false,
        unstagedStatus: '?'
      })
      continue
    }

    if (record.startsWith('! ')) {
      const filePath = record.slice(2)
      changes.push({
        path: filePath,
        status: 'ignored',
        staged: false,
        unstaged: false,
        untracked: false,
        conflicted: false
      })
    }
  }

  const conflicts = changes
    .filter((change) => change.conflicted)
    .map<ConflictFile>((change) => ({
      path: change.path,
      type: classifyConflict(change.stagedStatus ?? 'U', change.unstagedStatus ?? 'U'),
      ours: true,
      theirs: true
    }))

  const counts: RepositoryCounts = {
    changed: changes.length,
    staged: changes.filter((change) => change.staged).length,
    unstaged: changes.filter((change) => change.unstaged).length,
    untracked: changes.filter((change) => change.untracked).length,
    conflicted: conflicts.length
  }

  const isDetached = branch === '(detached)'

  return {
    headOid,
    branch: isDetached ? 'Detached HEAD' : branch,
    upstream,
    ahead,
    behind,
    isDetached,
    changes,
    counts,
    conflicts
  }
}

function parseOrdinaryChange(record: string): FileChange {
  const parts = record.split(' ')
  const xy = parts[1] ?? '..'
  const filePath = parts.slice(8).join(' ')

  return makeChange(filePath, xy[0], xy[1])
}

function parseRenamedChange(record: string, nextRecord?: string): { change: FileChange; consumedOriginalPath: boolean } {
  const parts = record.split(' ')
  const xy = parts[1] ?? '..'
  const filePath = parts.slice(9).join(' ')
  const originalPath = nextRecord && !looksLikeStatusRecord(nextRecord) ? nextRecord : undefined

  return {
    change: {
      ...makeChange(filePath, xy[0], xy[1], 'renamed'),
      originalPath
    },
    consumedOriginalPath: Boolean(originalPath)
  }
}

function parseUnmergedChange(record: string): FileChange {
  const parts = record.split(' ')
  const xy = parts[1] ?? 'UU'
  const filePath = parts.slice(10).join(' ')

  return {
    path: filePath,
    status: 'conflicted',
    stagedStatus: xy[0],
    unstagedStatus: xy[1],
    staged: true,
    unstaged: true,
    untracked: false,
    conflicted: true
  }
}

function makeChange(
  filePath: string,
  stagedStatus = '.',
  unstagedStatus = '.',
  forcedStatus?: FileChangeStatus
): FileChange {
  const staged = stagedStatus !== '.'
  const unstaged = unstagedStatus !== '.'

  return {
    path: filePath,
    status: forcedStatus ?? classifyStatus(stagedStatus, unstagedStatus),
    stagedStatus: staged ? stagedStatus : undefined,
    unstagedStatus: unstaged ? unstagedStatus : undefined,
    staged,
    unstaged,
    untracked: false,
    conflicted: stagedStatus === 'U' || unstagedStatus === 'U'
  }
}

function classifyStatus(stagedStatus: string, unstagedStatus: string): FileChangeStatus {
  const statuses = `${stagedStatus}${unstagedStatus}`

  if (statuses.includes('U')) {
    return 'conflicted'
  }

  if (statuses.includes('R')) {
    return 'renamed'
  }

  if (statuses.includes('C')) {
    return 'copied'
  }

  if (statuses.includes('A')) {
    return 'added'
  }

  if (statuses.includes('D')) {
    return 'deleted'
  }

  if (statuses.includes('M')) {
    return 'modified'
  }

  return 'unknown'
}

function classifyConflict(stagedStatus: string, unstagedStatus: string): string {
  const xy = `${stagedStatus}${unstagedStatus}`

  if (xy === 'DD') return 'both deleted'
  if (xy === 'AU') return 'added by us'
  if (xy === 'UD') return 'deleted by them'
  if (xy === 'UA') return 'added by them'
  if (xy === 'DU') return 'deleted by us'
  if (xy === 'AA') return 'added by both'

  return 'both modified'
}

function looksLikeStatusRecord(record: string): boolean {
  return (
    record.startsWith('# ') ||
    record.startsWith('1 ') ||
    record.startsWith('2 ') ||
    record.startsWith('u ') ||
    record.startsWith('? ') ||
    record.startsWith('! ')
  )
}
