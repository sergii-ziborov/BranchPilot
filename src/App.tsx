import { useEffect, useMemo, useState } from 'react'
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Bot,
  Check,
  Code2,
  FileWarning,
  FolderOpen,
  GitBranch,
  GitCommitHorizontal,
  GitMerge,
  GitPullRequest,
  Loader2,
  Plus,
  RefreshCcw,
  ShieldCheck,
  Trash2,
  UploadCloud,
  X
} from 'lucide-react'
import type {
  ApiResult,
  AssistantStatus,
  BranchSummary,
  DiffResult,
  FileChange,
  ProviderStatus,
  RecentRepository,
  RepositorySnapshot
} from './shared/branchPilot'
import './App.css'

type ViewMode = 'changes' | 'merge' | 'branches' | 'review' | 'providers'
type DiffMode = 'unstaged' | 'staged'

const api = window.branchPilot

function App() {
  const [appVersion, setAppVersion] = useState('0.0.0')
  const [snapshot, setSnapshot] = useState<RepositorySnapshot | null>(null)
  const [recentRepositories, setRecentRepositories] = useState<RecentRepository[]>([])
  const [providers, setProviders] = useState<ProviderStatus[]>([])
  const [assistants, setAssistants] = useState<AssistantStatus[]>([])
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null)
  const [diffMode, setDiffMode] = useState<DiffMode>('unstaged')
  const [diff, setDiff] = useState<DiffResult | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>('changes')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('Open a repository to begin.')
  const [error, setError] = useState<string | null>(null)
  const [commitTitle, setCommitTitle] = useState('')
  const [commitDescription, setCommitDescription] = useState('')
  const [newBranchName, setNewBranchName] = useState('')

  const selectedChange = useMemo(
    () => snapshot?.status.changes.find((change) => change.path === selectedFilePath) ?? null,
    [selectedFilePath, snapshot]
  )

  useEffect(() => {
    if (!api) {
      setError('BranchPilot desktop runtime is not available. Open the Electron app to use Git features.')
      return
    }

    void api.getVersion().then(setAppVersion)
    void loadRecentRepositories()
    void loadProviders()
    void loadAssistants()
  }, [])

  useEffect(() => {
    if (!snapshot) return

    const firstChange = snapshot.status.changes[0]

    if (!selectedFilePath || !snapshot.status.changes.some((change) => change.path === selectedFilePath)) {
      setSelectedFilePath(firstChange?.path ?? null)
      setDiffMode(firstChange?.staged && !firstChange.unstaged ? 'staged' : 'unstaged')
    }
  }, [selectedFilePath, snapshot])

  useEffect(() => {
    if (!snapshot || !selectedChange) {
      setDiff(null)
      return
    }

    void loadDiff(selectedChange, diffMode)
  }, [diffMode, selectedChange, snapshot])

  const currentRepoPath = snapshot?.summary.rootPath
  const counts = snapshot?.status.counts
  const mergeState = snapshot?.status.merge

  async function loadRecentRepositories() {
    if (!api) return
    const result = await api.getRecentRepositories()
    if (result.ok) setRecentRepositories(result.data)
  }

  async function loadProviders() {
    if (!api) return
    const result = await api.listProviders()
    if (result.ok) setProviders(result.data)
  }

  async function loadAssistants() {
    if (!api) return
    const result = await api.listAssistants()
    if (result.ok) setAssistants(result.data)
  }

  async function chooseRepository() {
    if (!api) return
    setBusy(true)
    setError(null)

    const result = await api.chooseAndOpenRepository()

    if (result.ok && result.data) {
      applySnapshot(result.data, 'Repository opened.')
    } else if (!result.ok) {
      setError(result.error.message)
    }

    setBusy(false)
  }

  async function openRepository(path: string) {
    if (!api) return
    setBusy(true)
    const result = await api.openRepository(path)
    applySnapshotResult(result, 'Repository opened.')
    setBusy(false)
  }

  async function refreshRepository(message = 'Repository refreshed.') {
    if (!api || !currentRepoPath) return
    setBusy(true)
    const result = await api.refreshRepository(currentRepoPath)
    applySnapshotResult(result, message)
    setBusy(false)
  }

  async function loadDiff(change: FileChange, mode: DiffMode) {
    if (!api || !currentRepoPath) return
    const staged = mode === 'staged' && change.staged
    const result = await api.getDiff({
      repoPath: currentRepoPath,
      filePath: change.path,
      staged
    })

    if (result.ok) {
      setDiff(result.data)
    } else {
      setDiff(null)
      setError(result.error.message)
    }
  }

  async function runSnapshotAction(label: string, action: () => Promise<ApiResult<RepositorySnapshot>>) {
    setBusy(true)
    setError(null)
    const result = await action()
    applySnapshotResult(result, label)
    setBusy(false)
  }

  function applySnapshotResult(result: ApiResult<RepositorySnapshot>, successMessage: string) {
    if (result.ok) {
      applySnapshot(result.data, successMessage)
    } else {
      setError(result.error.message)
      setNotice(result.error.details || result.error.code)
    }
  }

  function applySnapshot(nextSnapshot: RepositorySnapshot, successMessage: string) {
    setSnapshot(nextSnapshot)
    setRecentRepositories(nextSnapshot.recentRepositories)
    setNotice(successMessage)
    setError(null)
  }

  async function stageSelected() {
    if (!api || !currentRepoPath || !selectedChange) return
    await runSnapshotAction('File staged.', () =>
      api.stageFile({ repoPath: currentRepoPath, filePath: selectedChange.path })
    )
  }

  async function unstageSelected() {
    if (!api || !currentRepoPath || !selectedChange) return
    await runSnapshotAction('File unstaged.', () =>
      api.unstageFile({ repoPath: currentRepoPath, filePath: selectedChange.path })
    )
  }

  async function discardSelected() {
    if (!api || !currentRepoPath || !selectedChange) return
    const confirmed = window.confirm(`Discard local changes in ${selectedChange.path}?`)
    if (!confirmed) return

    const action = selectedChange.untracked ? api.deleteUntrackedFile : api.discardFile

    await runSnapshotAction('File discarded.', () =>
      action({ repoPath: currentRepoPath, filePath: selectedChange.path, confirmed })
    )
  }

  async function commitChanges() {
    if (!api || !currentRepoPath) return
    await runSnapshotAction('Commit created.', () =>
      api.commit({
        repoPath: currentRepoPath,
        title: commitTitle,
        description: commitDescription
      })
    )
    setCommitTitle('')
    setCommitDescription('')
  }

  async function createBranch() {
    if (!api || !currentRepoPath || !newBranchName.trim()) return
    await runSnapshotAction('Branch created.', () =>
      api.createBranch({ repoPath: currentRepoPath, branchName: newBranchName })
    )
    setNewBranchName('')
  }

  const navigation = [
    { id: 'changes' as const, label: 'Changes', icon: GitCommitHorizontal },
    { id: 'merge' as const, label: 'Merge', icon: GitMerge },
    { id: 'branches' as const, label: 'Branches', icon: GitBranch },
    { id: 'review' as const, label: 'Review', icon: ShieldCheck },
    { id: 'providers' as const, label: 'Providers', icon: GitPullRequest }
  ]

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">BP</div>
          <div>
            <strong>BranchPilot</strong>
            <span>Local-first Git client</span>
          </div>
        </div>

        <button className="repo-picker" type="button" onClick={chooseRepository} disabled={!api || busy}>
          <FolderOpen size={18} />
          <span>{snapshot?.summary.name ?? 'Open repository'}</span>
        </button>

        <nav className="nav-list" aria-label="Primary">
          {navigation.map((item) => (
            <button
              className={viewMode === item.id ? 'active' : ''}
              type="button"
              key={item.id}
              onClick={() => setViewMode(item.id)}
            >
              <item.icon size={18} />
              {item.label}
            </button>
          ))}
        </nav>

        <div className="recent-list">
          <span className="section-label">Recent repositories</span>
          {recentRepositories.length === 0 ? (
            <p>No recent repositories.</p>
          ) : (
            recentRepositories.map((repo) => (
              <button type="button" key={repo.path} onClick={() => openRepository(repo.path)}>
                <strong>{repo.name}</strong>
                <span>{repo.path}</span>
              </button>
            ))
          )}
        </div>

        <div className="runtime-status">
          <span>
            <Check size={15} />
            v{appVersion}
          </span>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Repository workspace</p>
            <h1>{snapshot?.summary.currentBranch ?? 'No repository selected'}</h1>
            <p className="repo-path">{snapshot?.summary.rootPath ?? 'Open a Git repository to inspect real changes.'}</p>
          </div>
          <div className="toolbar" aria-label="Repository actions">
            <button type="button" onClick={() => refreshRepository()} disabled={!snapshot || busy}>
              <RefreshCcw size={17} />
              Refresh
            </button>
            <button
              type="button"
              onClick={() => currentRepoPath && runSnapshotAction('Fetch complete.', () => api!.fetch(currentRepoPath))}
              disabled={!snapshot || busy}
            >
              <ArrowDownToLine size={17} />
              Fetch
            </button>
            <button
              type="button"
              onClick={() => currentRepoPath && runSnapshotAction('Pull complete.', () => api!.pull(currentRepoPath))}
              disabled={!snapshot || busy}
            >
              <ArrowDownToLine size={17} />
              Pull
            </button>
            <button
              type="button"
              onClick={() => currentRepoPath && runSnapshotAction('Push complete.', () => api!.push(currentRepoPath))}
              disabled={!snapshot || busy}
            >
              <ArrowUpFromLine size={17} />
              Push
            </button>
          </div>
        </header>

        {error && (
          <div className="message error">
            <FileWarning size={18} />
            {error}
          </div>
        )}
        <div className="message">
          {busy ? <Loader2 className="spin" size={18} /> : <Check size={18} />}
          {notice}
        </div>

        {!snapshot ? (
          <section className="empty-state">
            <FolderOpen size={42} />
            <h2>Open a local Git repository</h2>
            <p>BranchPilot will read status, diffs, branches, merge state, and local Git configuration.</p>
            <button type="button" onClick={chooseRepository} disabled={!api || busy}>
              Open repository
            </button>
          </section>
        ) : (
          <>
            <section className="stats-grid" aria-label="Repository status">
              <Stat label="Changed files" value={counts?.changed ?? 0} />
              <Stat label="Staged" value={counts?.staged ?? 0} />
              <Stat label="Unstaged" value={counts?.unstaged ?? 0} />
              <Stat label="Conflicts" value={counts?.conflicted ?? 0} />
              <Stat label="Ahead / behind" value={`${snapshot.summary.ahead} / ${snapshot.summary.behind}`} />
              <Stat label="Remote" value={snapshot.summary.upstream ?? snapshot.summary.remoteName ?? 'None'} />
            </section>

            {viewMode === 'changes' && renderChangesView()}
            {viewMode === 'merge' && renderMergeView()}
            {viewMode === 'branches' && renderBranchesView(snapshot.branches)}
            {viewMode === 'review' && renderReviewView()}
            {viewMode === 'providers' && renderProvidersView()}
          </>
        )}
      </section>
    </main>
  )

  function renderChangesView() {
    return (
      <section className="content-grid">
        <div className="changes-panel">
          <div className="panel-heading">
            <div>
              <h2>Changes</h2>
              <p>Real status from system Git.</p>
            </div>
            <div className="panel-actions">
              <button type="button" onClick={() => currentRepoPath && runSnapshotAction('All changes staged.', () => api!.stageAll(currentRepoPath))}>
                <Plus size={17} />
                Stage all
              </button>
              <button type="button" onClick={() => currentRepoPath && runSnapshotAction('All changes unstaged.', () => api!.unstageAll(currentRepoPath))}>
                <X size={17} />
                Unstage all
              </button>
            </div>
          </div>

          <div className="change-list">
            {snapshot?.status.changes.length === 0 ? (
              <div className="quiet-box">Working tree is clean.</div>
            ) : (
              snapshot?.status.changes.map((change) => (
                <div className={selectedFilePath === change.path ? 'change-row selected' : 'change-row'} key={change.path}>
                  <button
                    className="change-select"
                    type="button"
                    onClick={() => {
                      setSelectedFilePath(change.path)
                      setDiffMode(change.staged && !change.unstaged ? 'staged' : 'unstaged')
                    }}
                  >
                    <span className={`file-status status-${change.status}`}>{statusToken(change)}</span>
                    <span className="file-name">{change.path}</span>
                    <span className="file-state">{changeLabel(change)}</span>
                  </button>
                </div>
              ))
            )}
          </div>

          <div className="commit-box">
            <label htmlFor="commit-title">Commit title</label>
            <input
              id="commit-title"
              value={commitTitle}
              onChange={(event) => setCommitTitle(event.target.value)}
              placeholder="Summarize staged changes"
            />
            <label htmlFor="commit-description">Description</label>
            <textarea
              id="commit-description"
              value={commitDescription}
              onChange={(event) => setCommitDescription(event.target.value)}
              placeholder="Optional commit body"
            />
            <div className="commit-actions">
              <button type="button" onClick={commitChanges} disabled={busy || !counts?.staged}>
                <GitCommitHorizontal size={17} />
                Commit
              </button>
              <button
                type="button"
                className="secondary"
                onClick={async () => {
                  await commitChanges()
                  if (currentRepoPath) {
                    await runSnapshotAction('Push complete.', () => api!.push(currentRepoPath))
                  }
                }}
                disabled={busy || !counts?.staged}
              >
                <UploadCloud size={17} />
                Commit & push
              </button>
            </div>
          </div>
        </div>

        <div className="diff-panel">
          <div className="panel-heading">
            <div>
              <h2>Diff</h2>
              <p>{selectedChange?.path ?? 'Select a changed file'}</p>
            </div>
            <div className="panel-actions">
              <button type="button" onClick={stageSelected} disabled={!selectedChange || !selectedChange.unstaged}>
                <Plus size={17} />
                Stage
              </button>
              <button type="button" onClick={unstageSelected} disabled={!selectedChange || !selectedChange.staged}>
                <X size={17} />
                Unstage
              </button>
              <button type="button" onClick={discardSelected} disabled={!selectedChange || (!selectedChange.unstaged && !selectedChange.untracked)}>
                <Trash2 size={17} />
                Discard
              </button>
            </div>
          </div>

          {selectedChange && (
            <div className="segmented">
              <button
                className={diffMode === 'unstaged' ? 'active' : ''}
                type="button"
                onClick={() => setDiffMode('unstaged')}
                disabled={!selectedChange.unstaged && !selectedChange.untracked}
              >
                Unstaged
              </button>
              <button
                className={diffMode === 'staged' ? 'active' : ''}
                type="button"
                onClick={() => setDiffMode('staged')}
                disabled={!selectedChange.staged}
              >
                Staged
              </button>
            </div>
          )}

          <DiffPreview diff={diff} />
        </div>
      </section>
    )
  }

  function renderMergeView() {
    const hasOperation = mergeState && mergeState.operation !== 'none'

    return (
      <section className="single-panel">
        <div className="panel-heading">
          <div>
            <h2>Merge window</h2>
            <p>{hasOperation ? `${mergeState.operation} in progress` : 'No merge, rebase, or cherry-pick operation is active.'}</p>
          </div>
          <button
            type="button"
            disabled={!hasOperation}
            onClick={() => currentRepoPath && window.confirm('Abort the current Git operation?') && runSnapshotAction('Operation aborted.', () => api!.abortMergeOperation(currentRepoPath))}
          >
            <X size={17} />
            Abort
          </button>
        </div>

        {!hasOperation || mergeState.files.length === 0 ? (
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
                  <button type="button" onClick={() => api && runSnapshotAction('Opened in editor.', async () => {
                    await api.openInEditor({ targetPath: `${currentRepoPath}/${file.path}` })
                    return api.refreshRepository(currentRepoPath!)
                  })}>
                    <Code2 size={17} />
                    Editor
                  </button>
                  <button type="button" onClick={() => currentRepoPath && runSnapshotAction('Accepted ours.', () => api!.acceptOurs({ repoPath: currentRepoPath, filePath: file.path }))}>
                    Ours
                  </button>
                  <button type="button" onClick={() => currentRepoPath && runSnapshotAction('Accepted theirs.', () => api!.acceptTheirs({ repoPath: currentRepoPath, filePath: file.path }))}>
                    Theirs
                  </button>
                  <button type="button" onClick={() => currentRepoPath && runSnapshotAction('Marked resolved.', () => api!.markResolved({ repoPath: currentRepoPath, filePath: file.path }))}>
                    Mark resolved
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    )
  }

  function renderBranchesView(branches: BranchSummary[]) {
    return (
      <section className="single-panel">
        <div className="panel-heading">
          <div>
            <h2>Branches</h2>
            <p>Create, switch, and safely delete local branches.</p>
          </div>
          <div className="new-branch">
            <input
              value={newBranchName}
              onChange={(event) => setNewBranchName(event.target.value)}
              placeholder="feature/new-work"
            />
            <button type="button" onClick={createBranch} disabled={!newBranchName.trim()}>
              <GitBranch size={17} />
              Create
            </button>
          </div>
        </div>

        <div className="branch-list">
          {branches.map((branch) => (
            <article className={branch.current ? 'branch-row current' : 'branch-row'} key={branch.name}>
              <div>
                <strong>{branch.name}</strong>
                <span>{branch.upstream || 'No upstream'}</span>
              </div>
              <div className="panel-actions">
                <button
                  type="button"
                  disabled={branch.current}
                  onClick={() => currentRepoPath && runSnapshotAction('Branch switched.', () => api!.switchBranch({ repoPath: currentRepoPath, branchName: branch.name }))}
                >
                  Switch
                </button>
                <button
                  type="button"
                  disabled={branch.current}
                  onClick={() => currentRepoPath && window.confirm(`Delete local branch ${branch.name}?`) && runSnapshotAction('Branch deleted.', () => api!.deleteBranch({ repoPath: currentRepoPath, branchName: branch.name, force: false }))}
                >
                  Delete
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>
    )
  }

  function renderReviewView() {
    return (
      <section className="single-panel">
        <div className="panel-heading">
          <div>
            <h2>Review modes</h2>
            <p>Report-only review flows are scaffolded for the local assistant layer.</p>
          </div>
        </div>
        <div className="review-grid">
          <ReviewCard title="Consistency" description="Architecture, naming, tests, and unrelated-change checks." />
          <ReviewCard title="Security" description="Secrets, shell execution, dependency and auth-risk checks." />
          <ReviewCard title="Daily review" description="Daily commits, branches, pending changes, and next-action summary." />
        </div>
        <div className="assistant-grid">
          {assistants.map((assistant) => (
            <div className="provider-card" key={assistant.id}>
              <Bot size={20} />
              <strong>{assistant.label}</strong>
              <span>{assistant.detected ? `Detected: ${assistant.executable}` : 'Not detected'}</span>
            </div>
          ))}
        </div>
      </section>
    )
  }

  function renderProvidersView() {
    return (
      <section className="single-panel">
        <div className="panel-heading">
          <div>
            <h2>Providers</h2>
            <p>Provider adapters are in place; full auth starts after local Git core stabilizes.</p>
          </div>
        </div>
        <div className="assistant-grid">
          {providers.map((provider) => (
            <div className="provider-card" key={provider.id}>
              <GitPullRequest size={20} />
              <strong>{provider.label}</strong>
              <span>{provider.state}</span>
            </div>
          ))}
        </div>
      </section>
    )
  }
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="stat-tile">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function DiffPreview({ diff }: { diff: DiffResult | null }) {
  if (!diff) {
    return <div className="diff-empty">No diff selected.</div>
  }

  if (diff.binary) {
    return <div className="diff-empty">Binary file preview is not available.</div>
  }

  if (!diff.text.trim()) {
    return <div className="diff-empty">No textual diff for this selection.</div>
  }

  return (
    <pre className="diff-preview">
      {diff.tooLarge && <code className="line marker-base">Diff truncated for performance.</code>}
      {diff.text.split('\n').map((line, index) => (
        <code className={`line ${lineClass(line)}`} key={`${index}-${line.slice(0, 20)}`}>
          <span>{linePrefix(line)}</span>
          {line}
        </code>
      ))}
    </pre>
  )
}

function ReviewCard({ title, description }: { title: string; description: string }) {
  return (
    <article className="review-card">
      <ShieldCheck size={20} />
      <h3>{title}</h3>
      <p>{description}</p>
      <span>Planned</span>
    </article>
  )
}

function changeLabel(change: FileChange): string {
  const parts = []
  if (change.staged) parts.push('staged')
  if (change.unstaged) parts.push('unstaged')
  if (change.untracked) parts.push('untracked')
  if (change.conflicted) parts.push('conflict')
  return parts.join(' / ') || change.status
}

function statusToken(change: FileChange): string {
  if (change.conflicted) return '!'
  if (change.untracked) return '?'
  if (change.status === 'renamed') return 'R'
  if (change.status === 'deleted') return 'D'
  if (change.status === 'added') return 'A'
  return 'M'
}

function lineClass(line: string): string {
  if (line.startsWith('+') && !line.startsWith('+++')) return 'marker-add'
  if (line.startsWith('-') && !line.startsWith('---')) return 'marker-remove'
  return 'marker-base'
}

function linePrefix(line: string): string {
  if (line.startsWith('+') && !line.startsWith('+++')) return '+'
  if (line.startsWith('-') && !line.startsWith('---')) return '-'
  return ' '
}

export default App
