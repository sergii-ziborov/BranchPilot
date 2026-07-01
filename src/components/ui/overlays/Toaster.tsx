import { useEffect, useState } from 'react'
import { X } from 'lucide-react'

const NOTICE_TTL_MS = 4000

function noticeTone(message: string): 'info' | 'warning' {
  const normalized = message.toLowerCase()
  return /\b(blocked|failed|failure|not available|could not|cancelled|canceled)\b/.test(normalized)
    ? 'warning'
    : 'info'
}

/** Transient bottom-right toasts: only local notices auto-dismiss; operation progress lives in the active panel. */
export function Toaster({
  notice,
  busy,
  error,
  onDismissError
}: {
  notice: string
  busy: boolean
  operationLabel: string | null
  error: string | null
  onDismissError: () => void
}) {
  const [visibleNotice, setVisibleNotice] = useState<string | null>(null)

  useEffect(() => {
    if (busy || error || !notice || !shouldShowNoticeToast(notice)) {
      setVisibleNotice(null)
      return
    }
    setVisibleNotice(notice)
    const timer = setTimeout(() => setVisibleNotice(null), NOTICE_TTL_MS)
    return () => clearTimeout(timer)
  }, [notice, busy, error])

  return (
    <div className="toast-stack" aria-live="polite">
      {!busy && visibleNotice && (() => {
        const tone = noticeTone(visibleNotice)

        return (
          <div className={`toast toast-${tone} signal-status signal-status-${tone} signal-status-compact`} role={tone === 'warning' ? 'alert' : 'status'}>
            <div className="signal-status-copy">
              <span>{visibleNotice}</span>
            </div>
          </div>
        )
      })()}
      {error && (
        <div className="toast toast-error signal-status signal-status-error signal-status-compact" role="alert">
          <div className="signal-status-copy">
            <strong>Error</strong>
            <span>{error}</span>
          </div>
          <button type="button" aria-label="Dismiss error" onClick={onDismissError}>
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  )
}

function shouldShowNoticeToast(message: string): boolean {
  const normalized = message.toLowerCase()
  return !(
    /\bgenerated\b/.test(normalized) ||
    /\breview complete\b/.test(normalized) ||
    /\bcss color updated\b/.test(normalized)
  )
}
