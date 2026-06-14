import { useEffect, useState } from 'react'
import { Check, FileWarning, Loader2, X } from 'lucide-react'

const NOTICE_TTL_MS = 4000

/** Transient bottom-right toasts: success notices auto-dismiss; busy + errors persist. */
export function Toaster({
  notice,
  busy,
  operationLabel,
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
    if (busy || !notice) return
    setVisibleNotice(notice)
    const timer = setTimeout(() => setVisibleNotice(null), NOTICE_TTL_MS)
    return () => clearTimeout(timer)
  }, [notice, busy])

  return (
    <div className="toast-stack" aria-live="polite">
      {busy && (
        <div className="toast toast-busy">
          <Loader2 className="spin" size={17} />
          <span>{operationLabel ?? 'Working…'}</span>
        </div>
      )}
      {!busy && visibleNotice && (
        <div className="toast toast-info">
          <Check size={17} />
          <span>{visibleNotice}</span>
        </div>
      )}
      {error && (
        <div className="toast toast-error" role="alert">
          <FileWarning size={17} />
          <span>{error}</span>
          <button type="button" aria-label="Dismiss error" onClick={onDismissError}>
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  )
}
