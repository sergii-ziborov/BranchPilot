import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { PanelHeading } from '../src/components/PanelHeading'

describe('PanelHeading', () => {
  it('renders title, description and action children', () => {
    const html = renderToStaticMarkup(
      <PanelHeading title="Stash" description="Store work"><button>Refresh</button></PanelHeading>
    )
    expect(html).toContain('class="panel-heading"')
    expect(html).toContain('<h2>Stash</h2>')
    expect(html).toContain('<p>Store work</p>')
    expect(html).toContain('<button>Refresh</button>')
  })

  it('omits the description and supports the compact variant', () => {
    const html = renderToStaticMarkup(<PanelHeading title="Daily" compact />)
    expect(html).toContain('panel-heading compact-heading')
    expect(html).not.toContain('<p>')
  })
})
