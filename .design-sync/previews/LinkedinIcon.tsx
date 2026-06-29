import { LinkedinIcon } from 'branchpilot'

export const Default = () => <LinkedinIcon size={24} />

// Drawn with fill: currentColor, so it inherits text color.
export const Colors = () => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 22 }}>
    <span style={{ color: '#0a66c2' }}><LinkedinIcon size={28} /></span>
    <span style={{ color: 'var(--text)' }}><LinkedinIcon size={28} /></span>
    <span style={{ color: 'var(--accent)' }}><LinkedinIcon size={28} /></span>
  </div>
)
