import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

describe('App smoke', () => {
  it('mounts the full renderer tree (sidebar, views, dialogs) without crashing', async () => {
    // The renderer reads the desktop bridge from window.branchPilot at module load.
    // Stub it before importing App so the aggregating controller + every hook mount.
    ;(globalThis as unknown as { window: unknown }).window = { branchPilot: undefined }

    const { default: App } = await import('../src/App')
    const html = renderToStaticMarkup(<App />)

    expect(html).toContain('app-shell')
    expect(html).toContain('shell-bar')
    expect(html).toContain('shell-tab')
    expect(html.length).toBeGreaterThan(500)
  })
})
