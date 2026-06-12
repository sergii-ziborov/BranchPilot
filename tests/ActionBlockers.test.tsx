import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ActionBlockers } from '../src/components/ActionBlockers'

describe('ActionBlockers', () => {
  it('renders a ready state with no reasons', () => {
    const html = renderToStaticMarkup(<ActionBlockers title="Commit" reasons={[]} />)
    expect(html).toContain('action-blockers ready')
    expect(html).toContain('<strong>Commit</strong>')
    expect(html).toContain('All required preconditions are satisfied.')
    expect(html).not.toContain('<ul>')
  })

  it('renders a blocked state listing each reason', () => {
    const html = renderToStaticMarkup(<ActionBlockers title="Push" reasons={['No upstream', 'Dirty tree']} />)
    expect(html).toContain('action-blockers blocked')
    expect(html).toContain('<li>No upstream</li>')
    expect(html).toContain('<li>Dirty tree</li>')
    expect(html).not.toContain('All required preconditions are satisfied.')
  })
})
