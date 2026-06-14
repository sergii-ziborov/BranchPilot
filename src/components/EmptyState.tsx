import { ArrowDownToLine, FolderOpen } from 'lucide-react'

/** Shown when no repository is open: open-folder prompt and clone panel. */
export function EmptyState({
  apiReady,
  busy,
  chooseRepository,
  cloneRemoteUrl,
  setCloneRemoteUrl,
  cloneTargetName,
  setCloneTargetName,
  cloneRepository
}: {
  apiReady: boolean
  busy: boolean
  chooseRepository: () => void | Promise<void>
  cloneRemoteUrl: string
  setCloneRemoteUrl: (value: string) => void
  cloneTargetName: string
  setCloneTargetName: (value: string) => void
  cloneRepository: () => void | Promise<void>
}) {
  return (
    <section className="empty-state">
      <FolderOpen size={42} />
      <h2>Open a local Git repository</h2>
      <p>BranchPilot will read status, diffs, branches, merge state, and local Git configuration.</p>
      <button type="button" onClick={chooseRepository} disabled={!apiReady || busy}>
        <FolderOpen size={17} />
        Open repository
      </button>
      <div className="clone-panel">
        <div>
          <strong>Clone repository</strong>
          <span>Use system Git and your existing credentials.</span>
        </div>
        <input
          aria-label="Clone repository URL"
          value={cloneRemoteUrl}
          onChange={(event) => setCloneRemoteUrl(event.target.value)}
          placeholder="https://github.com/owner/repo.git"
          disabled={!apiReady || busy}
        />
        <input
          aria-label="Clone folder name"
          value={cloneTargetName}
          onChange={(event) => setCloneTargetName(event.target.value)}
          placeholder="Optional folder name"
          disabled={!apiReady || busy}
        />
        <button type="button" onClick={cloneRepository} disabled={!apiReady || busy || !cloneRemoteUrl.trim()}>
          <ArrowDownToLine size={17} />
          Clone
        </button>
      </div>
    </section>
  )
}
