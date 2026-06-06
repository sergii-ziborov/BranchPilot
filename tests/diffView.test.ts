import { describe, expect, it } from 'vitest'
import type { DiffLine } from '../src/shared/branchPilot'
import { buildSplitDiffRows } from '../src/shared/diffView'

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
