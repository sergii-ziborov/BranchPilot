import { ArrowDownToLine, ArrowUpFromLine, Code2, RefreshCcw, Terminal, UploadCloud } from 'lucide-react'
import type { ApiResult, BranchPilotApi, RepositorySnapshot } from '../shared/branchPilot'

/** Workspace header: branch/sync summary and the repository action toolbar. */
export function AppTopbar({
  snapshot,
  hasRemote,
  busy,
  selectedFileTarget,
  canFetch,
  canPull,
  canPush,
  canPublishBranch,
  currentRepoPath,
  api,
  runSnapshotAction,
  openRepoInEditor,
  openSelectedFileInEditor,
  openRepositoryTerminal,
  refreshRepository
}: {
  snapshot: RepositorySnapshot | null
  hasRemote: boolean
  busy: boolean
  selectedFileTarget: string | null
  canFetch: boolean
  canPull: boolean
  canPush: boolean
  canPublishBranch: boolean
  currentRepoPath: string | undefined
  api: BranchPilotApi | undefined
  runSnapshotAction: (label: string, action: () => Promise<ApiResult<RepositorySnapshot>>, progressLabel?: string) => Promise<boolean>
  openRepoInEditor: () => void | Promise<void>
  openSelectedFileInEditor: () => void | Promise<void>
  openRepositoryTerminal: () => void | Promise<void>
  refreshRepository: () => void | Promise<void>
}) {
  return (
    <header className="topbar">
      <div>
        <p className="eyebrow">Repository workspace</p>
        <h1>{snapshot?.summary.currentBranch ?? 'No repository selected'}</h1>
        <p className="repo-path">{snapshot?.summary.rootPath ?? 'Open a Git repository to inspect real changes.'}</p>
        {snapshot && (
          <div className="repo-meta" aria-label="Repository sync state">
            <span>{snapshot.summary.isDetached ? 'Detached HEAD' : snapshot.summary.upstream ?? 'No upstream'}</span>
            <span>{hasRemote ? `Remote: ${snapshot.summary.remoteName}` : 'No remote'}</span>
            <span>{snapshot.summary.ahead} ahead</span>
            <span>{snapshot.summary.behind} behind</span>
          </div>
        )}
      </div>
      <div className="toolbar" aria-label="Repository actions">
        <button type="button" onClick={openRepoInEditor} disabled={!snapshot || busy}>
          <Code2 size={17} />
          Open repo
        </button>
        <button type="button" onClick={openSelectedFileInEditor} disabled={!selectedFileTarget || busy}>
          <Code2 size={17} />
          Open file
        </button>
        <button type="button" onClick={openRepositoryTerminal} disabled={!snapshot || busy}>
          <Terminal size={17} />
          Terminal
        </button>
        <button type="button" onClick={() => refreshRepository()} disabled={!snapshot || busy}>
          <RefreshCcw size={17} />
          Refresh
        </button>
        <button
          type="button"
          onClick={() => currentRepoPath && runSnapshotAction('Fetch complete.', () => api!.fetch(currentRepoPath))}
          disabled={!canFetch || busy}
        >
          <ArrowDownToLine size={17} />
          Fetch
        </button>
        <button
          type="button"
          onClick={() => currentRepoPath && runSnapshotAction('Pull complete.', () => api!.pull(currentRepoPath))}
          disabled={!canPull || busy}
        >
          <ArrowDownToLine size={17} />
          Pull
        </button>
        <button
          type="button"
          onClick={() => currentRepoPath && runSnapshotAction('Push complete.', () => api!.push(currentRepoPath))}
          disabled={!canPush || busy}
        >
          <ArrowUpFromLine size={17} />
          Push
        </button>
        {canPublishBranch && snapshot && (
          <button
            type="button"
            onClick={() => currentRepoPath && runSnapshotAction('Branch published.', () => api!.publishBranch({
              repoPath: currentRepoPath,
              remote: snapshot.summary.remoteName
            }))}
            disabled={!snapshot || busy}
          >
            <UploadCloud size={17} />
            Publish branch
          </button>
        )}
      </div>
    </header>
  )
}
