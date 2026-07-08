import type { MouseEvent as ReactMouseEvent } from 'react'
import { CircleAlert, Folder, TriangleAlert } from 'lucide-react'
import type { FileChange, RepositoryFileEntry } from '../../../shared/branchPilot'
import { fileStatusToken } from '../../../lib/fileChangeLabels'
import { fileTypeIconForPath } from '../../../lib/fileTypeIcons'
import { healthRunLabel, type EditorHealthReport } from './editorHealth'
import { fileDisplayName, type FileTreeFolder } from './fileTree'
import type { RepositoryContentSearchMatch, RepositoryContentSearchState } from './editorStateTypes'

export interface EditorFileTreePanelProps {
  filesLoading: boolean
  filesError: string | null
  visibleFiles: RepositoryFileEntry[]
  fileContentSearchState: RepositoryContentSearchState
  visibleFileTree: FileTreeFolder
  changeByPath: Map<string, FileChange>
  selectedPath: string
  dirty: boolean
  healthEnabled: boolean
  healthRowSignals: boolean
  fileHealthByPath: Map<string, EditorHealthReport>
  fileContentMatches: Record<string, RepositoryContentSearchMatch>
  selectedFileRowRef: { current: HTMLButtonElement | null }
  openRepositoryFileRow: (file: RepositoryFileEntry, contentMatch?: RepositoryContentSearchMatch) => void
  openFileContextMenu: (event: ReactMouseEvent, path: string) => void
}

export function EditorFileTreePanel({
  filesLoading,
  filesError,
  visibleFiles,
  fileContentSearchState,
  visibleFileTree,
  changeByPath,
  selectedPath,
  dirty,
  healthEnabled,
  healthRowSignals,
  fileHealthByPath,
  fileContentMatches,
  selectedFileRowRef,
  openRepositoryFileRow,
  openFileContextMenu
}: EditorFileTreePanelProps) {
  const renderFileRow = (file: RepositoryFileEntry, displayName: string) => {
    const change = changeByPath.get(file.path)
    const fileTypeIcon = fileTypeIconForPath(file.path)
    const selected = selectedPath === file.path
    const contentMatch = fileContentMatches[file.path]
    const fileIsDirty = selected && dirty
    const statusClassName = fileIsDirty ? 'status-edited' : change ? `status-${change.status}` : ''
    const statusLabel = fileIsDirty ? 'E' : change ? fileStatusToken(change.status) : ''
    const statusTitle = fileIsDirty ? 'Edited since load' : change ? change.status : ''
    const fileHealth = healthEnabled && healthRowSignals ? fileHealthByPath.get(file.path) ?? null : null
    const fileHealthIssues = fileHealth?.issues ?? []
    const fileHealthTitle = fileHealthIssues.map((issue) => `[${healthRunLabel(issue.run)}] ${issue.title}: ${issue.detail}`).join('\n')
    const fileHealthClass = fileHealthIssues.length > 0 ? `health-${fileHealth?.severity ?? 'warning'}` : ''
    const FileHealthIcon = fileHealth?.severity === 'critical' ? TriangleAlert : CircleAlert

    return (
      <button
        type="button"
        ref={selected ? selectedFileRowRef : undefined}
        className={[
          'changes-editor-file-row',
          selected ? 'selected' : '',
          fileIsDirty ? 'edited' : '',
          change ? 'changed' : 'clean',
          fileHealthClass
        ].filter(Boolean).join(' ')}
        key={file.path}
        onClick={() => openRepositoryFileRow(file, contentMatch)}
        onContextMenu={(event) => openFileContextMenu(event, file.path)}
        title={contentMatch ? `${file.path}\nContent match at ${contentMatch.lineNumber}:${contentMatch.column + 1}` : file.path}
      >
        <span className={`file-type-icon file-type-${fileTypeIcon.tone}`} title={fileTypeIcon.title} aria-hidden="true">
          {fileTypeIcon.label}
        </span>
        <span className="file-name">{displayName}</span>
        {statusLabel && (
          <span className={`file-status ${statusClassName}`} title={statusTitle} aria-label={statusTitle}>
            {statusLabel}
          </span>
        )}
        {fileHealth && fileHealthIssues.length > 0 && (
          <span
            className={`changes-editor-file-health health-${fileHealth.severity}`}
            title={fileHealthTitle}
            aria-label={fileHealthTitle}
          >
            <FileHealthIcon size={12} />
          </span>
        )}
        {contentMatch && (
          <small className="changes-editor-file-content-match">
            L{contentMatch.lineNumber}: {contentMatch.preview}
          </small>
        )}
      </button>
    )
  }

  const renderFolderTree = (folder: FileTreeFolder, depth: number) => (
    <div className={`changes-editor-tree-folder rail-${depth % 4}`} key={folder.path}>
      <div className="changes-editor-folder-row" title={folder.path}>
        <Folder size={13} />
        <span className="changes-editor-folder-path">{folder.name}</span>
      </div>
      {folder.files.map((file) => renderFileRow(file, fileDisplayName(file.path, folder.path)))}
      {folder.children.map((child) => renderFolderTree(child, depth + 1))}
    </div>
  )

  return (
    <div className="changes-editor-file-list">
      {filesLoading ? (
        <div className="quiet-box">Loading files.</div>
      ) : filesError ? (
        <div className="quiet-box danger-text">{filesError}</div>
      ) : visibleFiles.length === 0 ? (
        <div className="quiet-box">{fileContentSearchState.status === 'searching' ? 'Searching file contents.' : 'No files match this search.'}</div>
      ) : (
        <div className="changes-editor-tree-root">
          {visibleFileTree.files.map((file) => renderFileRow(file, file.path))}
          {visibleFileTree.children.map((folder) => renderFolderTree(folder, 0))}
        </div>
      )}
    </div>
  )
}
