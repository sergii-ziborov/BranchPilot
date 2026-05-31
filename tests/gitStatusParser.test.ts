import { describe, expect, it } from 'vitest'
import { parseGitStatus } from '../electron/lib/gitStatusParser'

describe('parseGitStatus', () => {
  it('parses branch metadata and common change states', () => {
    const output = [
      '# branch.oid abc123',
      '# branch.head main',
      '# branch.upstream origin/main',
      '# branch.ab +2 -1',
      '1 M. N... 100644 100644 100644 aaa bbb src/staged.ts',
      '1 .M N... 100644 100644 100644 aaa bbb src/unstaged.ts',
      '? src/new file.ts',
      ''
    ].join('\0')

    const parsed = parseGitStatus(output)

    expect(parsed.branch).toBe('main')
    expect(parsed.upstream).toBe('origin/main')
    expect(parsed.ahead).toBe(2)
    expect(parsed.behind).toBe(1)
    expect(parsed.counts).toMatchObject({
      changed: 3,
      staged: 1,
      unstaged: 2,
      untracked: 1,
      conflicted: 0
    })
  })

  it('parses renamed and conflicted records', () => {
    const output = [
      '# branch.head feature/test',
      '2 R. N... 100644 100644 100644 aaa bbb R100 src/new-name.ts',
      'src/old-name.ts',
      'u UU N... 100644 100644 100644 100644 aaa bbb ccc src/conflict.ts',
      ''
    ].join('\0')

    const parsed = parseGitStatus(output)

    expect(parsed.changes[0]).toMatchObject({
      path: 'src/new-name.ts',
      originalPath: 'src/old-name.ts',
      status: 'renamed'
    })
    expect(parsed.conflicts).toEqual([
      {
        path: 'src/conflict.ts',
        type: 'both modified',
        ours: true,
        theirs: true
      }
    ])
  })
})
