import { ArrowDownToLine, ArrowUpFromLine, Check, Code2, GitBranch, GitMerge, Save, X } from 'lucide-react'
import type { ApiResult, BranchPilotApi, GitOperationResult, RepositorySnapshot } from '../../shared/branchPilot'
import { mergeBranchCandidates } from '../../lib/mergeCandidates'
import { IconButton } from '../IconButton'

export function MergeView({
  snapshot,
  busy,
  selectedMergeBranch,
  setSelectedMergeBranch,
  startMergeOperation,
  continueMergeOperation,
  abortCurrentOperation,
  createQuickStash,
  canCreateStash,
  acceptConflictSide,
  runOperationAction,
  runSnapshotAction,
  api,
  currentRepoPath
}: {
  snapshot: RepositorySnapshot | null
  busy: boolean
  selectedMergeBranch: string
  setSelectedMergeBranch: (value: string) => void
  startMergeOperation: (kind: 'merge' | 'rebase') => void | Promise<void>
  continueMergeOperation: () => void | Promise<void>
  abortCurrentOperation: () => void | Promise<void>
  createQuickStash: () => void | Promise<void>
  canCreateStash: boolean
  acceptConflictSide: (filePath: string, side: 'ours' | 'theirs') => void | Promise<void>
  runOperationAction: (label: string, action: () => Promise<ApiResult<GitOperationResult>>) => void | Promise<void>
  runSnapshotAction: (label: string, action: () => Promise<ApiResult<RepositorySnapshot>>) => boolean | void | Promise<boolean>
  api: BranchPilotApi | undefined
  currentRepoPath: string | undefined
}) {
  const mergeState = snapshot?.status.merge
  const counts = snapshot?.status.counts
  const hasOperation = mergeState && mergeState.operation !== 'none'
  const mergeCandidates = mergeBranchCandidates(snapshot)
  const hasDirtyWorktree = Boolean(counts?.changed)
  const canContinueOperation = Boolean(hasOperation && mergeState.files.length === 0)

    return (
    <section className="single-panel">
      <div className="panel-heading">
        <div>
          <h2>Merge window</h2>
          <p>
            {hasOperation
              ? `${mergeState.operation} in progress`
              : mergeState && mergeState.files.length > 0
                ? 'Conflicted files without an active operation (e.g. from a stash apply). Resolve and stage them below.'
                : 'No merge, rebase, or cherry-pick operation is active.'}
          </p>
        </div>
        <div className="panel-actions">
          <button type="button" disabled={!canContinueOperation || busy} onClick={continueMergeOperation}>
            <Check size={17} />
            Continue
          </button>
          <button
            className="danger-button"
            type="button"
            disabled={!hasOperation || busy}
            onClick={abortCurrentOperation}
          >
            <X size={17} />
            Abort
          </button>
        </div>
      </div>

      {!hasOperation && (
        <section className="merge-start">
          <div>
            <h3>Merge or rebase</h3>
            <p>Merge a local branch into {snapshot?.summary.currentBranch ?? 'the current branch'}, or rebase the current branch onto it.</p>
          </div>
          <select
            value={selectedMergeBranch}
            onChange={(event) => setSelectedMergeBranch(event.target.value)}
            disabled={busy || mergeCandidates.length === 0}
          >
            {mergeCandidates.length === 0 ? (
              <option value="">No branches available</option>
            ) : (
              mergeCandidates.map((branch) => (
                <option value={branch.name} key={branch.name}>
                  {branch.label}
                </option>
              ))
            )}
          </select>
          <button
            type="button"
            onClick={() => startMergeOperation('merge')}
            disabled={busy || !selectedMergeBranch || mergeCandidates.length === 0 || hasDirtyWorktree}
          >
            <GitMerge size={17} />
            Merge into {snapshot?.summary.currentBranch ?? 'current'}
          </button>
          <button
            type="button"
            onClick={() => startMergeOperation('rebase')}
            disabled={busy || !selectedMergeBranch || mergeCandidates.length === 0 || hasDirtyWorktree}
          >
            <GitBranch size={17} />
            Rebase current
          </button>
        </section>
      )}

      {!hasOperation && hasDirtyWorktree && (
        <div className="command-hint">
          Stash or commit local changes before starting a merge.
          <button type="button" onClick={createQuickStash} disabled={busy || !canCreateStash}>
            <Save size={17} />
            Stash changes
          </button>
        </div>
      )}

      {!mergeState || mergeState.files.length === 0 ? (
        <div className="quiet-box">Conflict list is empty.</div>
      ) : (
        <div className="conflict-list">
          {mergeState.files.map((file) => (
            <article className="conflict-row" key={file.path}>
              <div>
                <strong>{file.path}</strong>
                <span>{file.type}</span>
              </div>
              <div className="panel-actions">
                <IconButton icon={<Code2 size={17} />} label="Open in editor" disabled={busy} onClick={() => api && currentRepoPath && runOperationAction('Opened in editor.', () => api.openInEditor({ targetPath: `${currentRepoPath}/${file.path}` }))} />
                <IconButton icon={<ArrowDownToLine size={16} />} label="Accept ours" disabled={busy} onClick={() => acceptConflictSide(file.path, 'ours')} />
                <IconButton icon={<ArrowUpFromLine size={16} />} label="Accept theirs" disabled={busy} onClick={() => acceptConflictSide(file.path, 'theirs')} />
                <IconButton icon={<Check size={16} />} label="Mark resolved" disabled={busy} onClick={() => currentRepoPath && runSnapshotAction('Marked resolved.', () => api!.markResolved({ repoPath: currentRepoPath, filePath: file.path }))} />
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}
