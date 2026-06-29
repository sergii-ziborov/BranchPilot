import { StageCheckbox } from 'branchpilot'

const noop = () => {}

type Change = {
  path: string
  status: string
  staged: boolean
  unstaged: boolean
  untracked: boolean
  conflicted: boolean
}

const mk = (over: Partial<Change> & { path: string }): Change => ({
  status: 'modified',
  staged: false,
  unstaged: true,
  untracked: false,
  conflicted: false,
  ...over,
})

function Row({ change, hint }: { change: Change; hint: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 0' }}>
      <StageCheckbox change={change} disabled={false} onToggle={noop} />
      <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--text)' }}>{change.path}</span>
      <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--muted)' }}>{hint}</span>
    </div>
  )
}

export const States = () => (
  <div style={{ display: 'grid', gap: 2, maxWidth: 420 }}>
    <Row change={mk({ path: 'src/index.css', staged: true, unstaged: false })} hint="staged" />
    <Row change={mk({ path: 'src/App.tsx' })} hint="unstaged" />
    <Row change={mk({ path: 'src/main.tsx', staged: true, unstaged: true })} hint="partially staged" />
    <Row change={mk({ path: 'README.md', status: 'conflicted', staged: false, conflicted: true })} hint="conflicted" />
  </div>
)
