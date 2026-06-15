import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Archive, ChevronDown, ChevronUp, ShieldCheck } from 'lucide-react'

/**
 * Hosts the Changes 2-pane plus a collapsible bottom drawer that folds in the
 * former Stash and Review tabs. The drawer is closed by default so the commit
 * workflow keeps full height on laptop screens.
 */
export function ChangesWorkspace({
  changes,
  stash,
  review,
  forceReviewOpen,
  onOpenStash
}: {
  changes: ReactNode
  stash: ReactNode
  review: ReactNode
  forceReviewOpen: boolean
  onOpenStash?: () => void
}) {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<'review' | 'stash'>('review')
  const stashLoadedRef = useRef(false)

  useEffect(() => {
    if (forceReviewOpen) {
      setTab('review')
      setOpen(true)
    }
  }, [forceReviewOpen])

  const openStash = () => {
    setTab('stash')
    setOpen(true)
    if (!stashLoadedRef.current) {
      stashLoadedRef.current = true
      onOpenStash?.()
    }
  }

  return (
    <div className={open ? 'changes-workspace-wrap drawer-open' : 'changes-workspace-wrap'}>
      <div className="changes-workspace-main">{changes}</div>
      <div className="changes-drawer">
        <div className="changes-drawer-bar">
          <button
            type="button"
            className="changes-drawer-toggle"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? <ChevronDown size={15} /> : <ChevronUp size={15} />}
            Tools
          </button>
          <div className="changes-drawer-tabs" role="tablist" aria-label="Changes tools">
            <button
              type="button"
              role="tab"
              aria-selected={open && tab === 'review'}
              className={open && tab === 'review' ? 'active' : ''}
              onClick={() => {
                setTab('review')
                setOpen(true)
              }}
            >
              <ShieldCheck size={14} />
              Review
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={open && tab === 'stash'}
              className={open && tab === 'stash' ? 'active' : ''}
              onClick={openStash}
            >
              <Archive size={14} />
              Stashes
            </button>
          </div>
        </div>
        {open && <div className="changes-drawer-body">{tab === 'stash' ? stash : review}</div>}
      </div>
    </div>
  )
}
