import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('renderer confirmation UI', () => {
  it('uses the in-app confirmation dialog instead of system confirm prompts', () => {
    const appSource = readFileSync(path.join(process.cwd(), 'src/App.tsx'), 'utf8')

    expect(appSource).toContain('confirmation-dialog')
    expect(appSource).toContain('requestConfirmation')
    expect(appSource).not.toContain('window.confirm')
  })
})
