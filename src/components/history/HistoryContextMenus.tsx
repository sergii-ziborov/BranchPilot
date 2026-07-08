import { Code2, Copy, Eye, GitCommitHorizontal, RotateCcw, Trash2 } from 'lucide-react'
import type { BranchPilotApi, CommitDetails, CommitSummary, RepositorySnapshot } from '../../shared/branchPilot'

type CommitOperationKind = 'revert' | 'cherry-pick' | 'reset' | 'reset-hard'

interface HistoryFileContextMenuProps {
  menu: { x: number; y: number; path: string }
  busy: boolean
  api: BranchPilotApi | undefined
  commitDetails: CommitDetails | null
  openPreviewFromMenu: () => void
  openInEditorFromMenu: () => void
  copyPathFromMenu: () => void
  copyNameFromMenu: () => void
}

export function HistoryFileContextMenu({
  menu,
  busy,
  api,
  commitDetails,
  openPreviewFromMenu,
  openInEditorFromMenu,
  copyPathFromMenu,
  copyNameFromMenu
}: HistoryFileContextMenuProps) {
  return (
    <div className="context-menu" role="menu" style={{ top: menu.y, left: menu.x }}>
      <button type="button" role="menuitem" title="Preview this file as it exists in the selected commit" onClick={openPreviewFromMenu} disabled={!api || !commitDetails}>
        <Eye size={15} />
        Preview at commit
      </button>
      <button type="button" role="menuitem" title="Open the current working-tree file in your editor" onClick={openInEditorFromMenu} disabled={busy || !api}>
        <Code2 size={15} />
        Open current file in editor
      </button>
      <button type="button" role="menuitem" title="Copy the absolute file path" onClick={copyPathFromMenu}>
        <Copy size={15} />
        Copy path
      </button>
      <button type="button" role="menuitem" title="Copy the file name" onClick={copyNameFromMenu}>
        <Copy size={15} />
        Copy file name
      </button>
    </div>
  )
}

interface HistoryCommitContextMenuProps {
  menu: { x: number; y: number; commit: CommitSummary }
  busy: boolean
  snapshot: RepositorySnapshot | null
  copyCommitShaFromMenu: () => void
  copyCommitSubjectFromMenu: () => void
  applyCommitOperationFromMenu: (kind: CommitOperationKind) => void
}

export function HistoryCommitContextMenu({
  menu,
  busy,
  snapshot,
  copyCommitShaFromMenu,
  copyCommitSubjectFromMenu,
  applyCommitOperationFromMenu
}: HistoryCommitContextMenuProps) {
  return (
    <div className="context-menu" role="menu" style={{ top: menu.y, left: menu.x }}>
      <button type="button" role="menuitem" title="Copy the full commit SHA" onClick={copyCommitShaFromMenu}>
        <Copy size={15} />
        Copy full SHA
      </button>
      <button type="button" role="menuitem" title="Copy the commit subject" onClick={copyCommitSubjectFromMenu}>
        <Copy size={15} />
        Copy subject
      </button>
      <hr />
      <button
        type="button"
        role="menuitem"
        title="Cherry-pick this commit onto the current branch"
        onClick={() => applyCommitOperationFromMenu('cherry-pick')}
        disabled={busy || Boolean(snapshot?.status.counts.conflicted) || snapshot?.status.merge.operation !== 'none'}
      >
        <GitCommitHorizontal size={15} />
        Cherry-pick commit
      </button>
      <button
        type="button"
        role="menuitem"
        className="danger"
        title="Create a new commit that reverts this commit"
        onClick={() => applyCommitOperationFromMenu('revert')}
        disabled={busy || Boolean(snapshot?.status.counts.conflicted) || snapshot?.status.merge.operation !== 'none'}
      >
        <RotateCcw size={15} />
        Revert commit
      </button>
      <button
        type="button"
        role="menuitem"
        className="danger"
        title={menu.commit.sha === snapshot?.summary.headOid
          ? 'Branch is already at this commit'
          : 'Move the current branch here and keep later commits as unstaged changes'}
        onClick={() => applyCommitOperationFromMenu('reset')}
        disabled={busy || menu.commit.sha === snapshot?.summary.headOid || Boolean(snapshot?.status.counts.conflicted) || snapshot?.status.merge.operation !== 'none'}
      >
        <Trash2 size={15} />
        Reset here, keep changes
      </button>
      <button
        type="button"
        role="menuitem"
        className="danger"
        title={menu.commit.sha === snapshot?.summary.headOid
          ? 'Branch is already at this commit'
          : 'Move the current branch here and discard later commits plus working tree changes'}
        onClick={() => applyCommitOperationFromMenu('reset-hard')}
        disabled={busy || menu.commit.sha === snapshot?.summary.headOid || Boolean(snapshot?.status.counts.conflicted) || snapshot?.status.merge.operation !== 'none'}
      >
        <Trash2 size={15} />
        Reset here, discard changes
      </button>
    </div>
  )
}
