import { ArrowDownToLine, FolderOpen, GitBranch, GitCommitHorizontal, ShieldCheck } from 'lucide-react'
import { BranchPilotMark } from './BrandIcons'
import { RepositoryLoadingScene } from './RepositoryLoadingScene'

export function RepositoryLoadingState({ operationLabel }: { operationLabel: string | null }) {
  return (
    <section className="repository-loading-state" aria-busy="true" aria-live="polite">
      <RepositoryLoadingScene className="repository-loading-scene" />
      <div className="repository-loading-inner">
        <span className="repository-loading-brand">
          <BranchPilotMark size={56} />
        </span>

        <div className="repository-loading-copy">
          <p className="eyebrow">BranchPilot</p>
          <h2>{operationLabel ?? 'Loading repository...'}</h2>
          <p>Preparing working tree, branch, and diff data.</p>
        </div>
      </div>
    </section>
  )
}

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
      <div className="empty-state-hero">
        <span className="empty-state-icon empty-state-brand">
          <BranchPilotMark size={48} />
        </span>
        <p className="eyebrow">BranchPilot</p>
        <h2>Open a Git repository</h2>
        <p>A local-first Git client with AI drafts, safe sync, and pull-request tools. Choose a local repository or clone one from a remote URL.</p>
        <button className="empty-primary-action" type="button" onClick={chooseRepository} disabled={!apiReady || busy}>
          <FolderOpen size={17} />
          Open repository
        </button>
        <div className="empty-state-tags" aria-label="Available workflows">
          <span><GitCommitHorizontal size={14} />Changes</span>
          <span><GitBranch size={14} />Branches</span>
          <span><ShieldCheck size={14} />Review</span>
        </div>
      </div>
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
