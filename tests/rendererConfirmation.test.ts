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

describe('renderer confirmation UI', () => {
  it('uses the in-app confirmation dialog instead of system confirm prompts', () => {
    const source = readSrcTree()

    expect(source).toContain('confirmation-dialog')
    expect(source).toContain('requestConfirmation')
    expect(source).not.toContain('window.confirm')
  })
})
