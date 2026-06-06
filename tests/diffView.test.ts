import { describe, expect, it } from 'vitest'
import type { DiffLine, DiffResult } from '../src/shared/branchPilot'
import { buildSplitDiffRows, getDiffStats } from '../src/shared/diffView'

describe('buildSplitDiffRows', () => {
  it('pairs adjacent removed and added lines into side-by-side rows', () => {
    const rows = buildSplitDiffRows([
      line('context', 'before', 1, 1),
      line('remove', 'old one', 2),
      line('remove', 'old two', 3),
      line('add', 'new one', undefined, 2),
      line('context', 'after', 4, 3)
    ])

    expect(rows).toHaveLength(4)
    expect(rows[0]).toMatchObject({
      oldLine: { content: 'before' },
      newLine: { content: 'before' }
    })
    expect(rows[1]).toMatchObject({
      oldLine: { content: 'old one' },
      newLine: { content: 'new one' }
    })
    expect(rows[2]).toMatchObject({
      oldLine: { content: 'old two' },
      newLine: undefined
    })
    expect(rows[3]).toMatchObject({
      oldLine: { content: 'after' },
      newLine: { content: 'after' }
    })
  })

  it('keeps pure additions and removals on their own side', () => {
    const rows = buildSplitDiffRows([
      line('add', 'created', undefined, 1),
      line('remove', 'deleted', 2),
      line('context', 'kept', 3, 2)
    ])

    expect(rows).toEqual([
      { newLine: line('add', 'created', undefined, 1) },
      { oldLine: line('remove', 'deleted', 2), newLine: undefined },
      {
        oldLine: line('context', 'kept', 3, 2),
        newLine: line('context', 'kept', 3, 2)
      }
    ])
  })
})

describe('getDiffStats', () => {
  it('counts additions and deletions from parsed diff files', () => {
    expect(getDiffStats({
      filePath: 'tracked.txt',
      staged: false,
      text: 'diff',
      binary: false,
      tooLarge: false,
      files: [{
        newPath: 'tracked.txt',
        hunks: [{
          header: '@@ -1,3 +1,4 @@',
          oldStart: 1,
          oldLines: 3,
          newStart: 1,
          newLines: 4,
          patch: '',
          lines: [
            line('context', 'kept', 1, 1),
            line('remove', 'old', 2),
            line('add', 'new', undefined, 2),
            line('add', 'created', undefined, 3)
          ]
        }]
      }]
    })).toEqual({
      additions: 2,
      deletions: 1
    })
  })

  it('counts raw diff lines without treating file headers as changed lines', () => {
    expect(getDiffStats(makeRawDiff([
      'diff --git a/file.txt b/file.txt',
      '--- a/file.txt',
      '+++ b/file.txt',
      '@@ -1,2 +1,2 @@',
      '-old',
      '+new',
      ' context'
    ].join('\n')))).toEqual({
      additions: 1,
      deletions: 1
    })
  })
})

function line(
  type: DiffLine['type'],
  content: string,
  oldLineNumber?: number,
  newLineNumber?: number
): DiffLine {
  return {
    type,
    content,
    oldLineNumber,
    newLineNumber
  }
}

function makeRawDiff(text: string): DiffResult {
  return {
    filePath: 'file.txt',
    staged: false,
    text,
    binary: false,
    tooLarge: false,
    files: []
  }
}
