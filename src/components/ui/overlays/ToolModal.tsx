import type { ReactNode } from 'react'
import { X } from 'lucide-react'

/** Lightweight modal overlay used to host the Review and Stash tools from the Changes view. */
export function ToolModal({
  title,
  onClose,
  className,
  children
}: {
  title: string
  onClose: () => void
  className?: string
  children: ReactNode
}) {
  return (
    <div className="tool-modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className={className ? `tool-modal ${className}` : 'tool-modal'}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="tool-modal-head">
          <h2>{title}</h2>
          <button className="icon-button" type="button" aria-label="Close" title="Close" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <div className="tool-modal-body">{children}</div>
      </div>
    </div>
  )
}
