import { describe, expect, it } from 'vitest'
import { parseUnifiedDiff } from '../electron/lib/diffParser'

describe('parseUnifiedDiff', () => {
  it('parses a modified file with multiple hunks and line numbers', () => {
    const files = parseUnifiedDiff([
      'diff --git a/tracked.txt b/tracked.txt',
      'index e79c5e8..2c55629 100644',
      '--- a/tracked.txt',
      '+++ b/tracked.txt',
      '@@ -1,3 +1,3 @@',
      ' one',
      '-two',
      '+two changed',
      ' three',
      '@@ -10,2 +10,3 @@',
      ' ten',
      '+eleven',
      ' twelve'
    ].join('\n'))

    expect(files).toHaveLength(1)
    expect(files[0]).toMatchObject({
      oldPath: 'tracked.txt',
      newPath: 'tracked.txt'
    })
    expect(files[0].hunks).toHaveLength(2)
    expect(files[0].hunks[0]).toMatchObject({
      oldStart: 1,
      oldLines: 3,
      newStart: 1,
      newLines: 3
    })
    expect(files[0].hunks[0].lines[1]).toMatchObject({
      type: 'remove',
      content: 'two',
      oldLineNumber: 2
    })
    expect(files[0].hunks[0].lines[2]).toMatchObject({
      type: 'add',
      content: 'two changed',
      newLineNumber: 2
    })
    expect(files[0].hunks[1].patch).toContain('@@ -10,2 +10,3 @@')
    expect(files[0].hunks[1].patch).not.toContain('@@ -1,3 +1,3 @@')
  })

  it('parses added, deleted, and renamed file headers', () => {
    const files = parseUnifiedDiff([
      'diff --git a/old.txt b/new.txt',
      'similarity index 88%',
      'rename from old.txt',
      'rename to new.txt',
      '--- a/old.txt',
      '+++ b/new.txt',
      '@@ -1 +1 @@',
      '-old',
      '+new',
      'diff --git a/deleted.txt b/deleted.txt',
      'deleted file mode 100644',
      '--- a/deleted.txt',
      '+++ /dev/null',
      '@@ -1 +0,0 @@',
      '-deleted',
      'diff --git a/added.txt b/added.txt',
      'new file mode 100644',
      '--- /dev/null',
      '+++ b/added.txt',
      '@@ -0,0 +1 @@',
      '+added'
    ].join('\n'))

    expect(files.map((file) => file.newPath)).toEqual(['new.txt', '/dev/null', 'added.txt'])
    expect(files[0].oldPath).toBe('old.txt')
    expect(files[1].oldPath).toBe('deleted.txt')
    expect(files[2].oldPath).toBeUndefined()
  })
})
