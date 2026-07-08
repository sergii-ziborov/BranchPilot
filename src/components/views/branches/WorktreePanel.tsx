import { Code2, FolderOpen, Trash2 } from 'lucide-react'
import type {
  ApiResult, BranchPilotApi, BranchSummary, GitOperationResult,
  RemoteBranchSummary, RepositorySnapshot, WorktreeSummary
} from '../../../shared/branchPilot'
import { worktreeSummaryLabel } from '../../../lib/gitEntityLabels'

export function WorktreePanel({
  worktrees, branches, remoteBranches, snapshot, api, busy,
  newWorktreeBranchName, setNewWorktreeBranchName, newWorktreeBaseRef, setNewWorktreeBaseRef,
  createWorktree, openWorktree, removeWorktree, runOperationAction
}: {
  worktrees: WorktreeSummary[]
  branches: BranchSummary[]
  remoteBranches: RemoteBranchSummary[]
  snapshot: RepositorySnapshot | null
  api: BranchPilotApi | undefined
  busy: boolean
  newWorktreeBranchName: string
  setNewWorktreeBranchName: (value: string) => void
  newWorktreeBaseRef: string
  setNewWorktreeBaseRef: (value: string) => void
  createWorktree: () => void | Promise<void>
  openWorktree: (worktree: WorktreeSummary) => void | Promise<void>
  removeWorktree: (worktree: WorktreeSummary) => void | Promise<void>
  runOperationAction: (label: string, action: () => Promise<ApiResult<GitOperationResult>>) => void | Promise<void>
}) {
  return (
    <details className="branch-collapsible">
      <summary>Worktrees <span>{worktrees.length}</span></summary>
      <section className="worktree-panel">
        <p className="branch-collapsible-hint">Create a linked worktree for safe branch experiments without disturbing this checkout.</p>

        <div className="worktree-composer">
          <label htmlFor="worktree-branch">New branch</label>
          <input
            id="worktree-branch"
            value={newWorktreeBranchName}
            onChange={(event) => setNewWorktreeBranchName(event.target.value)}
            placeholder="experiment/safe-change"
          />
          <label htmlFor="worktree-base">Base ref</label>
          <input
            id="worktree-base"
            list="worktree-base-refs"
            value={newWorktreeBaseRef}
            onChange={(event) => setNewWorktreeBaseRef(event.target.value)}
            placeholder={snapshot?.summary.currentBranch ?? 'HEAD'}
          />
          <datalist id="worktree-base-refs">
            {branches.map((branch) => (
              <option value={branch.name} key={branch.name} />
            ))}
            {remoteBranches.map((branch) => (
              <option value={branch.name} key={`remote-${branch.name}`} />
            ))}
          </datalist>
          <div className="worktree-composer-actions">
            <button type="button" onClick={createWorktree} disabled={busy || !newWorktreeBranchName.trim()}>
              <FolderOpen size={17} />
              Create worktree
            </button>
          </div>
        </div>

        <div className="worktree-list">
          {worktrees.length === 0 ? (
            <div className="quiet-box">No linked worktrees.</div>
          ) : (
            worktrees.map((worktree) => (
              <article className={worktree.current ? 'worktree-row current' : 'worktree-row'} key={worktree.path}>
                <div>
                  <strong>{worktree.branch ?? 'Detached HEAD'}</strong>
                  <span>{worktreeSummaryLabel(worktree)}</span>
                  <code>{worktree.path}</code>
                  {worktree.reason && <p>{worktree.reason}</p>}
                </div>
                <div className="panel-actions">
                  <button className="icon-button" type="button" title="Open worktree" aria-label="Open worktree" onClick={() => openWorktree(worktree)} disabled={busy || worktree.current}>
                    <FolderOpen size={16} />
                  </button>
                  <button className="icon-button" type="button" title="Open in editor" aria-label="Open in editor" onClick={() => runOperationAction('Worktree opened in editor.', () => api!.openInEditor({ targetPath: worktree.path }))} disabled={busy}>
                    <Code2 size={16} />
                  </button>
                  <button
                    className="danger-button icon-button"
                    type="button"
                    title="Remove worktree"
                    aria-label="Remove worktree"
                    onClick={() => removeWorktree(worktree)}
                    disabled={busy || worktree.current}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </article>
            ))
          )}
        </div>
      </section>
    </details>
  )
}
