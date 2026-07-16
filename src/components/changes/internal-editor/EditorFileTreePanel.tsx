import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import { CircleAlert, Folder, TriangleAlert } from 'lucide-react'
import type { FileChange, RepositoryFileEntry } from '../../../shared/branchPilot'
import { fileStatusToken } from '../../../lib/fileChangeLabels'
import { fileTypeIconForPath } from '../../../lib/fileTypeIcons'
import { useVirtualList } from '../../../hooks/useVirtualList'
import { healthRunLabel, type EditorHealthReport } from './editorHealth'
import { flattenFileTree, type FileTreeFolder } from './fileTree'
import type { RepositoryContentSearchMatch, RepositoryContentSearchState } from './editorStateTypes'

// Fixed row pitch (kept in sync with the row height in editor-file-tree.css) so the tree can
// be windowed; the editor lists the entire repository, and mounting every row at once on a
// large repo freezes the renderer. TREE_INDENT reproduces folder depth via padding.
const EDITOR_TREE_ROW_HEIGHT = 38
const TREE_INDENT = 14

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
  const rows = useMemo(() => flattenFileTree(visibleFileTree), [visibleFileTree])
  const { containerRef: attachContainer, onScroll: onListScroll, window: treeWindow, items: treeItems } =
    useVirtualList(rows, EDITOR_TREE_ROW_HEIGHT)

  // The windowing hook owns the scroll container through a callback ref; keep our own handle
  // to it as well so selection changes can scroll a row into view even when it is not mounted.
  const listElementRef = useRef<HTMLDivElement | null>(null)
  const setListElement = useCallback((element: HTMLDivElement | null) => {
    listElementRef.current = element
    attachContainer(element)
  }, [attachContainer])

  useEffect(() => {
    if (!selectedPath) return
    const element = listElementRef.current
    if (!element) return

    const index = rows.findIndex((row) => row.kind === 'file' && row.file.path === selectedPath)
    if (index < 0) return

    const rowTop = index * EDITOR_TREE_ROW_HEIGHT
    const rowBottom = rowTop + EDITOR_TREE_ROW_HEIGHT
    if (rowTop < element.scrollTop || rowBottom > element.scrollTop + element.clientHeight) {
      element.scrollTop = Math.max(0, rowTop - element.clientHeight / 2 + EDITOR_TREE_ROW_HEIGHT / 2)
    }
  }, [rows, selectedPath])

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
        onClick={() => openRepositoryFileRow(file, contentMatch)}
        onContextMenu={(event) => openFileContextMenu(event, file.path)}
        title={contentMatch ? `${file.path}\nContent match at ${contentMatch.lineNumber}:${contentMatch.column + 1}` : file.path}
      >
        <span className={`file-type-icon file-type-${fileTypeIcon.tone}`} title={fileTypeIcon.title} aria-hidden="true">
          {fileTypeIcon.label}
        </span>
        <span className="changes-editor-file-namecell">
          <span className="file-name">{displayName}</span>
          {contentMatch && (
            <small className="changes-editor-file-content-match" title={`L${contentMatch.lineNumber}: ${contentMatch.preview}`}>
              L{contentMatch.lineNumber}: {contentMatch.preview}
            </small>
          )}
        </span>
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
      </button>
    )
  }

  const renderFolderRow = (folder: FileTreeFolder) => (
    <div className="changes-editor-folder-row" title={folder.path}>
      <Folder size={13} />
      <span className="changes-editor-folder-path">{folder.name}</span>
    </div>
  )

  return (
    <div className="changes-editor-file-list" ref={setListElement} onScroll={onListScroll}>
      {filesLoading ? (
        <div className="quiet-box">Loading files.</div>
      ) : filesError ? (
        <div className="quiet-box danger-text">{filesError}</div>
      ) : visibleFiles.length === 0 ? (
        <div className="quiet-box">{fileContentSearchState.status === 'searching' ? 'Searching file contents.' : 'No files match this search.'}</div>
      ) : (
        <div className="virtual-list-spacer" style={{ height: treeWindow.totalHeight }}>
          {treeItems.map(({ item, index }) => (
            <div
              className="virtual-list-item"
              key={item.key}
              style={{ transform: `translateY(${index * EDITOR_TREE_ROW_HEIGHT}px)`, paddingLeft: 6 + item.depth * TREE_INDENT }}
            >
              {item.kind === 'folder'
                ? renderFolderRow(item.folder)
                : renderFileRow(item.file, item.displayName)}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
