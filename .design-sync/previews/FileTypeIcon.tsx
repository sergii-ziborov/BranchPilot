import { FileTypeIcon } from 'branchpilot'

export const Default = () => <FileTypeIcon path="src/app.ts" />

export const LanguageMonograms = () => (
  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, maxWidth: 360 }}>
    <FileTypeIcon path="src/app.ts" />
    <FileTypeIcon path="electron/main.js" />
    <FileTypeIcon path="package.json" />
    <FileTypeIcon path="src/styles/app.css" />
    <FileTypeIcon path="README.md" />
    <FileTypeIcon path="go.mod" />
    <FileTypeIcon path="crates/core/src/lib.rs" />
    <FileTypeIcon path="scripts/deploy.unknownext" />
  </div>
)

export const WithFileNames = () => (
  <div style={{ display: 'grid', gap: 6, maxWidth: 360 }}>
    {[
      'src/hooks/useAppController.ts',
      'electron/preload.cts',
      'package-lock.json',
      '.gitignore',
      'Dockerfile',
      'docs/architecture.mdx'
    ].map((path) => (
      <span key={path} className="file-label">
        <FileTypeIcon path={path} />
        <span className="file-name">{path}</span>
      </span>
    ))}
  </div>
)
