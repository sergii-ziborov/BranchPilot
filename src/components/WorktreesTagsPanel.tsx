import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, Code2, FolderOpen, Plus, Search, Trash2, X } from 'lucide-react'
import type {
  ApiResult, BranchPilotApi, GitOperationResult, RepositorySnapshot, TagSummary, WorktreeSummary
} from '../shared/branchPilot'
import { worktreeSummaryLabel } from '../lib/gitEntityLabels'
import { formatDate } from '../lib/format'
import { IconButton } from './IconButton'
import { useVirtualList } from '../hooks/useVirtualList'

// Fixed tag row pitch (88px row + 10px gap), kept in sync with .tag-list-scroll .tag-row in
// worktrees-config.css, so the tag list is windowed instead of mounting every row.
const TAG_ROW_HEIGHT = 98

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
  const [baseRefMenuOpen, setBaseRefMenuOpen] = useState(false)
  const baseRefMenuRef = useRef<HTMLDivElement>(null)
  const worktrees = snapshot?.worktrees ?? []
  const branches = snapshot?.branches ?? []
  const remoteBranches = snapshot?.remoteBranches ?? []
  const tags = snapshot?.tags ?? []
  const baseRefGroups = useMemo(() => [
    {
      label: 'Local branches',
      refs: branches.map((branch) => branch.name)
    },
    {
      label: 'Remote branches',
      refs: remoteBranches.map((branch) => branch.name)
    }
  ], [branches, remoteBranches])
  const selectedBaseRefKey = newWorktreeBaseRef.trim().toLowerCase()
  const query = tagFilter.trim().toLowerCase()
  const filteredTags = query
    ? tags.filter((tag) => [tag.name, tag.subject].filter(Boolean).some((v) => v!.toLowerCase().includes(query)))
    : tags
  const { containerRef: tagsContainerRef, onScroll: tagsScroll, window: tagsWindow, items: tagsItems } =
    useVirtualList(filteredTags, TAG_ROW_HEIGHT, query)

  useEffect(() => {
    if (!baseRefMenuOpen) return

    function closeBaseRefMenu(event: PointerEvent) {
      const target = event.target
      if (target instanceof Node && baseRefMenuRef.current?.contains(target)) return
      setBaseRefMenuOpen(false)
    }

    function closeBaseRefMenuOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setBaseRefMenuOpen(false)
    }

    document.addEventListener('pointerdown', closeBaseRefMenu)
    document.addEventListener('keydown', closeBaseRefMenuOnEscape)

    return () => {
      document.removeEventListener('pointerdown', closeBaseRefMenu)
      document.removeEventListener('keydown', closeBaseRefMenuOnEscape)
    }
  }, [baseRefMenuOpen])

  function selectBaseRef(refName: string) {
    setNewWorktreeBaseRef(refName)
    setBaseRefMenuOpen(false)
  }

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
            <div className="worktree-base-combobox" ref={baseRefMenuRef}>
              <div className="worktree-base-input-row">
                <input
                  id="worktree-base"
                  value={newWorktreeBaseRef}
                  onChange={(event) => {
                    setNewWorktreeBaseRef(event.target.value)
                    setBaseRefMenuOpen(true)
                  }}
                  onFocus={() => setBaseRefMenuOpen(true)}
                  placeholder={snapshot?.summary.currentBranch ?? 'HEAD'}
                />
                <button
                  className="worktree-base-menu-button"
                  type="button"
                  aria-label="Show base refs"
                  aria-expanded={baseRefMenuOpen}
                  onClick={() => setBaseRefMenuOpen((open) => !open)}
                >
                  <ChevronDown size={16} />
                </button>
              </div>
              {baseRefMenuOpen && (
                <div className="worktree-base-menu" role="listbox" aria-label="Base refs">
                  {baseRefGroups.every((group) => group.refs.length === 0) ? (
                    <div className="worktree-base-option-empty">No branch refs loaded.</div>
                  ) : (
                    baseRefGroups.map((group) => (
                      group.refs.length > 0 && (
                        <div className="worktree-base-option-group" key={group.label}>
                          <div className="worktree-base-option-group-label">{group.label}</div>
                          {group.refs.map((refName) => {
                            const selected = refName.toLowerCase() === selectedBaseRefKey

                            return (
                              <button
                                className={selected ? 'worktree-base-option selected' : 'worktree-base-option'}
                                type="button"
                                role="option"
                                aria-selected={selected}
                                key={`${group.label}-${refName}`}
                                onClick={() => selectBaseRef(refName)}
                              >
                                <span className="worktree-base-option-name">{refName}</span>
                                {selected && <span className="worktree-base-option-kind">Selected</span>}
                                {selected && <Check size={14} />}
                              </button>
                            )
                          })}
                        </div>
                      )
                    ))
                  )}
                </div>
              )}
            </div>
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
              <div
                className="tag-list-scroll virtual-list-viewport"
                ref={tagsContainerRef}
                onScroll={tagsScroll}
              >
                <div className="virtual-list-spacer" style={{ height: tagsWindow.totalHeight }}>
                  {tagsItems.map(({ item: tag, index }) => (
                    <div
                      className="virtual-list-item"
                      key={tag.name}
                      style={{ transform: `translateY(${index * TAG_ROW_HEIGHT}px)` }}
                    >
                      <article className="tag-row">
                        <div>
                          <strong>{tag.name}</strong>
                          <span>{tag.targetShortSha}{tag.createdAt ? ` · ${formatDate(tag.createdAt)}` : ''}</span>
                          {tag.subject && <p title={tag.subject}>{tag.subject}</p>}
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
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>
      )}
    </>
  )
}
