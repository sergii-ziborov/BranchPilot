import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, FileCode2, Save, Search } from 'lucide-react'
import type { ApiResult, BranchPilotApi, RepositoryFileEntry, RepositorySnapshot } from '../../shared/branchPilot'
import { fileStatusToken } from '../../lib/fileChangeLabels'
import { fileTypeIconForPath } from '../../lib/fileTypeIcons'
import { friendlyIpcErrorMessage } from '../../lib/ipcErrorMessage'

interface ChangesInternalEditorProps {
  api: BranchPilotApi | undefined
  currentRepoPath: string | undefined
  snapshot: RepositorySnapshot | null
  initialFilePath: string
  onBack: () => void
  setNotice: (message: string) => void
  runSnapshotAction: (label: string, action: () => Promise<ApiResult<RepositorySnapshot>>) => boolean | void | Promise<boolean>
}

function changedLineCount(originalText: string, draftText: string): number {
  const original = originalText.replace(/\r\n/g, '\n').split('\n')
  const draft = draftText.replace(/\r\n/g, '\n').split('\n')
  const count = Math.max(original.length, draft.length)
  let changed = 0

  for (let index = 0; index < count; index += 1) {
    if ((original[index] ?? '') !== (draft[index] ?? '')) changed += 1
  }

  return changed
}

interface LiveLineChange {
  lineNumber: number
  kind: 'added' | 'removed' | 'modified'
  before: string
  after: string
}

function buildLiveLineChanges(originalText: string, draftText: string): LiveLineChange[] {
  const original = originalText.replace(/\r\n/g, '\n').split('\n')
  const draft = draftText.replace(/\r\n/g, '\n').split('\n')
  const count = Math.max(original.length, draft.length)
  const changes: LiveLineChange[] = []

  for (let index = 0; index < count; index += 1) {
    const before = original[index] ?? ''
    const after = draft[index] ?? ''
    if (before === after) continue

    changes.push({
      lineNumber: index + 1,
      kind: before ? (after ? 'modified' : 'removed') : 'added',
      before,
      after
    })
  }

  return changes
}

export function ChangesInternalEditor({
  api,
  currentRepoPath,
  snapshot,
  initialFilePath,
  onBack,
  setNotice,
  runSnapshotAction
}: ChangesInternalEditorProps) {
  const [files, setFiles] = useState<RepositoryFileEntry[]>([])
  const [filesLoading, setFilesLoading] = useState(false)
  const [fileQuery, setFileQuery] = useState('')
  const [selectedPath, setSelectedPath] = useState(initialFilePath)
  const [originalText, setOriginalText] = useState('')
  const [draftText, setDraftText] = useState('')
  const [fileLoading, setFileLoading] = useState(false)
  const [filesError, setFilesError] = useState<string | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const changeByPath = useMemo(() => new Map((snapshot?.status.changes ?? []).map((change) => [change.path, change])), [snapshot])
  const query = fileQuery.trim().toLowerCase()
  const visibleFiles = useMemo(() => (
    query ? files.filter((file) => file.path.toLowerCase().includes(query)) : files
  ), [files, query])
  const dirty = draftText !== originalText
  const editedLines = dirty ? changedLineCount(originalText, draftText) : 0
  const liveChanges = useMemo(() => (dirty ? buildLiveLineChanges(originalText, draftText) : []), [dirty, originalText, draftText])
  const selectedIcon = fileTypeIconForPath(selectedPath)

  useEffect(() => {
    setSelectedPath(initialFilePath)
  }, [initialFilePath])

  useEffect(() => {
    if (!api || !currentRepoPath) return
    let cancelled = false
    setFilesLoading(true)
    setFilesError(null)
    void api.listRepositoryFiles(currentRepoPath)
      .then((result) => {
        if (cancelled) return
        setFilesLoading(false)
        if (result.ok) {
          setFiles(result.data)
          return
        }

        const message = friendlyIpcErrorMessage(result.error.message, 'Failed to load repository files.')
        setFilesError(message)
        setNotice(message)
      })
      .catch((error) => {
        if (cancelled) return
        setFilesLoading(false)
        const message = friendlyIpcErrorMessage(error instanceof Error ? error.message : '', 'Failed to load repository files.')
        setFilesError(message)
        setNotice(message)
      })

    return () => {
      cancelled = true
    }
  }, [api, currentRepoPath, setNotice])

  useEffect(() => {
    if (!api || !currentRepoPath || !selectedPath) return
    let cancelled = false
    setFileLoading(true)
    setFileError(null)
    void api.getRepositoryFileContent({ repoPath: currentRepoPath, filePath: selectedPath })
      .then((result) => {
        if (cancelled) return
        setFileLoading(false)
        if (!result.ok) {
          setFileError(friendlyIpcErrorMessage(result.error.message, 'Failed to load file.'))
          setOriginalText('')
          setDraftText('')
          return
        }
        if (result.data.binary) {
          setFileError('Binary files cannot be edited here.')
          setOriginalText('')
          setDraftText('')
          return
        }
        if (result.data.tooLarge) {
          setFileError('File is too large for the internal editor.')
          setOriginalText('')
          setDraftText('')
          return
        }
        setOriginalText(result.data.text)
        setDraftText(result.data.text)
      })
      .catch((error) => {
        if (cancelled) return
        setFileLoading(false)
        setFileError(friendlyIpcErrorMessage(error instanceof Error ? error.message : '', 'Failed to load file.'))
        setOriginalText('')
        setDraftText('')
      })

    return () => {
      cancelled = true
    }
  }, [api, currentRepoPath, selectedPath])

  const saveFile = async () => {
    if (!api || !currentRepoPath || !dirty || fileError) return
    setSaving(true)
    try {
      const result = await runSnapshotAction('File saved.', () => api.writeRepositoryFile({
        repoPath: currentRepoPath,
        filePath: selectedPath,
        text: draftText
      }))
      if (result !== false) {
        setOriginalText(draftText)
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="changes-internal-editor">
      <aside className="changes-editor-sidebar">
        <button type="button" className="secondary changes-editor-back" onClick={onBack}>
          <ArrowLeft size={16} />
          Back to diff
        </button>
        <label className="changes-editor-search">
          <Search size={15} />
          <input value={fileQuery} onChange={(event) => setFileQuery(event.target.value)} placeholder="Search repository files" />
        </label>
        <div className="changes-editor-file-list">
          {filesLoading ? (
            <div className="quiet-box">Loading files.</div>
          ) : filesError ? (
            <div className="quiet-box danger-text">{filesError}</div>
          ) : visibleFiles.length === 0 ? (
            <div className="quiet-box">No files match this search.</div>
          ) : visibleFiles.map((file) => {
            const change = changeByPath.get(file.path)
            const fileTypeIcon = fileTypeIconForPath(file.path)

            return (
              <button
                type="button"
                className={[
                  'changes-editor-file-row',
                  selectedPath === file.path ? 'selected' : '',
                  change ? 'changed' : ''
                ].filter(Boolean).join(' ')}
                key={file.path}
                onClick={() => setSelectedPath(file.path)}
                title={file.path}
              >
                <span className={`file-type-icon file-type-${fileTypeIcon.tone}`} title={fileTypeIcon.title} aria-hidden="true">
                  {fileTypeIcon.label}
                </span>
                <span className="file-name">{file.path}</span>
                {change && <span className={`file-status status-${change.status}`}>{fileStatusToken(change.status)}</span>}
              </button>
            )
          })}
        </div>
      </aside>

      <div className="changes-editor-main">
        <header className="changes-editor-header">
          <div>
            <h3>
              <FileCode2 size={16} />
              {selectedPath}
            </h3>
            <p>
              <span className={`file-type-icon file-type-${selectedIcon.tone}`} title={selectedIcon.title} aria-hidden="true">
                {selectedIcon.label}
              </span>
              {dirty ? `${editedLines} edited line${editedLines === 1 ? '' : 's'} since load` : 'No edits since load'}
            </p>
          </div>
          <button type="button" onClick={saveFile} disabled={!dirty || saving || fileLoading || Boolean(fileError)}>
            <Save size={16} />
            {saving ? 'Saving...' : 'Save file'}
          </button>
        </header>

        {fileError ? (
          <div className="quiet-box danger-text">{fileError}</div>
        ) : fileLoading ? (
          <div className="quiet-box">Loading file.</div>
        ) : (
          <div className={dirty ? 'changes-editor-body has-live-diff' : 'changes-editor-body'}>
            <textarea
              className={dirty ? 'changes-editor-textarea is-dirty' : 'changes-editor-textarea'}
              spellCheck={false}
              value={draftText}
              onChange={(event) => setDraftText(event.target.value)}
            />
            {dirty && (
              <aside className="changes-editor-live-diff" aria-label="Live file changes">
                <header>
                  <strong>Live changes</strong>
                  <span>{editedLines}</span>
                </header>
                <div>
                  {liveChanges.slice(0, 120).map((change) => (
                    <article className={`changes-editor-live-row ${change.kind}`} key={`${change.lineNumber}-${change.kind}`}>
                      <span>{change.lineNumber}</span>
                      <code>{change.after || change.before || ' '}</code>
                      {change.kind === 'modified' && <small>{change.before || ' '}</small>}
                    </article>
                  ))}
                  {liveChanges.length > 120 && <p>{liveChanges.length - 120} more changed lines.</p>}
                </div>
              </aside>
            )}
          </div>
        )}
      </div>
    </section>
  )
}
