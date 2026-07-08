import { AlignLeft, Check, ChevronDown, GitBranch, GitMerge, Pencil, Trash2, X } from 'lucide-react'
import { useController } from '../../hooks/AppControllerContext'
import type { MergeBranchCandidate } from '../../lib/mergeCandidates'
import type { BranchActionMode, BranchActionState } from './useShellMenus'

/** Current-branch segment: branch list with inline rename/describe/delete,
 *  checkout of remote-only branches, and entry points for new-branch and merge. */
export function ShellBranchMenu({
  branchMenuOpen,
  branchAction,
  branchActionValue,
  setBranchActionValue,
  startBranchAction,
  cancelBranchAction,
  confirmBranchAction,
  openCreateBranch,
  switchBranch,
  mergeCandidates,
  onOpenMergeInto,
  handleToggle,
  closeMenu
}: {
  branchMenuOpen: boolean
  branchAction: BranchActionState | null
  branchActionValue: string
  setBranchActionValue: (value: string) => void
  startBranchAction: (name: string, mode: BranchActionMode, value: string) => void
  cancelBranchAction: () => void
  confirmBranchAction: () => void
  openCreateBranch: () => void
  switchBranch: (branchName: string) => void
  mergeCandidates: MergeBranchCandidate[]
  onOpenMergeInto: () => void
  handleToggle: (event: { currentTarget: HTMLDetailsElement }) => void
  closeMenu: (event: { currentTarget: HTMLElement }) => void
}) {
  const { snapshot, busy } = useController()
  const branches = snapshot?.branches ?? []
  const remoteBranches = snapshot?.remoteBranches ?? []
  const currentBranch = snapshot?.summary.currentBranch ?? null
  // Remote branches that have no local counterpart — surfaced in the switcher so
  // you can check one out (git switch DWIMs a local tracking branch from its
  // short name). Mirrors the dedup the merge dialog uses.
  const localBranchNames = new Set(branches.map((branch) => branch.name))
  const switchableRemoteBranches = remoteBranches.filter(
    (branch) =>
      Boolean(branch.branchName) &&
      branch.branchName !== 'HEAD' &&
      !localBranchNames.has(branch.branchName) &&
      !localBranchNames.has(branch.name)
  )

  return (
    <details className="shell-menu shell-branch" open={branchMenuOpen} onToggle={handleToggle}>
      <summary>
        <GitBranch size={17} className="shell-seg-icon" />
        <span className="shell-seg-stack">
          <span className="shell-seg-label">Current branch</span>
          <span className="shell-seg-value">{currentBranch ?? 'No branch'}</span>
        </span>
        <ChevronDown size={14} className="shell-seg-caret" />
      </summary>
      <div className="shell-dropdown">
        <button className="shell-dropdown-primary shell-dropdown-top" type="button" disabled={!snapshot || busy} onClick={(event) => { closeMenu(event); openCreateBranch() }}>
          <GitBranch size={15} />
          New branch…
        </button>
        <div className="shell-dropdown-list" aria-label="Branches">
          {branches.length === 0 ? (
            <p className="shell-dropdown-empty">No local branches.</p>
          ) : (
            branches.map((branch) => {
              const editing = branchAction?.name === branch.name
              if (editing && branchAction?.mode !== 'delete') {
                return (
                  <form
                    key={branch.name}
                    className="shell-branch-edit"
                    onSubmit={(event) => { event.preventDefault(); confirmBranchAction() }}
                  >
                    <input
                      autoFocus
                      value={branchActionValue}
                      onChange={(event) => setBranchActionValue(event.target.value)}
                      onKeyDown={(event) => { if (event.key === 'Escape') cancelBranchAction() }}
                      placeholder={branchAction?.mode === 'rename' ? 'New branch name' : 'Branch description'}
                    />
                    <button type="submit" className="icon-button" title="Save" aria-label="Save" onClick={(event) => event.stopPropagation()}><Check size={14} /></button>
                    <button type="button" className="icon-button" title="Cancel" aria-label="Cancel" onClick={(event) => { event.stopPropagation(); cancelBranchAction() }}><X size={14} /></button>
                  </form>
                )
              }
              if (editing && branchAction?.mode === 'delete') {
                return (
                  <div key={branch.name} className="shell-branch-confirm">
                    <span>Delete <strong>{branch.name}</strong>?</span>
                    <button type="button" className="icon-button danger" title="Confirm delete" aria-label="Confirm delete" onClick={(event) => { event.stopPropagation(); confirmBranchAction() }}><Check size={14} /></button>
                    <button type="button" className="icon-button" title="Cancel" aria-label="Cancel" onClick={(event) => { event.stopPropagation(); cancelBranchAction() }}><X size={14} /></button>
                  </div>
                )
              }
              return (
                <div className={branch.name === currentBranch ? 'shell-branch-row active' : 'shell-branch-row'} key={branch.name}>
                  <button
                    className="shell-branch-pick"
                    type="button"
                    disabled={busy || branch.name === currentBranch}
                    onClick={(event) => { closeMenu(event); switchBranch(branch.name) }}
                  >
                    {branch.name === currentBranch ? <Check size={13} /> : <GitBranch size={13} />}
                    <span className="shell-dropdown-item-text">
                      <strong>{branch.name}</strong>
                      {branch.upstream && <span>{branch.upstream}</span>}
                    </span>
                  </button>
                  <span className="shell-branch-actions">
                    <button type="button" className="icon-button shell-branch-action-button" title="Rename branch" aria-label="Rename branch" disabled={busy} onClick={(event) => { event.stopPropagation(); startBranchAction(branch.name, 'rename', branch.name) }}><Pencil size={13} /></button>
                    <button type="button" className="icon-button shell-branch-action-button" title="Edit description" aria-label="Edit description" disabled={busy} onClick={(event) => { event.stopPropagation(); startBranchAction(branch.name, 'describe', branch.description ?? '') }}><AlignLeft size={13} /></button>
                    <button type="button" className="icon-button shell-branch-action-button danger" title="Delete branch" aria-label="Delete branch" disabled={busy || branch.name === currentBranch} onClick={(event) => { event.stopPropagation(); startBranchAction(branch.name, 'delete', '') }}><Trash2 size={13} /></button>
                  </span>
                </div>
              )
            })
          )}
          {switchableRemoteBranches.length > 0 && (
            <>
              <p className="shell-dropdown-section">Remote branches</p>
              {switchableRemoteBranches.map((branch) => (
                <div className="shell-branch-row" key={branch.name}>
                  <button
                    className="shell-branch-pick"
                    type="button"
                    disabled={busy}
                    title={`Check out ${branch.branchName} (tracking ${branch.name})`}
                    onClick={(event) => { closeMenu(event); switchBranch(branch.branchName) }}
                  >
                    <GitBranch size={13} />
                    <span className="shell-dropdown-item-text">
                      <strong>{branch.branchName}</strong>
                      <span>{branch.name}</span>
                    </span>
                  </button>
                </div>
              ))}
            </>
          )}
        </div>
        <button className="shell-dropdown-primary shell-dropdown-merge" type="button" disabled={!snapshot || busy || mergeCandidates.length === 0} onClick={(event) => { closeMenu(event); onOpenMergeInto() }}>
          <GitMerge size={15} />
          Choose a branch to merge into {currentBranch ?? 'current'}…
        </button>
      </div>
    </details>
  )
}
