import { Plus, Search, Trash2, X } from 'lucide-react'
import type { TagSummary } from '../../../shared/branchPilot'
import { formatDate } from '../../../lib/format'

export function TagPanel({
  tags, busy, tagFilter, setTagFilter,
  newTagName, setNewTagName, newTagMessage, setNewTagMessage,
  createTag, deleteTag
}: {
  tags: TagSummary[]
  busy: boolean
  tagFilter: string
  setTagFilter: (value: string) => void
  newTagName: string
  setNewTagName: (value: string) => void
  newTagMessage: string
  setNewTagMessage: (value: string) => void
  createTag: () => void | Promise<void>
  deleteTag: (tag: TagSummary) => void | Promise<void>
}) {
  const tagQuery = tagFilter.trim().toLowerCase()
  const filteredTags = tagQuery
    ? tags.filter((tag) =>
      [tag.name, tag.targetSha, tag.targetShortSha, tag.subject]
        .filter((value): value is string => Boolean(value))
        .some((value) => value.toLowerCase().includes(tagQuery))
    )
    : tags

  return (
    <details className="branch-collapsible">
      <summary>Tags <span>{tags.length}</span></summary>
      <section className="tag-panel">
        <p className="branch-collapsible-hint">Create lightweight or annotated local tags at the current HEAD.</p>

        <div className="tag-composer">
          <label htmlFor="tag-name">Tag name</label>
          <input
            id="tag-name"
            value={newTagName}
            onChange={(event) => setNewTagName(event.target.value)}
            placeholder="v1.0.0"
          />
          <label htmlFor="tag-message">Annotation</label>
          <textarea
            id="tag-message"
            value={newTagMessage}
            onChange={(event) => setNewTagMessage(event.target.value)}
            placeholder="Optional annotated tag message"
          />
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
            <input
              id="tag-filter"
              value={tagFilter}
              onChange={(event) => setTagFilter(event.target.value)}
              placeholder="Search tags"
            />
          </label>
          <span>{filteredTags.length} / {tags.length}</span>
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
                  <button
                    className="danger-button icon-button"
                    type="button"
                    title="Delete tag"
                    aria-label="Delete tag"
                    onClick={() => deleteTag(tag)}
                    disabled={busy}
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
