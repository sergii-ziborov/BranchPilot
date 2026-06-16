import { Bot, Code2, FileText, FolderOpen, GitBranch, GitCompare, Link2, Loader2, Pencil, Plus, Save, Search, Trash2, UploadCloud, X } from 'lucide-react'
import type {
  ApiResult, AssistantId, AssistantPolicyStatus, BranchComparison, BranchPilotApi, BranchSummary,
  GitOperationResult, RemoteBranchSummary, RepositorySnapshot, TagSummary, WorktreeSummary
} from '../../shared/branchPilot'
import { getBranchComposerSummary, getBranchDraftActionState, getCreateBranchActionState } from '../../shared/branchPreconditions'
import { fileStatusToken } from '../../lib/fileChangeLabels'
import { worktreeSummaryLabel } from '../../lib/gitEntityLabels'
import { formatDate } from '../../lib/format'
import { assistantPolicyBlockedLabel } from '../../lib/assistantLabels'

export function BranchesView({
  branches, remoteBranches, tags, worktrees,
  snapshot, api, currentRepoPath, busy,
  branchFilter, setBranchFilter, tagFilter, setTagFilter,
  branchDraftGoal, setBranchDraftGoal, newBranchName, setNewBranchName,
  newBranchDescription, setNewBranchDescription,
  selectedAssistant, setSelectedAssistant, assistantPolicy,
  canGenerateBranchDraft, branchComposerSummary, branchDraftActionState, createBranchActionState,
  generateBranchDraft, createBranch,
  editingBranchName, branchDescriptionDraft, setBranchDescriptionDraft, branchDescriptionGenerating,
  startBranchDescriptionEdit, cancelBranchDescriptionEdit, saveBranchDescription, generateBranchDescription,
  renameBranch, setBranchUpstream, compareBranch, deleteBranch,
  branchComparison, branchComparisonLoading,
  newWorktreeBranchName, setNewWorktreeBranchName, newWorktreeBaseRef, setNewWorktreeBaseRef,
  createWorktree, openWorktree, removeWorktree,
  newTagName, setNewTagName, newTagMessage, setNewTagMessage, createTag, deleteTag,
  runSnapshotAction, runOperationAction
}: {
  branches: BranchSummary[]
  remoteBranches: RemoteBranchSummary[]
  tags: TagSummary[]
  worktrees: WorktreeSummary[]
  snapshot: RepositorySnapshot | null
  api: BranchPilotApi | undefined
  currentRepoPath: string | undefined
  busy: boolean
  branchFilter: string
  setBranchFilter: (value: string) => void
  tagFilter: string
  setTagFilter: (value: string) => void
  branchDraftGoal: string
  setBranchDraftGoal: (value: string) => void
  newBranchName: string
  setNewBranchName: (value: string) => void
  newBranchDescription: string
  setNewBranchDescription: (value: string) => void
  selectedAssistant: AssistantId
  setSelectedAssistant: (assistant: AssistantId) => void
  assistantPolicy: AssistantPolicyStatus | null
  canGenerateBranchDraft: boolean
  branchComposerSummary: ReturnType<typeof getBranchComposerSummary>
  branchDraftActionState: ReturnType<typeof getBranchDraftActionState>
  createBranchActionState: ReturnType<typeof getCreateBranchActionState>
  generateBranchDraft: () => void | Promise<void>
  createBranch: () => void | Promise<void>
  editingBranchName: string | null
  branchDescriptionDraft: string
  setBranchDescriptionDraft: (value: string) => void
  branchDescriptionGenerating: string | null
  startBranchDescriptionEdit: (branch: BranchSummary) => void
  cancelBranchDescriptionEdit: () => void
  saveBranchDescription: (branchName: string) => void | Promise<void>
  generateBranchDescription: (branch: BranchSummary) => void | Promise<void>
  renameBranch: (branch: BranchSummary) => void | Promise<void>
  setBranchUpstream: (branch: BranchSummary) => void | Promise<void>
  compareBranch: (branch: BranchSummary) => void | Promise<void>
  deleteBranch: (branch: BranchSummary) => void | Promise<void>
  branchComparison: BranchComparison | null
  branchComparisonLoading: string | null
  newWorktreeBranchName: string
  setNewWorktreeBranchName: (value: string) => void
  newWorktreeBaseRef: string
  setNewWorktreeBaseRef: (value: string) => void
  createWorktree: () => void | Promise<void>
  openWorktree: (worktree: WorktreeSummary) => void | Promise<void>
  removeWorktree: (worktree: WorktreeSummary) => void | Promise<void>
  newTagName: string
  setNewTagName: (value: string) => void
  newTagMessage: string
  setNewTagMessage: (value: string) => void
  createTag: () => void | Promise<void>
  deleteTag: (tag: TagSummary) => void | Promise<void>
  runSnapshotAction: (label: string, action: () => Promise<ApiResult<RepositorySnapshot>>) => boolean | void | Promise<boolean>
  runOperationAction: (label: string, action: () => Promise<ApiResult<GitOperationResult>>) => void | Promise<void>
}) {
  const branchQuery = branchFilter.trim().toLowerCase()
  const filteredBranches = branchQuery
    ? branches.filter((branch) =>
      [
        branch.name,
        branch.upstream,
        branch.description,
        branch.current ? 'current branch' : 'local branch'
      ]
        .filter((value): value is string => Boolean(value))
        .some((value) => value.toLowerCase().includes(branchQuery))
    )
    : branches
  const filteredRemoteBranches = branchQuery
    ? remoteBranches.filter((branch) =>
      [
        branch.name,
        branch.remote,
        branch.branchName,
        branch.lastCommit
      ]
        .filter((value): value is string => Boolean(value))
        .some((value) => value.toLowerCase().includes(branchQuery))
    )
    : remoteBranches
  const tagQuery = tagFilter.trim().toLowerCase()
  const filteredTags = tagQuery
    ? tags.filter((tag) =>
      [tag.name, tag.targetSha, tag.targetShortSha, tag.subject]
        .filter((value): value is string => Boolean(value))
        .some((value) => value.toLowerCase().includes(tagQuery))
    )
    : tags

  return (
    <section className="single-panel">
      <div className="panel-heading">
        <div>
          <h2>Branches</h2>
          <p>Create, describe, switch, and safely delete local branches. Inspect fetched remote branches without mutating them.</p>
        </div>
      </div>

      <section className="branch-composer">
        <div className="branch-composer-heading">
          <div>
            <h3>New branch</h3>
            <p>Draft a branch name from local context, then create it with an optional Git branch description.</p>
          </div>
          <span>{snapshot?.summary.currentBranch ?? 'No repository'}</span>
        </div>

        <div className="branch-composer-grid">
          <label htmlFor="branch-draft-goal">Intent</label>
          <textarea
            id="branch-draft-goal"
            value={branchDraftGoal}
            onChange={(event) => setBranchDraftGoal(event.target.value)}
            placeholder="What are you about to work on?"
          />

          <label htmlFor="branch-name">Branch name</label>
          <input
            id="branch-name"
            value={newBranchName}
            onChange={(event) => setNewBranchName(event.target.value)}
            placeholder="feature/new-work"
          />

          <label htmlFor="branch-description">Branch description</label>
          <textarea
            id="branch-description"
            value={newBranchDescription}
            onChange={(event) => setNewBranchDescription(event.target.value)}
            placeholder="Optional local Git branch description"
          />
        </div>

        <div className="branch-composer-summary" aria-label="Branch draft readiness">
          {branchComposerSummary.map((item) => (
            <div className={`branch-summary-item tone-${item.tone}`} key={item.label}>
              <span>{item.label}</span>
              <strong>{item.value}</strong>
            </div>
          ))}
        </div>

        <div className="branch-composer-actions">
          <select
            aria-label="Branch draft assistant"
            value={selectedAssistant}
            onChange={(event) => setSelectedAssistant(event.target.value as AssistantId)}
          >
            <option value="auto">Auto</option>
            <option value="claude">Claude Code</option>
            <option value="codex">Codex</option>
          </select>
          <button type="button" onClick={generateBranchDraft} disabled={busy || !branchDraftActionState.enabled}>
            <Bot size={17} />
            Generate draft
          </button>
          <button type="button" onClick={createBranch} disabled={busy || !createBranchActionState.enabled}>
            <GitBranch size={17} />
            Create branch
          </button>
        </div>

        {!canGenerateBranchDraft && (
          <div className="assistant-policy-note">{assistantPolicyBlockedLabel('branch_draft', assistantPolicy)}</div>
        )}
      </section>

      <div className="list-filter-bar">
        <label className="list-filter-input" htmlFor="branch-filter">
          <Search size={16} />
          <input
            id="branch-filter"
            value={branchFilter}
            onChange={(event) => setBranchFilter(event.target.value)}
            placeholder="Search branches"
          />
        </label>
        <span>{filteredBranches.length + filteredRemoteBranches.length} / {branches.length + remoteBranches.length}</span>
        {branchFilter && (
          <button type="button" className="secondary" onClick={() => setBranchFilter('')}>
            <X size={15} />
            Clear
          </button>
        )}
      </div>

      <div className="branch-list">
        {branches.length === 0 ? (
          <div className="quiet-box">No local branches.</div>
        ) : filteredBranches.length === 0 ? (
          <div className="quiet-box">No branches match this search.</div>
        ) : filteredBranches.map((branch) => {
          const isEditingDescription = editingBranchName === branch.name
          const isGeneratingDescription = branchDescriptionGenerating === branch.name

          return (
            <article className={branch.current ? 'branch-row current' : 'branch-row'} key={branch.name}>
              <div>
                <strong>{branch.name}</strong>
                <span>{branch.upstream || 'No upstream'} · {branch.lastCommitAt ? formatDate(branch.lastCommitAt) : 'No commit date'}</span>
                {isEditingDescription ? (
                  <div className="branch-description-editor">
                    <textarea
                      aria-label={`Description for ${branch.name}`}
                      value={branchDescriptionDraft}
                      onChange={(event) => setBranchDescriptionDraft(event.target.value)}
                      placeholder="Describe the purpose of this branch"
                    />
                    <div className="branch-description-actions">
                      <button type="button" onClick={() => generateBranchDescription(branch)} disabled={busy || isGeneratingDescription || !canGenerateBranchDraft}>
                        <Bot size={16} />
                        {isGeneratingDescription ? 'Generating' : 'Generate'}
                      </button>
                      <button type="button" onClick={() => saveBranchDescription(branch.name)} disabled={busy}>
                        <Save size={16} />
                        Save
                      </button>
                      <button type="button" className="secondary" onClick={cancelBranchDescriptionEdit} disabled={busy}>
                        <X size={16} />
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className={branch.description ? undefined : 'branch-description-empty'}>
                    {branch.description || 'No local branch description.'}
                  </p>
                )}
              </div>
              <div className="panel-actions">
                <button
                  className="icon-button"
                  type="button"
                  title="Edit description"
                  aria-label="Edit description"
                  onClick={() => startBranchDescriptionEdit(branch)}
                  disabled={busy || isEditingDescription}
                >
                  <FileText size={16} />
                </button>
                <button
                  className="icon-button"
                  type="button"
                  title="Rename branch"
                  aria-label="Rename branch"
                  onClick={() => renameBranch(branch)}
                  disabled={busy || isEditingDescription}
                >
                  <Pencil size={16} />
                </button>
                <button
                  className="icon-button"
                  type="button"
                  title={isGeneratingDescription ? 'Generating description' : 'Generate description'}
                  aria-label={isGeneratingDescription ? 'Generating description' : 'Generate description'}
                  onClick={() => generateBranchDescription(branch)}
                  disabled={busy || isGeneratingDescription || !canGenerateBranchDraft}
                >
                  {isGeneratingDescription ? <Loader2 className="spin" size={16} /> : <Bot size={16} />}
                </button>
                {branch.current && !branch.upstream && snapshot?.summary.remoteName && (
                  <button className="icon-button" type="button" title="Publish branch" aria-label="Publish branch" disabled={busy} onClick={() => currentRepoPath && runSnapshotAction('Branch published.', () => api!.publishBranch({
                    repoPath: currentRepoPath,
                    branch: branch.name,
                    remote: snapshot.summary.remoteName
                  }))}>
                    <UploadCloud size={16} />
                  </button>
                )}
                {!branch.upstream && snapshot?.summary.remoteName && (
                  <button className="icon-button" type="button" title="Track upstream" aria-label="Track upstream" onClick={() => setBranchUpstream(branch)} disabled={busy || isEditingDescription}>
                    <Link2 size={16} />
                  </button>
                )}
                <button
                  className="icon-button"
                  type="button"
                  title="Compare with current"
                  aria-label="Compare with current"
                  disabled={busy || branch.current || isEditingDescription || Boolean(branchComparisonLoading)}
                  onClick={() => compareBranch(branch)}
                >
                  {branchComparisonLoading === branch.name ? <Loader2 className="spin" size={16} /> : <GitCompare size={16} />}
                </button>
                <button
                  className="icon-button"
                  type="button"
                  title="Switch to branch"
                  aria-label="Switch to branch"
                  disabled={busy || branch.current || isEditingDescription}
                  onClick={() => currentRepoPath && runSnapshotAction('Branch switched.', () => api!.switchBranch({ repoPath: currentRepoPath, branchName: branch.name }))}
                >
                  <GitBranch size={16} />
                </button>
                <button
                  className="danger-button icon-button"
                  type="button"
                  title="Delete branch"
                  aria-label="Delete branch"
                  disabled={busy || branch.current || isEditingDescription}
                  onClick={() => deleteBranch(branch)}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </article>
          )
        })}
      </div>

      <section className="remote-branch-panel">
        <div className="branch-section-heading">
          <div>
            <h3>Remote branches</h3>
            <p>Read-only remote tracking refs from the last fetch.</p>
          </div>
          <span>{filteredRemoteBranches.length} / {remoteBranches.length}</span>
        </div>

        <div className="remote-branch-list">
          {remoteBranches.length === 0 ? (
            <div className="quiet-box">No fetched remote branches.</div>
          ) : filteredRemoteBranches.length === 0 ? (
            <div className="quiet-box">No remote branches match this search.</div>
          ) : (
            filteredRemoteBranches.map((branch) => (
              <article className="remote-branch-row" key={branch.name}>
                <div>
                  <strong>{branch.branchName}</strong>
                  <span>{branch.name} · {branch.lastCommitAt ? formatDate(branch.lastCommitAt) : 'No commit date'}</span>
                </div>
                <code>{branch.remote}</code>
              </article>
            ))
          )}
        </div>
      </section>

      {branchComparison && (
        <section className="branch-compare-panel">
          <div className="branch-compare-heading">
            <div>
              <h3>{branchComparison.targetBranch}</h3>
              <p>Compared against {branchComparison.baseBranch}</p>
            </div>
            <span>
              {branchComparison.targetOnlyCommits} ahead · {branchComparison.baseOnlyCommits} behind · {branchComparison.files.length} files
            </span>
          </div>
          {branchComparison.summaryText ? (
            <pre><code>{branchComparison.summaryText}</code></pre>
          ) : (
            <div className="quiet-box">No file changes between these branches.</div>
          )}
          {branchComparison.tooLarge && <div className="command-hint">Compare summary was truncated for performance.</div>}
          {branchComparison.files.length > 0 && (
            <div className="branch-compare-files">
              {branchComparison.files.slice(0, 24).map((file) => (
                <div className="commit-file-row" key={`${file.rawStatus}-${file.path}-${file.originalPath ?? ''}`}>
                  <span className={`file-status status-${file.status}`}>{fileStatusToken(file.status)}</span>
                  <span className="file-name">{file.originalPath ? `${file.originalPath} → ${file.path}` : file.path}</span>
                </div>
              ))}
              {branchComparison.files.length > 24 && (
                <div className="quiet-box">{branchComparison.files.length - 24} more changed files.</div>
              )}
            </div>
          )}
        </section>
      )}

      <section className="worktree-panel">
        <div className="panel-heading">
          <div>
            <h3>Worktrees</h3>
            <p>Create a linked worktree for safe branch experiments without disturbing this checkout.</p>
          </div>
          <span>{worktrees.length} worktree{worktrees.length === 1 ? '' : 's'}</span>
        </div>

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

      <section className="tag-panel">
        <div className="panel-heading">
          <div>
            <h3>Tags</h3>
            <p>Create lightweight or annotated local tags at the current HEAD.</p>
          </div>
          <span>{tags.length} tag{tags.length === 1 ? '' : 's'}</span>
        </div>

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
    </section>
  )
}
