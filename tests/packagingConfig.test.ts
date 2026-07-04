import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('packaging config', () => {
  it('keeps macOS unsigned local builds repeatable with a tracked icon', () => {
    const packageJson = JSON.parse(readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>
      build?: {
        asar?: boolean
        directories?: Record<string, string>
        mac?: Record<string, unknown>
      }
    }

    expect(packageJson.build?.asar).toBe(true)
    expect(packageJson.build?.directories).toMatchObject({
      buildResources: 'build',
      output: 'release'
    })
    expect(packageJson.build?.mac).toMatchObject({
      category: 'public.app-category.developer-tools',
      icon: 'build/icon.icns',
      identity: null,
      target: ['dmg', 'zip']
    })
    expect(packageJson.scripts).toMatchObject({
      'dist:mac': 'npm run build && electron-builder --mac',
      'dist:mac:run': 'npm run dist:mac && npm run start:mac',
      'start:mac': 'node scripts/open-mac-build.cjs'
    })
    expect(existsSync(path.join(process.cwd(), 'build/icon.icns'))).toBe(true)
    expect(existsSync(path.join(process.cwd(), 'build/icon.svg'))).toBe(true)
    expect(existsSync(path.join(process.cwd(), 'scripts/open-mac-build.cjs'))).toBe(true)
  })
})
