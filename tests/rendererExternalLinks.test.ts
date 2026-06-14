import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

function readSrcTree(): string {
  const root = path.join(process.cwd(), 'src')
  const parts: string[] = []

  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry)
      if (statSync(full).isDirectory()) {
        walk(full)
      } else if (/\.(ts|tsx)$/.test(entry)) {
        parts.push(readFileSync(full, 'utf8'))
      }
    }
  }

  walk(root)
  return parts.join('\n')
}

describe('renderer external links', () => {
  it('routes link opening through the shared safe URL guard', () => {
    const source = readSrcTree()
    const windowOpenCount = source.match(/window\.open\(/g)?.length ?? 0

    expect(source).toContain('isSafeExternalUrl')
    expect(source).toContain('function openExternalLink')
    expect(windowOpenCount).toBe(1)
  })
})
