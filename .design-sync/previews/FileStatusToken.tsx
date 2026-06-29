import { FileStatusToken } from 'branchpilot'

export const Modified = () => (
  <FileStatusToken status="modified" title="staged / unstaged" />
)

export const AllStatuses = () => (
  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
    <FileStatusToken status="modified" title="modified" />
    <FileStatusToken status="added" title="added" />
    <FileStatusToken status="deleted" title="deleted" />
    <FileStatusToken status="renamed" title="renamed" />
    <FileStatusToken status="copied" title="copied" />
    <FileStatusToken status="conflicted" title="conflict" />
    <FileStatusToken status="untracked" title="untracked" />
  </div>
)

export const InChangeRows = () => (
  <div style={{ display: 'grid', gap: 6, maxWidth: 360 }}>
    {[
      { path: 'src/hooks/useAppController.ts', status: 'modified' as const, label: 'staged' },
      { path: 'src/lib/mergeCandidates.ts', status: 'added' as const, label: 'staged' },
      { path: 'electron/preload.cts', status: 'deleted' as const, label: 'unstaged' },
      { path: 'src/components/MergeView.tsx', status: 'conflicted' as const, label: 'conflict' },
      { path: 'mockups/heatmap.png', status: 'untracked' as const, label: 'untracked' }
    ].map((change) => (
      <span
        key={change.path}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}
      >
        <span className="file-name">{change.path}</span>
        <FileStatusToken status={change.status} title={change.label} />
      </span>
    ))}
  </div>
)
