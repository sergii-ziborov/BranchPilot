import { ArrowDownToLine, ArrowUpFromLine, DownloadCloud, FileCode2, FolderOpen, RefreshCcw, Terminal, UploadCloud } from 'lucide-react'
import type { ApiResult, BranchPilotApi, RepositorySnapshot } from '../shared/branchPilot'
import { IconButton } from './IconButton'

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
        <IconButton icon={<FolderOpen size={17} />} label="Open repository in editor" onClick={openRepoInEditor} disabled={!snapshot || busy} />
        <IconButton icon={<FileCode2 size={17} />} label="Open selected file in editor" onClick={openSelectedFileInEditor} disabled={!selectedFileTarget || busy} />
        <IconButton icon={<Terminal size={17} />} label="Open terminal" onClick={openRepositoryTerminal} disabled={!snapshot || busy} />
        <IconButton icon={<RefreshCcw size={17} />} label="Refresh repository" onClick={() => refreshRepository()} disabled={!snapshot || busy} />
        <IconButton
          icon={<ArrowDownToLine size={17} />}
          label="Fetch"
          onClick={() => currentRepoPath && runSnapshotAction('Fetch complete.', () => api!.fetch(currentRepoPath), 'Fetching origin...')}
          disabled={!canFetch || busy}
        />
        <IconButton
          icon={<DownloadCloud size={17} />}
          label="Pull"
          onClick={() => currentRepoPath && runSnapshotAction('Pull complete.', () => api!.pull(currentRepoPath), 'Pulling origin...')}
          disabled={!canPull || busy}
        />
        <IconButton
          icon={<ArrowUpFromLine size={17} />}
          label="Push"
          onClick={() => currentRepoPath && runSnapshotAction('Push complete.', () => api!.push(currentRepoPath), 'Pushing origin...')}
          disabled={!canPush || busy}
        />
        {canPublishBranch && snapshot && (
          <IconButton
            icon={<UploadCloud size={17} />}
            label="Publish branch"
            onClick={() => currentRepoPath && runSnapshotAction('Branch published.', () => api!.publishBranch({
              repoPath: currentRepoPath,
              remote: snapshot.summary.remoteName
            }))}
            disabled={!snapshot || busy}
          />
        )}
      </div>
    </header>
  )
}
