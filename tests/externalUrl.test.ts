import { describe, expect, it } from 'vitest'
import { isSafeExternalUrl as isSafeElectronExternalUrl } from '../electron/lib/externalUrl'
import { isSafeExternalUrl } from '../src/shared/externalUrl'

describe('external URL guard', () => {
  it('allows HTTPS URLs only', () => {
    expect(isSafeExternalUrl('https://github.com/example/project/pull/1')).toBe(true)
    expect(isSafeExternalUrl('http://github.com/example/project')).toBe(false)
    expect(isSafeExternalUrl('file:///Users/example/token.txt')).toBe(false)
    expect(isSafeExternalUrl('javascript:alert(1)')).toBe(false)
    expect(isSafeExternalUrl('not a url')).toBe(false)
  })

  it('keeps the Electron guard pointed at the shared implementation', () => {
    expect(isSafeElectronExternalUrl('https://github.com/example/project/pull/1')).toBe(true)
    expect(isSafeElectronExternalUrl('file:///Users/example/token.txt')).toBe(false)
  })
})
