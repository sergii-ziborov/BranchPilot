import { describe, expect, it } from 'vitest'
import { toParsedGitStatus } from '../electron/lib/nativeBackend/nativeStatus'
import { parseGitStatus } from '../electron/lib/gitStatusParser'

describe('native status mapping', () => {
  it('produces the same change objects as the console parser', () => {
    const consoleStatus = parseGitStatus([
      '# branch.oid abc123',
      '# branch.head main',
      '# branch.upstream origin/main',
      '# branch.ab +2 -1',
      '1 .M N... 100644 100644 100644 abc abc src/app.ts',
      '1 A. N... 000000 100644 100644 000000 def src/new.ts',
      '? notes.txt'
    ].join('\0'))

    const nativeStatus = toParsedGitStatus({
      headOid: 'abc123',
      branch: 'main',
      upstream: 'origin/main',
      ahead: 2,
      behind: 1,
      isDetached: false,
      entries: [
        { path: 'src/app.ts', staged: '.', unstaged: 'M', untracked: false },
        { path: 'src/new.ts', staged: 'A', unstaged: '.', untracked: false },
        { path: 'notes.txt', staged: '.', unstaged: '?', untracked: true }
      ]
    })

    expect(nativeStatus.changes).toEqual(consoleStatus.changes)
    expect(nativeStatus.counts).toEqual(consoleStatus.counts)
    expect(nativeStatus).toMatchObject({
      headOid: 'abc123',
      branch: 'main',
      upstream: 'origin/main',
      ahead: 2,
      behind: 1,
      isDetached: false
    })
  })

  it('maps a rename to the console parser shape', () => {
    const consoleStatus = parseGitStatus([
      '# branch.head main',
      '2 R. N... 100644 100644 100644 abc abc R100 src/renamed.ts',
      'src/original.ts'
    ].join('\0'))

    const nativeStatus = toParsedGitStatus({
      branch: 'main',
      ahead: 0,
      behind: 0,
      isDetached: false,
      entries: [
        { path: 'src/renamed.ts', originalPath: 'src/original.ts', staged: 'R', unstaged: '.', untracked: false }
      ]
    })

    expect(nativeStatus.changes).toEqual(consoleStatus.changes)
  })

  it('labels a detached head the way the console parser does', () => {
    const nativeStatus = toParsedGitStatus({
      headOid: 'abc123',
      branch: '',
      ahead: 0,
      behind: 0,
      isDetached: true,
      entries: []
    })

    expect(nativeStatus.branch).toBe('Detached HEAD')
    expect(nativeStatus.isDetached).toBe(true)
  })

  it('derives conflicts from unmerged entries', () => {
    const nativeStatus = toParsedGitStatus({
      branch: 'main',
      ahead: 0,
      behind: 0,
      isDetached: false,
      entries: [{ path: 'src/app.ts', staged: 'U', unstaged: 'U', untracked: false }]
    })

    expect(nativeStatus.counts.conflicted).toBe(1)
    expect(nativeStatus.changes[0]).toMatchObject({ status: 'conflicted', conflicted: true })
  })
})
