import { RotateCcw, X } from 'lucide-react'
import { highlight } from '../../../lib/highlight'
import type { LiveLineChange } from './editorTypes'

interface LiveChangesPanelProps {
  liveChanges: LiveLineChange[]
  liveChangesStale: boolean
  editedLines: number
  selectedLang: string
  onClose: () => void
  focusLiveChange: (change: LiveLineChange) => void
  revertLiveChange: (change: LiveLineChange) => void
}

export function LiveChangesPanel({
  liveChanges,
  liveChangesStale,
  editedLines,
  selectedLang,
  onClose,
  focusLiveChange,
  revertLiveChange
}: LiveChangesPanelProps) {
  return (
    <aside className="changes-editor-live-diff" aria-label="Live file changes">
      <header>
        <strong>Live changes</strong>
        <span title={liveChangesStale ? 'Updating after typing settles' : undefined}>
          {liveChangesStale ? '...' : editedLines}
        </span>
        <button
          type="button"
          className="changes-editor-live-close"
          onClick={() => onClose()}
          title="Close live changes"
          aria-label="Close live changes"
        >
          <X size={14} />
        </button>
      </header>
      <div>
        {liveChanges.slice(0, 120).map((change, index) => (
          <article className={`changes-editor-live-row ${change.kind}`} key={`${index}-${change.lineNumber}-${change.kind}`}>
            <button
              type="button"
              className="changes-editor-live-jump"
              onClick={() => focusLiveChange(change)}
              title={`Go to line ${change.lineNumber}`}
              aria-label={`Go to changed line ${change.lineNumber}`}
            >
              <span>{change.lineNumber}</span>
              <code>{highlight(change.after || change.before || ' ', selectedLang)}</code>
            </button>
            <button
              type="button"
              className="changes-editor-live-revert"
              onClick={() => revertLiveChange(change)}
              title={change.kind === 'added' ? 'Remove this added line' : 'Revert this line'}
              aria-label={change.kind === 'added' ? `Remove added line ${change.lineNumber}` : `Revert line ${change.lineNumber}`}
            >
              <RotateCcw size={13} />
            </button>
            {change.kind === 'modified' && <small>{highlight(change.before || ' ', selectedLang)}</small>}
          </article>
        ))}
        {liveChanges.length > 120 && <p>{liveChanges.length - 120} more changed lines.</p>}
      </div>
    </aside>
  )
}
