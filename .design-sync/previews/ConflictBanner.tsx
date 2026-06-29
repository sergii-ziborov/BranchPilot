import { ConflictBanner } from 'branchpilot'

const noop = () => {}

export const Merge = () => (
  <ConflictBanner operation="merge" conflictedCount={3} busy={false} onResolve={noop} onAbort={noop} />
)

export const Rebase = () => (
  <ConflictBanner operation="rebase" conflictedCount={1} busy={false} onResolve={noop} onAbort={noop} />
)

export const CherryPick = () => (
  <ConflictBanner operation="cherry-pick" conflictedCount={2} busy={false} onResolve={noop} onAbort={noop} />
)

export const Resolving = () => (
  <ConflictBanner operation="merge" conflictedCount={0} busy onResolve={noop} onAbort={noop} />
)
