import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('renderer external links', () => {
  it('routes link opening through the shared safe URL guard', () => {
    const appSource = readFileSync(path.join(process.cwd(), 'src/App.tsx'), 'utf8')
    const windowOpenCount = appSource.match(/window\.open\(/g)?.length ?? 0

    expect(appSource).toContain('isSafeExternalUrl')
    expect(appSource).toContain('function openExternalLink')
    expect(windowOpenCount).toBe(1)
  })
})
