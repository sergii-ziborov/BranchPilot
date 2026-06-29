import type { ReactNode } from 'react'
import { Copy } from 'lucide-react'

const WRAPPER_CLASS = {
  snippet: 'memory-mcp-snippet',
  preview: 'project-wiki-preview'
} as const

/** Labeled monospace code panel with a header Copy action over a <pre> block. */
export function CopyableCodeBlock({
  title,
  code,
  onCopy,
  copyLabel = 'Copy',
  variant = 'snippet',
  copyDisabled = false
}: {
  title: ReactNode
  code: string
  onCopy?: () => void
  copyLabel?: string
  variant?: 'snippet' | 'preview'
  copyDisabled?: boolean
}) {
  return (
    <div className={WRAPPER_CLASS[variant]}>
      <div className="memory-section-heading compact">
        <h3>{title}</h3>
        <button type="button" disabled={copyDisabled} onClick={onCopy}>
          <Copy size={15} />
          {copyLabel}
        </button>
      </div>
      <pre><code>{code}</code></pre>
    </div>
  )
}
