import { ArrowDownToLine, ArrowUpFromLine, ChevronDown, DownloadCloud, UploadCloud } from 'lucide-react'
import { useController } from '../../hooks/AppControllerContext'

/** Sync split button: fetch/pull/push primary action picked GitHub-Desktop style,
 *  with a caret menu for the remaining remote actions (incl. force push / publish). */
export function ShellSyncControls({
  onOpenPublishRepository,
  handleToggle,
  closeMenu
}: {
  onOpenPublishRepository: () => void
  handleToggle: (event: { currentTarget: HTMLDetailsElement }) => void
  closeMenu: (event: { currentTarget: HTMLElement }) => void
}) {
  const {
    snapshot, busy, currentRepoPath, hasRemote, canFetch, canPull, canPush,
    runSnapshotAction, requestConfirmation
  } = useController()
  const api = window.branchPilot
  const currentBranch = snapshot?.summary.currentBranch ?? null
  const hasChanges = (snapshot?.status.counts.changed ?? 0) > 0

  const ahead = snapshot?.summary.ahead ?? 0
  const behind = snapshot?.summary.behind ?? 0
  const doFetch = () => { if (currentRepoPath) void runSnapshotAction('Fetch complete.', () => api!.fetch(currentRepoPath), 'Fetching origin...') }
  const doPull = () => { if (currentRepoPath) void runSnapshotAction('Pull complete.', () => api!.pull(currentRepoPath), 'Pulling origin...') }
  const doPush = () => { if (currentRepoPath) void runSnapshotAction('Push complete.', () => api!.push(currentRepoPath), 'Pushing origin...') }
  const doForcePush = async () => {
    if (!currentRepoPath) return
    const confirmed = await requestConfirmation(
      `Force push ${currentBranch ?? 'the current branch'} with lease? This can rewrite the remote branch if it still points to the value you last fetched.`,
      { title: 'Force Push', confirmLabel: 'Force push with lease', variant: 'danger' }
    )
    if (!confirmed) return
    void runSnapshotAction('Force push complete.', () => api!.forcePush({ repoPath: currentRepoPath, confirmed }), 'Force pushing with lease...')
  }
  const doPublishRepository = () => { if (snapshot) onOpenPublishRepository() }
  // GitHub-Desktop priority: pull what's behind first, then push what's ahead, else fetch.
  const remotePrimary = behind > 0
    ? { label: `Pull origin (${behind})`, Icon: DownloadCloud, run: doPull, disabled: !canPull || busy, hint: hasChanges ? 'Pull origin — uncommitted changes will be stashed first if needed' : 'Pull origin' }
    : ahead > 0
      ? { label: `Push origin (${ahead})`, Icon: ArrowUpFromLine, run: doPush, disabled: !canPush || busy, hint: 'Push origin' }
      : { label: 'Fetch origin', Icon: ArrowDownToLine, run: doFetch, disabled: !canFetch || busy, hint: hasRemote ? 'Fetch origin' : 'No remote configured' }
  const primary = hasRemote
    ? remotePrimary
    : { label: 'Publish repository', Icon: UploadCloud, run: doPublishRepository, disabled: !snapshot || busy, hint: 'Create a GitHub repository and add origin' }

  return (
    <div className="shell-sync-split">
      <button className="shell-sync-primary" type="button" disabled={primary.disabled} title={primary.hint} onClick={primary.run}>
        <primary.Icon size={16} />
        <span>{primary.label}</span>
        {hasRemote && snapshot && (ahead > 0 || behind > 0) && (
          <span className="shell-aheadbehind" title="Commits ahead / behind upstream">
            <ArrowUpFromLine size={12} />{ahead}
            <ArrowDownToLine size={12} />{behind}
          </span>
        )}
      </button>
      <details className="shell-menu shell-sync-menu" onToggle={handleToggle}>
        <summary className="shell-sync-caret" title="More sync actions"><ChevronDown size={14} /></summary>
        <div className="shell-dropdown shell-dropdown-right">
          {!hasRemote && (
            <button className="shell-dropdown-primary shell-dropdown-top" type="button" disabled={!snapshot || busy} onClick={(event) => { closeMenu(event); doPublishRepository() }}>
              <UploadCloud size={15} />
              Publish repository...
            </button>
          )}
          <button className="shell-dropdown-primary shell-dropdown-top" type="button" disabled={!canFetch || busy} onClick={(event) => { closeMenu(event); doFetch() }}>
            <ArrowDownToLine size={15} />
            Fetch origin
          </button>
          <button className="shell-dropdown-primary" type="button" disabled={!canPull || busy} onClick={(event) => { closeMenu(event); doPull() }}>
            <DownloadCloud size={15} />
            Pull{behind > 0 ? ` (${behind})` : ''}
          </button>
          <button className="shell-dropdown-primary" type="button" disabled={!canPush || busy} onClick={(event) => { closeMenu(event); doPush() }}>
            <ArrowUpFromLine size={15} />
            Push{ahead > 0 ? ` (${ahead})` : ''}
          </button>
          <button className="shell-dropdown-primary danger" type="button" disabled={!canPush || busy} onClick={(event) => { closeMenu(event); void doForcePush() }}>
            <UploadCloud size={15} />
            Force push with lease
          </button>
        </div>
      </details>
    </div>
  )
}
