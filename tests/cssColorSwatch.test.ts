import { describe, expect, it } from 'vitest'
import { openCssColorPicker } from '../src/components/diff/CssColorSwatch'

describe('openCssColorPicker', () => {
  it('uses the native picker API when available', () => {
    const calls: string[] = []
    const input = {
      showPicker: () => calls.push('showPicker'),
      click: () => calls.push('click')
    } as unknown as HTMLInputElement

    openCssColorPicker(input)

    expect(calls).toEqual(['showPicker'])
  })

  it('falls back to click when the native picker API rejects', () => {
    const calls: string[] = []
    const input = {
      showPicker: () => {
        calls.push('showPicker')
        throw new Error('picker unavailable')
      },
      click: () => calls.push('click')
    } as unknown as HTMLInputElement

    openCssColorPicker(input)

    expect(calls).toEqual(['showPicker', 'click'])
  })
})
