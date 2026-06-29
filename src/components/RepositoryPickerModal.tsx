import { useEffect, useMemo, useState } from 'react'
import { ArrowUp, Check, Clock3, FolderOpen, GitBranch, Loader2, RefreshCcw, Search, Star } from 'lucide-react'
import type { BranchPilotApi, RecentRepository, RepositoryBrowserEntry, RepositoryBrowserSnapshot } from '../shared/branchPilot'
import { ToolModal } from './ToolModal'

interface RepositoryPickerModalProps {
  api: BranchPilotApi | undefined
  busy: boolean
  currentRepoPath: string | undefined
  recentRepositories: RecentRepository[]
  onClose: () => void
  openRepository: (path: string) => Promise<boolean>
  initializeRepository: (path: string) => Promise<boolean>
}

export function RepositoryPickerModal({
  api,
  busy,
  currentRepoPath,
  recentRepositories,
  onClose,
  openRepository,
  initializeRepository
}: RepositoryPickerModalProps) {
  const [snapshot, setSnapshot] = useState<RepositoryBrowserSnapshot | null>(null)
  const [pathDraft, setPathDraft] = useState(() => initialBrowserPath(currentRepoPath, recentRepositories))
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const recentParents = useMemo(() => uniquePaths(
    recentRepositories
      .map((repo) => parentPath(repo.path))
      .filter(Boolean) as string[]
  ).slice(0, 5), [recentRepositories])
  const recentPathSet = useMemo(() => new Set(recentRepositories.map((repo) => normalizePathKey(repo.path))), [recentRepositories])
  const currentPathKey = currentRepoPath ? normalizePathKey(currentRepoPath) : ''
  const selectedEntry = snapshot?.entries.find((entry) => entry.path === selectedPath)
  const openTarget = selectedEntry
    ? selectedEntry.isGitRepository ? selectedEntry.path : null
    : snapshot?.isGitRepository
      ? snapshot.path
      : null
  const initializeTarget = openTarget
    ? null
    : selectedEntry && !selectedEntry.isGitRepository
      ? selectedEntry.path
      : snapshot && !snapshot.isGitRepository
        ? snapshot.path
        : null
  const footerText = selectedEntry && !selectedEntry.isGitRepository
    ? 'This folder is not a Git repository. Create one here, or double-click to browse inside it.'
    : openTarget
      ? openTarget
      : snapshot?.isGitRepository
        ? snapshot.path
        : initializeTarget
          ? `Create a Git repository in ${pathLabel(initializeTarget)}.`
          : 'Choose a folder to open or create a repository.'
  const canBrowseSelectedFolder = Boolean(selectedEntry && !selectedEntry.isGitRepository)
  const primaryActionLabel = openTarget
      ? `Open ${pathLabel(openTarget)}`
      : initializeTarget
        ? `Create repository in ${pathLabel(initializeTarget)}`
        : 'Open repository'
  const filteredEntries = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!snapshot) return []
    if (!needle) return snapshot.entries
    return snapshot.entries.filter((entry) => `${entry.name} ${entry.path}`.toLowerCase().includes(needle))
  }, [query, snapshot])

  useEffect(() => {
    void loadDirectory(pathDraft)
  }, [])

  async function loadDirectory(nextPath: string) {
    if (!api?.browseRepositoryDirectory) return
    setLoading(true)
    setError(null)

    try {
      const result = await api.browseRepositoryDirectory({ path: nextPath })
      if (!result.ok) {
        setError(result.error.message)
        return
      }

      setSnapshot(result.data)
      setPathDraft(result.data.path)
      setSelectedPath(result.data.isGitRepository ? null : result.data.entries.find((entry) => entry.isGitRepository)?.path ?? null)
      setQuery('')
    } finally {
      setLoading(false)
    }
  }

  async function openSelectedRepository() {
    if (busy) {
      return
    }

    const opened = openTarget
      ? await openRepository(openTarget)
      : initializeTarget
        ? await initializeRepository(initializeTarget)
        : false

    if (opened) onClose()
  }

  async function browseSelectedFolder() {
    if (!selectedEntry || selectedEntry.isGitRepository) return
    await loadDirectory(selectedEntry.path)
  }

  return (
    <ToolModal title="Open repository" className="repository-picker-modal" onClose={onClose}>
      <section className="repository-picker">
        <aside className="repository-picker-side" aria-label="Repository locations">
          <button type="button" className="repository-picker-location primary" disabled={loading} onClick={() => void loadDirectory(initialBrowserPath(currentRepoPath, recentRepositories))}>
            <FolderOpen size={16} />
            Repository folder
          </button>
          {recentParents.map((parent) => (
            <button type="button" className="repository-picker-location" key={parent} disabled={loading} onClick={() => void loadDirectory(parent)}>
              <Clock3 size={15} />
              <span>{pathLabel(parent)}</span>
            </button>
          ))}
        </aside>

        <div className="repository-picker-main">
          <form className="repository-picker-path" onSubmit={(event) => { event.preventDefault(); void loadDirectory(pathDraft) }}>
            <input
              aria-label="Folder path"
              value={pathDraft}
              onChange={(event) => setPathDraft(event.target.value)}
              spellCheck={false}
            />
            <button type="submit" className="icon-button" title="Go to folder" aria-label="Go to folder" disabled={loading || !pathDraft.trim()}>
              {loading ? <Loader2 className="spin" size={16} /> : <RefreshCcw size={16} />}
            </button>
          </form>

          <div className="repository-picker-toolbar">
            <button
              type="button"
              className="secondary-button"
              disabled={loading || !snapshot?.parentPath}
              onClick={() => snapshot?.parentPath && void loadDirectory(snapshot.parentPath)}
            >
              <ArrowUp size={16} />
              Up
            </button>
            <label className="repository-picker-search">
              <Search size={15} />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search folders and repositories" />
            </label>
            <span className="repository-picker-count">{snapshot?.repositoryCount ?? 0} repos</span>
          </div>

          <div className="repository-picker-list" aria-label="Folders">
            {error && <div className="repository-picker-message danger">{error}</div>}
            {!error && loading && !snapshot && <div className="repository-picker-message">Loading folders...</div>}
            {!error && snapshot && filteredEntries.length === 0 && (
              <div className="repository-picker-message">No folders match this search.</div>
            )}
            {!error && snapshot && filteredEntries.map((entry) => {
              const selected = entry.path === selectedPath
              const active = normalizePathKey(entry.path) === currentPathKey
              const recent = recentPathSet.has(normalizePathKey(entry.path))

              return (
                <button
                  type="button"
                  key={entry.path}
                  className={entryClassName(entry, selected, active)}
                  onClick={() => setSelectedPath(entry.path)}
                  onDoubleClick={() => entry.isGitRepository ? void openRepository(entry.path).then((opened) => { if (opened) onClose() }) : void loadDirectory(entry.path)}
                >
                  <span className="repository-picker-entry-icon">
                    {entry.isGitRepository ? <GitBranch size={16} /> : <FolderOpen size={16} />}
                  </span>
                  <span className="repository-picker-entry-text">
                    <strong>{entry.name}</strong>
                    <small>{shortPath(entry.path)}</small>
                    {entry.tech && (
                      <span className="repository-picker-entry-tech">
                        {entry.tech.languages.map((language) => (
                          <span className="repository-picker-badge tech language" key={`${entry.path}-${language}`}>{language}</span>
                        ))}
                        {entry.tech.extraLanguageCount > 0 && (
                          <span className="repository-picker-badge tech more">+{entry.tech.extraLanguageCount}</span>
                        )}
                        {entry.tech.framework && (
                          <span className="repository-picker-badge tech framework">{entry.tech.framework}</span>
                        )}
                      </span>
                    )}
                  </span>
                  <span className="repository-picker-entry-meta">
                    {active && <span className="repository-picker-badge active"><Check size={12} /> Current</span>}
                    {recent && !active && <span className="repository-picker-badge recent"><Star size={12} /> Recent</span>}
                    {entry.isGitRepository && <span className="repository-picker-badge git">git</span>}
                  </span>
                </button>
              )
            })}
          </div>

          <div className="repository-picker-footer">
            <span>{footerText}</span>
            {canBrowseSelectedFolder && (
              <button type="button" className="secondary-button" onClick={browseSelectedFolder} disabled={busy || loading}>
                <FolderOpen size={17} />
                Browse folder
              </button>
            )}
            <button type="button" className="secondary-button" onClick={onClose} disabled={busy}>Cancel</button>
            <button type="button" onClick={openSelectedRepository} disabled={busy || loading || (!openTarget && !initializeTarget)}>
              {openTarget ? <FolderOpen size={17} /> : <GitBranch size={17} />}
              {primaryActionLabel}
            </button>
          </div>
        </div>
      </section>
    </ToolModal>
  )
}

function entryClassName(entry: RepositoryBrowserEntry, selected: boolean, active: boolean): string {
  return [
    'repository-picker-entry',
    entry.isGitRepository ? 'is-repo' : '',
    selected ? 'selected' : '',
    active ? 'active' : ''
  ].filter(Boolean).join(' ')
}

function initialBrowserPath(currentRepoPath: string | undefined, recentRepositories: RecentRepository[]): string {
  const seed = currentRepoPath ?? recentRepositories[0]?.path
  return parentPath(seed) ?? seed ?? ''
}

function parentPath(value: string | undefined): string | undefined {
  if (!value) return undefined
  const normalized = value.replace(/[\\/]+$/g, '')
  const index = Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\'))
  return index > 0 ? normalized.slice(0, index) : undefined
}

function pathLabel(value: string): string {
  const normalized = value.replace(/[\\/]+$/g, '')
  const index = Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\'))
  return index >= 0 ? normalized.slice(index + 1) || normalized : normalized
}

function shortPath(value: string): string {
  const parts = value.split(/[\\/]+/).filter(Boolean)
  return parts.length > 4 ? `...${value.includes('\\') ? '\\' : '/'}${parts.slice(-3).join(value.includes('\\') ? '\\' : '/')}` : value
}

function normalizePathKey(value: string): string {
  return value.replace(/[\\/]+$/g, '').toLowerCase()
}

function uniquePaths(paths: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []

  for (const path of paths) {
    const key = normalizePathKey(path)
    if (!key || seen.has(key)) continue
    seen.add(key)
    result.push(path)
  }

  return result
}
