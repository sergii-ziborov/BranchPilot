import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { InfoRow, Stat } from '../src/components/primitives'

describe('Stat', () => {
  it('renders the label and value inside a stat tile', () => {
    const html = renderToStaticMarkup(<Stat label="Commits" value={42} />)
    expect(html).toBe('<div class="stat-tile tone-neutral"><span>Commits</span><strong>42</strong></div>')
  })

  it('renders string values', () => {
    const html = renderToStaticMarkup(<Stat label="Branch" value="main" />)
    expect(html).toContain('<strong>main</strong>')
  })
})

describe('InfoRow', () => {
  it('renders the label and value inside an info row', () => {
    const html = renderToStaticMarkup(<InfoRow label="Remote" value="origin" />)
    expect(html).toBe('<div class="info-row"><span>Remote</span><strong>origin</strong></div>')
  })
})
