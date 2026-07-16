import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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

  it('persists recent repositories across store instances', async () => {
    const settingsPath = createSettingsPath()
    const firstStore = new SettingsStore(settingsPath)

    await firstStore.rememberRepository('/repos/alpha')
    await firstStore.rememberRepository('/repos/beta')

    const secondStore = new SettingsStore(settingsPath)
    const recent = await secondStore.getRecentRepositories()

    expect(recent.map((repo) => repo.path)).toEqual(['/repos/beta', '/repos/alpha'])
  })

  it('does not lose repositories under concurrent read-modify-write mutations', async () => {
    const settingsPath = createSettingsPath()
    const store = new SettingsStore(settingsPath)
    const repoPaths = Array.from({ length: 10 }, (_, index) => `/repos/project-${index}`)

    // Fire every mutation at once. Without serialization + atomic writes these
    // race on the shared file and silently drop entries — the disappearing-projects bug.
    await Promise.all([
      ...repoPaths.map((repoPath) => store.rememberRepository(repoPath)),
      store.setEditorSettings({ preference: 'vscode' }),
      store.setGitMonitorSettings({ enabled: true })
    ])

    const persisted = new SettingsStore(settingsPath)
    const recentPaths = (await persisted.getRecentRepositories()).map((repo) => repo.path)

    for (const repoPath of repoPaths) {
      expect(recentPaths).toContain(repoPath)
    }
    await expect(persisted.getGitMonitorSettings()).resolves.toMatchObject({ enabled: true })
  })

  it('leaves no temp file behind and always writes valid JSON', async () => {
    const settingsPath = createSettingsPath()
    const store = new SettingsStore(settingsPath)

    await store.rememberRepository('/repos/gamma')

    const directory = path.dirname(settingsPath)
    const leftovers = readdirSync(directory).filter((name) => name.endsWith('.tmp'))
    expect(leftovers).toEqual([])

    // The on-disk file must always be a complete, parseable document.
    expect(() => JSON.parse(readFileSync(settingsPath, 'utf8'))).not.toThrow()
  })

  it('recovers from a corrupt settings file without wiping data, keeping a backup', async () => {
    const settingsPath = createSettingsPath()
    const seedStore = new SettingsStore(settingsPath)
    await seedStore.rememberRepository('/repos/delta')

    // Simulate on-disk corruption (e.g. a truncated write from an old build).
    writeFileSync(settingsPath, '{ this is not valid json', 'utf8')

    // A fresh instance has no in-memory snapshot, so it recovers to defaults —
    // but preserves the corrupt bytes as a backup rather than silently deleting them.
    const recoveredStore = new SettingsStore(settingsPath)
    await recoveredStore.rememberRepository('/repos/epsilon')

    const recentPaths = (await recoveredStore.getRecentRepositories()).map((repo) => repo.path)
    expect(recentPaths).toContain('/repos/epsilon')

    const backups = readdirSync(path.dirname(settingsPath)).filter((name) => name.includes('.corrupt-'))
    expect(backups.length).toBeGreaterThan(0)
  })

  it('self-heals from its in-memory snapshot when the file is corrupted mid-session', async () => {
    const settingsPath = createSettingsPath()
    const store = new SettingsStore(settingsPath)
    await store.rememberRepository('/repos/one')
    await store.rememberRepository('/repos/two')

    // Corrupt the file after the store has a good snapshot cached.
    writeFileSync(settingsPath, 'not json at all', 'utf8')

    // The next mutation must rebuild from the cached snapshot, not from empty.
    await store.rememberRepository('/repos/three')

    const recentPaths = (await store.getRecentRepositories()).map((repo) => repo.path)
    expect(recentPaths).toEqual(['/repos/three', '/repos/two', '/repos/one'])
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
