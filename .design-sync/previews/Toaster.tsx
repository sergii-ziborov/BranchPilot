import type { ReactNode } from 'react'
import { Toaster } from 'branchpilot'

const noop = () => {}

// Toaster renders a position:fixed stack pinned to the bottom-right of the
// viewport. In a design-system card that escapes the cell, so we re-anchor the
// stack to `absolute` within this relative Stage — same visual (bottom-right
// of the surface), but contained in the card. Only the position is adjusted;
// the toasts, their styling, and the component are the real shipped ones.
function Stage({ children }: { children: ReactNode }) {
  return (
    <div
      className="ds-toast-stage"
      style={{
        position: 'relative',
        minHeight: 104,
        background: 'var(--panel-2)',
        border: '1px solid var(--border)',
        borderRadius: 8,
      }}
    >
      <style>{`.ds-toast-stage .toast-stack { position: absolute; z-index: 1; }`}</style>
      {children}
    </div>
  )
}

export const Busy = () => (
  <Stage>
    <Toaster notice="" busy operationLabel="Pushing to origin…" error={null} onDismissError={noop} />
  </Stage>
)

export const Success = () => (
  <Stage>
    <Toaster notice="Committed 4 files to main" busy={false} operationLabel={null} error={null} onDismissError={noop} />
  </Stage>
)

export const ErrorToast = () => (
  <Stage>
    <Toaster
      notice=""
      busy={false}
      operationLabel={null}
      error="Push failed: remote contains work you do not have locally."
      onDismissError={noop}
    />
  </Stage>
)
