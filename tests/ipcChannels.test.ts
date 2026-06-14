import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { BRANCH_PILOT_IPC_CHANNELS, isBranchPilotIpcChannel } from '../src/shared/ipcChannels'

const ipcCallPattern = /\b(?:invoke|handle|handleLogged|handleAssistantAction|handleUnwrapped)\('([^']+)'/g

describe('BranchPilot IPC channels', () => {
  it('keeps a unique explicit allowlist', () => {
    expect(new Set(BRANCH_PILOT_IPC_CHANNELS).size).toBe(BRANCH_PILOT_IPC_CHANNELS.length)
    expect(BRANCH_PILOT_IPC_CHANNELS.every((channel) => /^[a-z]+:[A-Za-z0-9]+$/.test(channel))).toBe(true)
  })

  it('accepts only registered BranchPilot channels', () => {
    expect(isBranchPilotIpcChannel('repository:open')).toBe(true)
    expect(isBranchPilotIpcChannel('repository:open:extra')).toBe(false)
    expect(isBranchPilotIpcChannel('shell:run')).toBe(false)
  })

  it('keeps main and preload IPC usage inside the allowlist', () => {
    const allowlist = new Set<string>(BRANCH_PILOT_IPC_CHANNELS)
    // IPC handlers are registered across the modules under electron/ipc/handlers/.
    const mainChannels = collectIpcChannels(tsFilesIn('electron/ipc/handlers'))
    const preloadChannels = collectIpcChannels(['electron/preload.cts'])

    expect(mainChannels).toEqual(preloadChannels)
    expect([...mainChannels].filter((channel) => !allowlist.has(channel))).toEqual([])
    expect([...preloadChannels].filter((channel) => !allowlist.has(channel))).toEqual([])
    expect([...allowlist].filter((channel) => !mainChannels.has(channel))).toEqual([])
  })
})

function tsFilesIn(dir: string): string[] {
  return readdirSync(path.join(process.cwd(), dir))
    .filter((name) => name.endsWith('.ts'))
    .map((name) => path.join(dir, name))
}

function collectIpcChannels(filePaths: string[]): Set<string> {
  const channels = new Set<string>()

  for (const filePath of filePaths) {
    const source = readFileSync(path.join(process.cwd(), filePath), 'utf8')

    for (let match = ipcCallPattern.exec(source); match; match = ipcCallPattern.exec(source)) {
      channels.add(match[1])
    }

    ipcCallPattern.lastIndex = 0
  }

  return channels
}
