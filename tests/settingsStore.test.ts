import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SettingsStore } from '../electron/lib/settingsStore'

const tempRoots: string[] = []

describe('SettingsStore', () => {
  afterEach(() => {
    for (const root of tempRoots.splice(0)) {
      rmSync(root, { force: true, recursive: true })
    }
  })

  it('defaults editor settings to Visual Studio Code', async () => {
    const store = createStore()

    await expect(store.getEditorSettings()).resolves.toEqual({
      preference: 'vscode'
    })
  })

  it('persists editor settings across store instances', async () => {
    const settingsPath = createSettingsPath()
    const firstStore = new SettingsStore(settingsPath)

    const saved = await firstStore.setEditorSettings({
      preference: 'custom',
      customCommand: 'my-editor --goto %TARGET_PATH%'
    })

    expect(saved).toMatchObject({
      preference: 'custom',
      customCommand: 'my-editor --goto %TARGET_PATH%'
    })
    expect(saved.updatedAt).toBeTruthy()

    const secondStore = new SettingsStore(settingsPath)
    await expect(secondStore.getEditorSettings()).resolves.toMatchObject({
      preference: 'custom',
      customCommand: 'my-editor --goto %TARGET_PATH%'
    })
  })

  it('defaults terminal settings to auto', async () => {
    const store = createStore()

    await expect(store.getTerminalSettings()).resolves.toEqual({
      preference: 'auto'
    })
  })

  it('persists terminal settings across store instances', async () => {
    const settingsPath = createSettingsPath()
    const firstStore = new SettingsStore(settingsPath)

    const saved = await firstStore.setTerminalSettings({
      preference: 'custom',
      customCommand: 'my-terminal --cwd %TARGET_PATH%'
    })

    expect(saved).toMatchObject({
      preference: 'custom',
      customCommand: 'my-terminal --cwd %TARGET_PATH%'
    })
    expect(saved.updatedAt).toBeTruthy()

    const secondStore = new SettingsStore(settingsPath)
    await expect(secondStore.getTerminalSettings()).resolves.toMatchObject({
      preference: 'custom',
      customCommand: 'my-terminal --cwd %TARGET_PATH%'
    })
  })
})

function createStore() {
  return new SettingsStore(createSettingsPath())
}

function createSettingsPath() {
  const directoryPath = mkdtempSync(path.join(tmpdir(), 'branchpilot-settings-store-test-'))
  tempRoots.push(directoryPath)

  return path.join(directoryPath, 'settings.json')
}
