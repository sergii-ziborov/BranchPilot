import { describe, expect, it } from 'vitest'
import { isWindowsReservedPath } from '../electron/lib/repositoryService.helpers'

describe('isWindowsReservedPath', () => {
  it('flags reserved device names with or without an extension', () => {
    for (const reserved of ['NUL', 'NUL.css', 'nul.tar.gz', 'CON', 'con.txt', 'AUX', 'PRN', 'COM1', 'lpt9.log']) {
      expect(isWindowsReservedPath(reserved), reserved).toBe(true)
    }
  })

  it('flags reserved names in any path segment, for both separators', () => {
    expect(isWindowsReservedPath('src/renderer/NUL.css')).toBe(true)
    expect(isWindowsReservedPath('src\\theme\\CON')).toBe(true)
  })

  it('ignores trailing dots and spaces the way Windows does', () => {
    expect(isWindowsReservedPath('NUL.')).toBe(true)
    expect(isWindowsReservedPath('NUL ')).toBe(true)
  })

  it('does not flag names that merely start with a reserved word', () => {
    for (const ordinary of ['NULl.css', 'console.log', 'community.md', 'COM10', 'LPT0', 'auxiliary.ts', 'not-nul.txt']) {
      expect(isWindowsReservedPath(ordinary), ordinary).toBe(false)
    }
  })
})
