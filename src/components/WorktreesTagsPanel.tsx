import { Code2, FolderOpen, Plus, Search, Trash2, X } from 'lucide-react'
import type {
  ApiResult, BranchPilotApi, GitOperationResult, RepositorySnapshot, TagSummary, WorktreeSummary
} from '../shared/branchPilot'
import { worktreeSummaryLabel } from '../lib/gitEntityLabels'
import { formatDate } from '../lib/format'
import { IconButton } from './IconButton'

/** Worktrees + local tags management, surfaced inside Settings. */
export function WorktreesTagsPanel({
  snapshot, api, busy, runOperationAction,
  newWorktreeBranchName, setNewWorktreeBranchName,
  newWorktreeBaseRef, setNewWorktreeBaseRef,
  createWorktree, openWorktree, removeWorktree,
  tagFilter, setTagFilter, newTagName, setNewTagName,
  newTagMessage, setNewTagMessage, createTag, deleteTag,
  panel = 'all'
}: {
  snapshot: RepositorySnapshot | null
  api: BranchPilotApi | undefined
  busy: boolean
  runOperationAction: (label: string, action: () => Promise<ApiResult<GitOperationResult>>) => void | Promise<void>
  newWorktreeBranchName: string
  setNewWorktreeBranchName: (value: string) => void
  newWorktreeBaseRef: string
  setNewWorktreeBaseRef: (value: string) => void
  createWorktree: () => void | Promise<void>
  openWorktree: (worktree: WorktreeSummary) => void | Promise<void>
  removeWorktree: (worktree: WorktreeSummary) => void | Promise<void>
  tagFilter: string
  setTagFilter: (value: string) => void
  newTagName: string
  setNewTagName: (value: string) => void
  newTagMessage: string
  setNewTagMessage: (value: string) => void
  createTag: () => void | Promise<void>
  deleteTag: (tag: TagSummary) => void | Promise<void>
  panel?: 'all' | 'worktrees' | 'tags'
}) {
  const worktrees = snapshot?.worktrees ?? []
  const branches = snapshot?.branches ?? []
  const remoteBranches = snapshot?.remoteBranches ?? []
  const tags = snapshot?.tags ?? []
  const query = tagFilter.trim().toLowerCase()
  const filteredTags = query
    ? tags.filter((tag) => [tag.name, tag.subject].filter(Boolean).some((v) => v!.toLowerCase().includes(query)))
    : tags

  return (
    <>
      {panel !== 'tags' && (
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
              {branches.map((branch) => <option value={branch.name} key={branch.name} />)}
              {remoteBranches.map((branch) => <option value={branch.name} key={`remote-${branch.name}`} />)}
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
                    <IconButton
                      icon={<FolderOpen size={16} />}
                      label="Open worktree"
                      onClick={() => openWorktree(worktree)}
                      disabled={busy || worktree.current}
                    />
                    <IconButton
                      icon={<Code2 size={16} />}
                      label="Open in editor"
                      onClick={() => runOperationAction('Worktree opened in editor.', () => api!.openInEditor({ targetPath: worktree.path }))}
                      disabled={busy}
                    />
                    <IconButton
                      icon={<Trash2 size={16} />}
                      label="Remove worktree"
                      tone="danger"
                      onClick={() => removeWorktree(worktree)}
                      disabled={busy || worktree.current}
                    />
                  </div>
                </article>
              ))
            )}
          </div>
        </section>
      )}

      {panel !== 'worktrees' && (
        <section className="tag-panel">
          <p className="branch-collapsible-hint">Create lightweight or annotated local tags at the current HEAD.</p>
          <div className="tag-composer">
            <label htmlFor="tag-name">Tag name</label>
            <input id="tag-name" value={newTagName} onChange={(event) => setNewTagName(event.target.value)} placeholder="v1.0.0" />
            <label htmlFor="tag-message">Annotation</label>
            <textarea id="tag-message" value={newTagMessage} onChange={(event) => setNewTagMessage(event.target.value)} placeholder="Optional annotated tag message" />
            <div className="tag-composer-actions">
              <button type="button" onClick={createTag} disabled={busy || !newTagName.trim()}>
                <Plus size={17} />
                Create tag
              </button>
            </div>
          </div>
          <div className="list-filter-bar">
            <label className="list-filter-input" htmlFor="tag-filter">
              <Search size={16} />
              <input id="tag-filter" value={tagFilter} onChange={(event) => setTagFilter(event.target.value)} placeholder="Search tags" />
            </label>
            {tagFilter && (
              <button type="button" className="secondary" onClick={() => setTagFilter('')}>
                <X size={15} />
                Clear
              </button>
            )}
          </div>
          <div className="tag-list">
            {tags.length === 0 ? (
              <div className="quiet-box">No local tags.</div>
            ) : filteredTags.length === 0 ? (
              <div className="quiet-box">No tags match this search.</div>
            ) : (
              filteredTags.map((tag) => (
                <article className="tag-row" key={tag.name}>
                  <div>
                    <strong>{tag.name}</strong>
                    <span>{tag.targetShortSha}{tag.createdAt ? ` · ${formatDate(tag.createdAt)}` : ''}</span>
                    {tag.subject && <p>{tag.subject}</p>}
                  </div>
                  <div className="panel-actions">
                    <IconButton
                      icon={<Trash2 size={16} />}
                      label="Delete tag"
                      tone="danger"
                      onClick={() => deleteTag(tag)}
                      disabled={busy}
                    />
                  </div>
                </article>
              ))
            )}
          </div>
        </section>
      )}
    </>
  )
}
