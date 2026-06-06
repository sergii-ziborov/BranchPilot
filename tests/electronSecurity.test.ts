import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('Electron security posture', () => {
  it('keeps the renderer isolated, sandboxed, and without Node integration', () => {
    const mainSource = readFileSync(path.join(process.cwd(), 'electron/main.ts'), 'utf8')
    const webPreferences = mainSource.match(/webPreferences:\s*\{(?<body>[\s\S]*?)\n\s*\}/)?.groups?.body ?? ''

    expect(webPreferences).toContain('contextIsolation: true')
    expect(webPreferences).toContain('nodeIntegration: false')
    expect(webPreferences).toContain('sandbox: true')
    expect(webPreferences).not.toContain('allowRunningInsecureContent: true')
    expect(webPreferences).not.toContain('webSecurity: false')
  })

  it('routes window.open through the external URL guard before shell.openExternal', () => {
    const mainSource = readFileSync(path.join(process.cwd(), 'electron/main.ts'), 'utf8')

    expect(mainSource).toContain('setWindowOpenHandler')
    expect(mainSource).toContain('isSafeExternalUrl(url)')
    expect(mainSource).toContain('shell.openExternal(url)')
  })
})
