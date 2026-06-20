import { ArrowLeft } from 'lucide-react'

/** Compact "back to Changes" control for the heading of secondary (tool) views. */
export function BackToChanges({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="back-to-changes" onClick={onClick} title="Back to Changes" aria-label="Back to Changes">
      <ArrowLeft size={15} />
      Changes
    </button>
  )
}
