import { describe, expect, it } from 'vitest'
import { buildRepositoryFileTree, flattenFileTree, type EditorTreeRow } from '../src/components/changes/internal-editor/fileTree'
import type { RepositoryFileEntry } from '../src/shared/branchPilot'

const files = (...paths: string[]): RepositoryFileEntry[] => paths.map((path) => ({ path }))
const isFile = (row: EditorTreeRow): row is Extract<EditorTreeRow, { kind: 'file' }> => row.kind === 'file'

describe('flattenFileTree', () => {
  it('emits rows pre-order: root files, then each folder header before its files and children', () => {
    const tree = buildRepositoryFileTree(files(
      'readme.md',
      'src/app.ts',
      'src/index.ts',
      'src/util/format.ts',
      'src/util/parse.ts'
    ))

    const shape = flattenFileTree(tree).map((row) =>
      row.kind === 'folder' ? `dir ${row.folder.path} @${row.depth}` : `file ${row.file.path} @${row.depth}`
    )

    expect(shape).toEqual([
      'file readme.md @0',
      'dir src @0',
      'file src/app.ts @1',
      'file src/index.ts @1',
      'dir src/util @1',
      'file src/util/format.ts @2',
      'file src/util/parse.ts @2'
    ])
  })

  it('uses folder-relative display names for nested files and full paths at the root', () => {
    const rows = flattenFileTree(buildRepositoryFileTree(files('root.txt', 'a/b/deep.ts')))

    expect(rows.filter(isFile).find((row) => row.file.path === 'root.txt')?.displayName).toBe('root.txt')
    expect(rows.filter(isFile).find((row) => row.file.path === 'a/b/deep.ts')?.displayName).toBe('deep.ts')
  })

  it('assigns unique keys so windowed rows keep a stable identity', () => {
    const keys = flattenFileTree(buildRepositoryFileTree(files('a/x.ts', 'b/x.ts'))).map((row) => row.key)
    expect(new Set(keys).size).toBe(keys.length)
  })
})
