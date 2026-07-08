import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement, type ReactNode } from 'react'
import { highlight } from '../src/lib/highlight'

function markup(node: ReactNode): string {
  return renderToStaticMarkup(createElement('span', null, node))
}

describe('highlight memoization', () => {
  it('returns the identical cached node for repeated (code, lang)', () => {
    const first = highlight('const x = 1', 'ts')
    const second = highlight('const x = 1', 'ts')
    // Cache hit returns the same reference — no re-tokenization on re-render.
    expect(second).toBe(first)
  })

  it('keys the cache by language, not just code', () => {
    const asTs = highlight('class Foo', 'ts')
    const asPlain = highlight('class Foo', '')
    expect(asTs).not.toBe(asPlain)
  })

  it('preserves the rendered output (memoization is transparent)', () => {
    const tokens = markup(highlight('const total = 42', 'ts'))
    expect(tokens).toContain('tok-keyword')
    expect(tokens).toContain('tok-number')
    expect(tokens).toContain('total')
    // Re-highlighting the same input renders identical markup.
    expect(markup(highlight('const total = 42', 'ts'))).toBe(tokens)
  })

  it('returns empty input unchanged', () => {
    expect(highlight('', 'ts')).toBe('')
  })

  it('highlights json and markdown through their dedicated paths', () => {
    expect(markup(highlight('{"a": 1}', 'json'))).toContain('tok-')
    expect(markup(highlight('# Heading', 'md'))).toBeTruthy()
  })
})
