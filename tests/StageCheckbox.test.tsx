import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { BulkStageCheckbox, StageCheckbox } from '../src/components/StageCheckbox'
import { getBulkStageToggleState } from '../src/shared/changeStaging'
import type { FileChange, RepositoryCounts } from '../src/shared/branchPilot'

function makeChange(overrides: Partial<FileChange> = {}): FileChange {
  return {
    path: 'src/app.ts',
    status: 'modified',
    staged: false,
    unstaged: false,
    untracked: false,
    conflicted: false,
    ...overrides
  }
}

function makeCounts(overrides: Partial<RepositoryCounts> = {}): RepositoryCounts {
  return { changed: 0, staged: 0, unstaged: 0, untracked: 0, ...overrides } as RepositoryCounts
}

describe('StageCheckbox', () => {
  it('renders a checked checkbox for a fully staged file', () => {
    const html = renderToStaticMarkup(<StageCheckbox change={makeChange({ staged: true })} disabled={false} onToggle={() => {}} />)
    expect(html).toContain('class="change-stage-toggle"')
    expect(html).toContain('type="checkbox"')
    expect(html).toContain('checked')
  })

  it('warns about conflicts via the title attribute', () => {
    const html = renderToStaticMarkup(<StageCheckbox change={makeChange({ conflicted: true })} disabled={false} onToggle={() => {}} />)
    expect(html).toContain('Resolve conflicts before staging.')
  })

  it('honours the disabled prop', () => {
    const html = renderToStaticMarkup(<StageCheckbox change={makeChange({ unstaged: true })} disabled onToggle={() => {}} />)
    expect(html).toContain('disabled')
  })
})

describe('BulkStageCheckbox', () => {
  it('renders the changed-file count label', () => {
    const state = getBulkStageToggleState(makeCounts({ changed: 3, unstaged: 3 }))
    const html = renderToStaticMarkup(<BulkStageCheckbox state={state} disabled={false} changedCount={3} onToggle={() => {}} />)
    expect(html).toContain('class="bulk-stage-toggle"')
    expect(html).toContain('3 changed files')
  })

  it('uses the singular label for one file', () => {
    const state = getBulkStageToggleState(makeCounts({ changed: 1, unstaged: 1 }))
    const html = renderToStaticMarkup(<BulkStageCheckbox state={state} disabled={false} changedCount={1} onToggle={() => {}} />)
    expect(html).toContain('1 changed file')
  })
})
