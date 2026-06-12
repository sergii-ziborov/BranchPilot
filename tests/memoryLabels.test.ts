import { describe, expect, it } from 'vitest'
import { memoryFileMeta } from '../src/lib/memoryLabels'
import type { ProjectMemoryFile } from '../src/shared/branchPilot'

function makeFile(overrides: Partial<ProjectMemoryFile> = {}): ProjectMemoryFile {
  return {
    path: 'src/file.ts',
    extension: 'ts',
    sizeBytes: 2048,
    symbolCount: 5,
    importCount: 0,
    ...overrides
  }
}

describe('memoryFileMeta', () => {
  it('prefers language over extension and lists size and symbols', () => {
    expect(memoryFileMeta(makeFile({ language: 'TypeScript', sizeBytes: 2048, symbolCount: 5 })))
      .toBe('TypeScript · 2 KB · 5 symbols')
  })

  it('falls back to extension, then to "file"', () => {
    expect(memoryFileMeta(makeFile({ language: undefined, extension: 'md' }))).toContain('md · ')
    expect(memoryFileMeta(makeFile({ language: undefined, extension: '' }))).toContain('file · ')
  })

  it('appends import count only when positive', () => {
    expect(memoryFileMeta(makeFile({ language: 'TypeScript', importCount: 0 }))).not.toContain('imports')
    expect(memoryFileMeta(makeFile({ language: 'TypeScript', importCount: 3 }))).toContain('3 imports')
  })
})
