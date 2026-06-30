import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type UIEvent as ReactUIEvent
} from 'react'
import { ArrowLeft, ChevronDown, ChevronUp, Code2, Copy, Eye, FileCode2, FileImage, Folder, FolderOpen, MinusSquare, PlusSquare, Save, Search, Terminal, X } from 'lucide-react'
import type { ApiResult, BranchPilotApi, ImagePreview, RepositoryFileEntry, RepositorySnapshot } from '../../shared/branchPilot'
import { fileStatusToken } from '../../lib/fileChangeLabels'
import { fileTypeIconForPath } from '../../lib/fileTypeIcons'
import { friendlyIpcErrorMessage } from '../../lib/ipcErrorMessage'
import { highlight, langFromPath } from '../../lib/highlight'
import { SignalStatus } from '../SignalStatus'

interface ChangesInternalEditorProps {
  api: BranchPilotApi | undefined
  currentRepoPath: string | undefined
  snapshot: RepositorySnapshot | null
  initialFilePath: string | null
  onBack: () => void
  setNotice: (message: string) => void
  runSnapshotAction: (label: string, action: () => Promise<ApiResult<RepositorySnapshot>>) => boolean | void | Promise<boolean>
}

const EDITOR_SIDEBAR_STORAGE_KEY = 'branchpilot:changes-editor-sidebar-width'
const EDITOR_SIDEBAR_DEFAULT_WIDTH = 460
const EDITOR_SIDEBAR_MIN_WIDTH = 280
const EDITOR_SIDEBAR_MAX_WIDTH = 760
const EDITOR_DETAIL_MIN_WIDTH = 520
const EDITOR_SPLITTER_WIDTH = 10
const EDITOR_LARGE_FILE_LINE_THRESHOLD = 1000
const EDITOR_INITIAL_RENDER_LINES = 720
const EDITOR_RENDER_BATCH_SIZE = 560
const EDITOR_RENDER_LOOKAHEAD = 160
const EDITOR_SEARCH_MATCH_LIMIT = 5000
const EDITOR_LINE_HEIGHT = 20.4
const PREVIEWABLE_IMAGE_RE = /\.(png|jpe?g|gif|webp|bmp|svg|ico|avif)$/i
const SVG_RE = /\.svg$/i
const JSON_RE = /\.(json|jsonc|lock)$/i

type EditorViewMode = 'code' | 'image' | 'json'

interface EditorFileMenu {
  x: number
  y: number
  path: string
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function clampEditorSidebarWidth(width: number, containerWidth?: number): number {
  const maxForContainer = containerWidth && containerWidth > 0
    ? Math.max(EDITOR_SIDEBAR_MIN_WIDTH, containerWidth - EDITOR_SPLITTER_WIDTH - EDITOR_DETAIL_MIN_WIDTH)
    : EDITOR_SIDEBAR_MAX_WIDTH

  return Math.round(clamp(width, EDITOR_SIDEBAR_MIN_WIDTH, Math.min(EDITOR_SIDEBAR_MAX_WIDTH, maxForContainer)))
}

function readStoredEditorSidebarWidth(): number {
  try {
    const rawWidth = window.localStorage.getItem(EDITOR_SIDEBAR_STORAGE_KEY)
    if (rawWidth === null) return EDITOR_SIDEBAR_DEFAULT_WIDTH

    const stored = Number(rawWidth)
    if (Number.isFinite(stored)) return clampEditorSidebarWidth(stored)
  } catch {
    /* ignore unavailable storage */
  }

  return EDITOR_SIDEBAR_DEFAULT_WIDTH
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

interface FileSearchMatch {
  lineNumber: number
  column: number
  length: number
}

interface JsonTreeNode {
  keyName?: string
  value: unknown
  depth: number
}

interface FileTreeFolder {
  name: string
  path: string
  files: RepositoryFileEntry[]
  children: FileTreeFolder[]
}

interface MutableFileTreeFolder extends FileTreeFolder {
  children: MutableFileTreeFolder[]
  childMap: Map<string, MutableFileTreeFolder>
}

function createFileTreeFolder(name: string, path: string): MutableFileTreeFolder {
  return {
    name,
    path,
    files: [],
    children: [],
    childMap: new Map()
  }
}

function fileDisplayName(filePath: string, folderPath: string): string {
  return folderPath ? filePath.slice(folderPath.length + 1) : filePath
}

function comparePathPart(left: string, right: string): number {
  return left.localeCompare(right, undefined, { sensitivity: 'base', numeric: true })
}

function sortFileTreeFolder(folder: MutableFileTreeFolder) {
  folder.files.sort((left, right) => {
    const byName = comparePathPart(fileDisplayName(left.path, folder.path), fileDisplayName(right.path, folder.path))
    return byName || comparePathPart(left.path, right.path)
  })
  folder.children.sort((left, right) => comparePathPart(left.name, right.name) || comparePathPart(left.path, right.path))
  folder.children.forEach(sortFileTreeFolder)
}

function buildRepositoryFileTree(files: RepositoryFileEntry[]): FileTreeFolder {
  const root = createFileTreeFolder('', '')

  for (const file of files) {
    const parts = file.path.split('/').filter(Boolean)
    if (parts.length <= 1) {
      root.files.push(file)
      continue
    }

    let folder = root
    for (let index = 0; index < parts.length - 1; index += 1) {
      const name = parts[index]
      const path = parts.slice(0, index + 1).join('/')
      let child = folder.childMap.get(name)
      if (!child) {
        child = createFileTreeFolder(name, path)
        folder.childMap.set(name, child)
        folder.children.push(child)
      }
      folder = child
    }

    folder.files.push(file)
  }

  sortFileTreeFolder(root)
  return root
}

function textLines(text: string): string[] {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const trimmed = normalized.endsWith('\n') ? normalized.slice(0, -1) : normalized
  return trimmed ? trimmed.split('\n') : ['']
}

function defaultViewModeForPath(filePath: string): EditorViewMode {
  if (PREVIEWABLE_IMAGE_RE.test(filePath)) return 'image'
  if (JSON_RE.test(filePath)) return 'json'
  return 'code'
}

function buildRepoFilePath(repoPath: string, filePath: string): string {
  const separator = repoPath.includes('\\') ? '\\' : '/'
  const root = repoPath.replace(/[\\/]+$/, '')
  const relativePath = filePath.replace(/^[\\/]+/, '').replace(/[\\/]+/g, separator)
  return `${root}${separator}${relativePath}`
}

function buildRepoFileDirectory(repoPath: string, filePath: string): string {
  const targetPath = buildRepoFilePath(repoPath, filePath)
  const lastSlash = Math.max(targetPath.lastIndexOf('/'), targetPath.lastIndexOf('\\'))
  return lastSlash > 0 ? targetPath.slice(0, lastSlash) : repoPath
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 102.4) / 10} KB`
  return `${Math.round(bytes / (1024 * 102.4)) / 10} MB`
}

function safeSvgDataUrl(svgText: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgText)}`
}

function flattenJsonTree(value: unknown, depth = 0, keyName?: string): JsonTreeNode[] {
  const node: JsonTreeNode = { keyName, value, depth }
  if (value === null || typeof value !== 'object') return [node]

  const rows = [node]
  if (Array.isArray(value)) {
    value.forEach((entry, index) => rows.push(...flattenJsonTree(entry, depth + 1, String(index))))
  } else {
    Object.entries(value as Record<string, unknown>).forEach(([key, entry]) => {
      rows.push(...flattenJsonTree(entry, depth + 1, key))
    })
  }
  return rows
}

function jsonValueSummary(value: unknown): { type: string; preview: ReactNode } {
  if (value === null) return { type: 'null', preview: <span className="tok-keyword">null</span> }
  if (Array.isArray(value)) return { type: 'array', preview: <span>{value.length} item{value.length === 1 ? '' : 's'}</span> }
  if (typeof value === 'object') return { type: 'object', preview: <span>{Object.keys(value as Record<string, unknown>).length} key{Object.keys(value as Record<string, unknown>).length === 1 ? '' : 's'}</span> }
  if (typeof value === 'string') return { type: 'string', preview: <span className="tok-string">"{value}"</span> }
  if (typeof value === 'number') return { type: 'number', preview: <span className="tok-number">{String(value)}</span> }
  if (typeof value === 'boolean') return { type: 'boolean', preview: <span className="tok-keyword">{String(value)}</span> }
  return { type: typeof value, preview: <span>{String(value)}</span> }
}

function buildLineOffsets(lines: string[]): number[] {
  const offsets: number[] = []
  let offset = 0

  for (const line of lines) {
    offsets.push(offset)
    offset += line.length + 1
  }

  return offsets
}

function findFileSearchMatches(lines: string[], needle: string): FileSearchMatch[] {
  const query = needle.trim()
  if (!query) return []

  const lowerQuery = query.toLowerCase()
  const matches: FileSearchMatch[] = []

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex]
    const lowerLine = line.toLowerCase()
    let column = lowerLine.indexOf(lowerQuery)

    while (column !== -1) {
      matches.push({ lineNumber: lineIndex + 1, column, length: query.length })
      if (matches.length >= EDITOR_SEARCH_MATCH_LIMIT) return matches
      column = lowerLine.indexOf(lowerQuery, column + Math.max(1, lowerQuery.length))
    }
  }

  return matches
}

function highlightedLineContent(line: string, lang: string, searchQuery: string, activeMatch: FileSearchMatch | null, lineNumber: number) {
  const query = searchQuery.trim()
  if (!query) return highlight(line || ' ', lang)

  const lowerLine = line.toLowerCase()
  const lowerQuery = query.toLowerCase()
  const chunks = []
  let last = 0
  let key = 0
  let column = lowerLine.indexOf(lowerQuery)

  while (column !== -1) {
    if (column > last) {
      const plain = line.slice(last, column)
      chunks.push(<span key={`plain-${key++}`}>{highlight(plain, lang)}</span>)
    }

    const token = line.slice(column, column + query.length)
    const active = activeMatch?.lineNumber === lineNumber && activeMatch.column === column
    chunks.push(
      <mark className={active ? 'changes-editor-search-hit active' : 'changes-editor-search-hit'} key={`match-${key++}`}>
        {highlight(token, lang)}
      </mark>
    )

    last = column + query.length
    column = lowerLine.indexOf(lowerQuery, last)
  }

  if (last < line.length) {
    chunks.push(<span key={`tail-${key++}`}>{highlight(line.slice(last), lang)}</span>)
  }

  return chunks.length ? chunks : highlight(line || ' ', lang)
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
  const editorRef = useRef<HTMLElement | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const highlightInnerRef = useRef<HTMLDivElement | null>(null)
  const lineNumbersInnerRef = useRef<HTMLDivElement | null>(null)
  const [sidebarWidth, setSidebarWidth] = useState(readStoredEditorSidebarWidth)
  const [files, setFiles] = useState<RepositoryFileEntry[]>([])
  const [filesLoading, setFilesLoading] = useState(false)
  const [fileQuery, setFileQuery] = useState('')
  const [fileSearchQuery, setFileSearchQuery] = useState('')
  const [activeSearchIndex, setActiveSearchIndex] = useState(-1)
  const [fileMenu, setFileMenu] = useState<EditorFileMenu | null>(null)
  const [viewMode, setViewMode] = useState<EditorViewMode>(() => defaultViewModeForPath(initialFilePath ?? ''))
  const [selectedPath, setSelectedPath] = useState(initialFilePath ?? '')
  const [originalText, setOriginalText] = useState('')
  const [draftText, setDraftText] = useState('')
  const [imagePreview, setImagePreview] = useState<ImagePreview | null>(null)
  const [imagePreviewLoading, setImagePreviewLoading] = useState(false)
  const [imagePreviewError, setImagePreviewError] = useState<string | null>(null)
  const [renderedLineCount, setRenderedLineCount] = useState(EDITOR_INITIAL_RENDER_LINES)
  const [fileLoading, setFileLoading] = useState(false)
  const [filesError, setFilesError] = useState<string | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [textUnavailableMessage, setTextUnavailableMessage] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const changeByPath = useMemo(() => new Map((snapshot?.status.changes ?? []).map((change) => [change.path, change])), [snapshot])
  const query = fileQuery.trim().toLowerCase()
  const visibleFiles = useMemo(() => (
    query ? files.filter((file) => file.path.toLowerCase().includes(query)) : files
  ), [files, query])
  const visibleFileTree = useMemo(() => buildRepositoryFileTree(visibleFiles), [visibleFiles])
  const dirty = draftText !== originalText
  const editedLines = dirty ? changedLineCount(originalText, draftText) : 0
  const liveChanges = useMemo(() => (dirty ? buildLiveLineChanges(originalText, draftText) : []), [dirty, originalText, draftText])
  const changeKindByLine = useMemo(() => new Map(liveChanges.map((change) => [change.lineNumber, change.kind])), [liveChanges])
  const draftLines = useMemo(() => textLines(draftText), [draftText])
  const lineOffsets = useMemo(() => buildLineOffsets(draftLines), [draftLines])
  const fileSearchMatches = useMemo(() => findFileSearchMatches(draftLines, fileSearchQuery), [draftLines, fileSearchQuery])
  const fileSearchOverflow = fileSearchMatches.length >= EDITOR_SEARCH_MATCH_LIMIT
  const activeSearchMatch = activeSearchIndex >= 0 ? fileSearchMatches[activeSearchIndex] ?? null : null
  const visibleDraftLines = useMemo(() => draftLines.slice(0, Math.min(renderedLineCount, draftLines.length)), [draftLines, renderedLineCount])
  const highlightBatching = !fileLoading && !fileError && draftLines.length > EDITOR_LARGE_FILE_LINE_THRESHOLD && renderedLineCount < draftLines.length
  const selectedIsImage = PREVIEWABLE_IMAGE_RE.test(selectedPath)
  const selectedIsSvg = SVG_RE.test(selectedPath)
  const selectedIsJson = JSON_RE.test(selectedPath)
  const selectedIsBinaryPreview = selectedIsImage && Boolean(textUnavailableMessage)
  const svgPreviewUrl = selectedIsSvg && draftText ? safeSvgDataUrl(draftText) : ''
  const activeImagePreviewUrl = selectedIsSvg ? (svgPreviewUrl || imagePreview?.dataUrl || '') : imagePreview?.dataUrl ?? ''
  const jsonParseResult = useMemo(() => {
    if (!selectedIsJson || !draftText.trim()) return { rows: [] as JsonTreeNode[], error: null as string | null }
    try {
      return { rows: flattenJsonTree(JSON.parse(draftText)), error: null }
    } catch (error) {
      return { rows: [] as JsonTreeNode[], error: error instanceof Error ? error.message : 'Invalid JSON.' }
    }
  }, [draftText, selectedIsJson])
  const selectedIcon = fileTypeIconForPath(selectedPath)
  const selectedLang = langFromPath(selectedPath)
  const contextMenuChange = fileMenu ? changeByPath.get(fileMenu.path) : null
  const availableViewModes = useMemo<Array<{ id: EditorViewMode; label: string }>>(() => {
    const modes: Array<{ id: EditorViewMode; label: string }> = []
    if (selectedIsImage) modes.push({ id: 'image', label: 'Preview' })
    if (!selectedIsBinaryPreview || selectedIsSvg) modes.push({ id: 'code', label: selectedIsSvg ? 'SVG' : 'Code' })
    if (selectedIsJson && !selectedIsBinaryPreview) modes.push({ id: 'json', label: 'JSON' })
    return modes.length ? modes : [{ id: 'code', label: 'Code' }]
  }, [selectedIsBinaryPreview, selectedIsImage, selectedIsJson, selectedIsSvg])
  const editorStyle = {
    '--changes-editor-sidebar-width': `${sidebarWidth}px`
  } as CSSProperties

  const openFileContextMenu = (event: ReactMouseEvent, path: string) => {
    if (!path) return
    event.preventDefault()
    event.stopPropagation()
    setFileMenu({ x: event.clientX, y: event.clientY, path })
  }

  const renderFileRow = (file: RepositoryFileEntry, displayName: string) => {
    const change = changeByPath.get(file.path)
    const fileTypeIcon = fileTypeIconForPath(file.path)
    const fileIsDirty = selectedPath === file.path && dirty
    const statusClassName = fileIsDirty ? 'status-edited' : change ? `status-${change.status}` : ''
    const statusLabel = fileIsDirty ? 'E' : change ? fileStatusToken(change.status) : ''
    const statusTitle = fileIsDirty ? 'Edited since load' : change ? change.status : ''

    return (
      <button
        type="button"
        className={[
          'changes-editor-file-row',
          selectedPath === file.path ? 'selected' : '',
          fileIsDirty ? 'edited' : '',
          change ? 'changed' : 'clean'
        ].filter(Boolean).join(' ')}
        key={file.path}
        onClick={() => setSelectedPath(file.path)}
        onContextMenu={(event) => openFileContextMenu(event, file.path)}
        title={file.path}
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

  const persistSidebarWidth = (width: number) => {
    try {
      window.localStorage.setItem(EDITOR_SIDEBAR_STORAGE_KEY, String(width))
    } catch {
      /* ignore unavailable storage */
    }
  }

  const resizeSidebar = (clientX: number) => {
    const editor = editorRef.current
    if (!editor) return sidebarWidth

    const rect = editor.getBoundingClientRect()
    const nextWidth = clampEditorSidebarWidth(clientX - rect.left, rect.width)
    setSidebarWidth(nextWidth)
    return nextWidth
  }

  const nudgeSidebar = (delta: number) => {
    const editor = editorRef.current
    const containerWidth = editor?.getBoundingClientRect().width
    setSidebarWidth((width) => {
      const nextWidth = clampEditorSidebarWidth(width + delta, containerWidth)
      persistSidebarWidth(nextWidth)
      return nextWidth
    })
  }

  const startSidebarResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return

    event.preventDefault()
    let latestWidth = resizeSidebar(event.clientX)
    document.body.classList.add('is-resizing-editor-sidebar')

    const handlePointerMove = (moveEvent: PointerEvent) => {
      latestWidth = resizeSidebar(moveEvent.clientX)
    }

    const stopResize = () => {
      document.body.classList.remove('is-resizing-editor-sidebar')
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', stopResize)
      window.removeEventListener('pointercancel', stopResize)
      persistSidebarWidth(latestWidth)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', stopResize)
    window.addEventListener('pointercancel', stopResize)
  }

  const handleSidebarResizeKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      nudgeSidebar(event.shiftKey ? -72 : -24)
    } else if (event.key === 'ArrowRight') {
      event.preventDefault()
      nudgeSidebar(event.shiftKey ? 72 : 24)
    } else if (event.key === 'Home') {
      event.preventDefault()
      setSidebarWidth(EDITOR_SIDEBAR_MIN_WIDTH)
      persistSidebarWidth(EDITOR_SIDEBAR_MIN_WIDTH)
    } else if (event.key === 'End') {
      event.preventDefault()
      const editor = editorRef.current
      const nextWidth = clampEditorSidebarWidth(EDITOR_SIDEBAR_MAX_WIDTH, editor?.getBoundingClientRect().width)
      setSidebarWidth(nextWidth)
      persistSidebarWidth(nextWidth)
    }
  }

  const syncEditorOverlays = (scrollLeft: number, scrollTop: number) => {
    if (highlightInnerRef.current) {
      highlightInnerRef.current.style.transform = `translate(${-scrollLeft}px, ${-scrollTop}px)`
    }
    if (lineNumbersInnerRef.current) {
      lineNumbersInnerRef.current.style.transform = `translateY(${-scrollTop}px)`
    }
  }

  const focusSearchMatch = (match: FileSearchMatch) => {
    const textarea = textareaRef.current
    if (!textarea) return

    const offset = (lineOffsets[match.lineNumber - 1] ?? 0) + match.column
    setRenderedLineCount((count) => Math.max(count, Math.min(draftLines.length, match.lineNumber + EDITOR_RENDER_LOOKAHEAD)))

    window.requestAnimationFrame(() => {
      textarea.focus()
      textarea.setSelectionRange(offset, offset + match.length)
      const top = Math.max(0, (match.lineNumber - 1) * EDITOR_LINE_HEIGHT - textarea.clientHeight * 0.32)
      textarea.scrollTop = top
      syncEditorOverlays(textarea.scrollLeft, textarea.scrollTop)
    })
  }

  const activateSearchMatch = (index: number) => {
    if (fileSearchMatches.length === 0) return
    const nextIndex = ((index % fileSearchMatches.length) + fileSearchMatches.length) % fileSearchMatches.length
    setActiveSearchIndex(nextIndex)
    focusSearchMatch(fileSearchMatches[nextIndex])
  }

  const handleFileSearchKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return
    event.preventDefault()
    activateSearchMatch(activeSearchIndex < 0 ? (event.shiftKey ? -1 : 0) : activeSearchIndex + (event.shiftKey ? -1 : 1))
  }

  const renderCodeEditor = () => {
    if (textUnavailableMessage) {
      return (
        <div className="changes-editor-mode-message">
          <FileImage size={28} />
          <strong>{textUnavailableMessage}</strong>
          <span>Use Preview for this file.</span>
        </div>
      )
    }

    return (
      <div className={dirty ? 'changes-editor-code-shell is-dirty' : 'changes-editor-code-shell'}>
        <pre className="changes-editor-line-numbers" aria-hidden="true">
          <div className="changes-editor-line-numbers-inner" ref={lineNumbersInnerRef}>
            {visibleDraftLines.map((_, index) => (
              <span key={index + 1}>{index + 1}</span>
            ))}
          </div>
        </pre>
        <pre className="changes-editor-highlight" aria-hidden="true">
          <div className="changes-editor-highlight-inner" ref={highlightInnerRef}>
            {visibleDraftLines.map((line, index) => {
              const lineNumber = index + 1
              const changeKind = changeKindByLine.get(lineNumber)

              return (
                <code
                  className={[
                    'changes-editor-highlight-line',
                    changeKind ? `line-${changeKind}` : ''
                  ].filter(Boolean).join(' ')}
                  key={`${lineNumber}-${line.slice(0, 20)}`}
                >
                  {highlightedLineContent(line || ' ', selectedLang, fileSearchQuery, activeSearchMatch, lineNumber)}
                </code>
              )
            })}
          </div>
        </pre>
        <textarea
          ref={textareaRef}
          className={dirty ? 'changes-editor-textarea is-dirty' : 'changes-editor-textarea'}
          spellCheck={false}
          wrap="off"
          value={draftText}
          onChange={(event) => setDraftText(event.target.value)}
          onScroll={syncHighlightScroll}
          disabled={fileLoading}
        />
        {highlightBatching && (
          <SignalStatus
            className="changes-editor-file-curtain"
            label="Indexing large file"
            detail={`${Math.min(renderedLineCount, draftLines.length)} / ${draftLines.length} lines`}
          />
        )}
      </div>
    )
  }

  const renderImagePreview = () => (
    <div className="changes-editor-media-shell">
      {activeImagePreviewUrl ? (
        <div className="changes-editor-image-stage">
          <img src={activeImagePreviewUrl} alt={selectedPath} />
          <span>
            {selectedIsSvg && draftText ? 'Live SVG preview' : imagePreview ? `${formatBytes(imagePreview.byteSize)} - ${imagePreview.mimeType}` : 'Image preview'}
          </span>
        </div>
      ) : imagePreviewError ? (
        <div className="changes-editor-mode-message danger-text">
          <FileImage size={28} />
          <strong>Preview unavailable</strong>
          <span>{imagePreviewError}</span>
        </div>
      ) : (
        <SignalStatus
          className="changes-editor-file-curtain changes-editor-file-curtain-static"
          label={imagePreviewLoading ? 'Loading image preview' : 'Preparing preview'}
          detail={selectedPath}
        />
      )}
      {imagePreviewLoading && activeImagePreviewUrl && (
        <SignalStatus
          compact
          className="changes-editor-file-curtain changes-editor-media-loading"
          label="Refreshing preview"
          detail={selectedPath}
        />
      )}
    </div>
  )

  const renderJsonViewer = () => {
    if (textUnavailableMessage) {
      return (
        <div className="changes-editor-mode-message">
          <FileCode2 size={28} />
          <strong>{textUnavailableMessage}</strong>
          <span>JSON text is not available for this file.</span>
        </div>
      )
    }

    if (jsonParseResult.error) {
      return (
        <div className="changes-editor-mode-message danger-text">
          <FileCode2 size={28} />
          <strong>Invalid JSON</strong>
          <span>{jsonParseResult.error}</span>
        </div>
      )
    }

    const rows = jsonParseResult.rows.slice(0, 2500)

    return (
      <div className="changes-editor-json-viewer">
        {rows.map((row, index) => {
          const summary = jsonValueSummary(row.value)

          return (
            <div className="changes-editor-json-row" key={`${row.depth}-${row.keyName ?? 'root'}-${index}`} style={{ '--json-indent': `${14 + row.depth * 18}px` } as CSSProperties}>
              <span className="changes-editor-json-key">{row.keyName ?? '$'}</span>
              <span className={`changes-editor-json-type type-${summary.type}`}>{summary.type}</span>
              <span className="changes-editor-json-value">{summary.preview}</span>
            </div>
          )
        })}
        {jsonParseResult.rows.length > rows.length && (
          <div className="changes-editor-json-more">{jsonParseResult.rows.length - rows.length} more JSON nodes hidden for performance.</div>
        )}
      </div>
    )
  }

  const renderActiveView = () => {
    if (viewMode === 'image') return renderImagePreview()
    if (viewMode === 'json') return renderJsonViewer()
    return renderCodeEditor()
  }

  const renderViewModeTabs = () => {
    if (availableViewModes.length <= 1) return null

    return (
      <div className="changes-editor-view-tabs" role="tablist" aria-label="File view mode">
        {availableViewModes.map((mode) => (
          <button
            type="button"
            role="tab"
            aria-selected={viewMode === mode.id}
            className={viewMode === mode.id ? 'active' : ''}
            key={mode.id}
            onClick={() => setViewMode(mode.id)}
          >
            {mode.label}
          </button>
        ))}
      </div>
    )
  }

  useEffect(() => {
    setSelectedPath(initialFilePath ?? '')
  }, [initialFilePath])

  useEffect(() => {
    setViewMode(defaultViewModeForPath(selectedPath))
    setImagePreview(null)
    setImagePreviewError(null)
    setImagePreviewLoading(false)
    setTextUnavailableMessage(null)
    if (textareaRef.current) {
      textareaRef.current.scrollTop = 0
      textareaRef.current.scrollLeft = 0
    }
    syncEditorOverlays(0, 0)
  }, [selectedPath])

  useEffect(() => {
    if (!fileMenu) return

    const close = () => setFileMenu(null)
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }

    window.addEventListener('click', close)
    window.addEventListener('scroll', close, true)
    window.addEventListener('keydown', onKeyDown)

    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [fileMenu])

  useEffect(() => {
    if (!api || !currentRepoPath || !selectedPath || !PREVIEWABLE_IMAGE_RE.test(selectedPath)) return
    let cancelled = false
    setImagePreviewLoading(true)
    setImagePreviewError(null)
    void api.getImagePreview({ repoPath: currentRepoPath, filePath: selectedPath })
      .then((result) => {
        if (cancelled) return
        setImagePreviewLoading(false)
        if (result.ok) {
          setImagePreview(result.data)
          return
        }
        setImagePreview(null)
        setImagePreviewError(friendlyIpcErrorMessage(result.error.message, 'Failed to load image preview.'))
      })
      .catch((error) => {
        if (cancelled) return
        setImagePreviewLoading(false)
        setImagePreview(null)
        setImagePreviewError(friendlyIpcErrorMessage(error instanceof Error ? error.message : '', 'Failed to load image preview.'))
      })

    return () => {
      cancelled = true
    }
  }, [api, currentRepoPath, selectedPath])

  useEffect(() => {
    setActiveSearchIndex(-1)
  }, [fileSearchQuery, selectedPath])

  useEffect(() => {
    if (activeSearchIndex >= fileSearchMatches.length && fileSearchMatches.length > 0) {
      setActiveSearchIndex(Math.max(0, fileSearchMatches.length - 1))
    }
  }, [activeSearchIndex, fileSearchMatches.length])

  useEffect(() => {
    if (fileLoading || fileError) return

    const totalLines = draftLines.length
    const initialLines = totalLines > EDITOR_LARGE_FILE_LINE_THRESHOLD
      ? Math.min(totalLines, EDITOR_INITIAL_RENDER_LINES)
      : totalLines
    let cancelled = false
    let frame = 0

    setRenderedLineCount(initialLines)

    if (totalLines <= initialLines) return

    const renderNextBatch = () => {
      setRenderedLineCount((count) => {
        if (cancelled) return count
        const nextCount = Math.min(totalLines, count + EDITOR_RENDER_BATCH_SIZE)
        if (nextCount < totalLines) frame = window.requestAnimationFrame(renderNextBatch)
        return nextCount
      })
    }

    frame = window.requestAnimationFrame(renderNextBatch)

    return () => {
      cancelled = true
      window.cancelAnimationFrame(frame)
    }
  }, [draftLines.length, fileError, fileLoading, selectedPath])

  useEffect(() => {
    const clampToEditor = () => {
      const editor = editorRef.current
      if (!editor) return
      setSidebarWidth((width) => clampEditorSidebarWidth(width, editor.getBoundingClientRect().width))
    }

    let frame = window.requestAnimationFrame(() => {
      frame = window.requestAnimationFrame(clampToEditor)
    })
    window.addEventListener('resize', clampToEditor)

    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('resize', clampToEditor)
    }
  }, [])

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
          setSelectedPath((current) => current || result.data[0]?.path || '')
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
    setTextUnavailableMessage(null)
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
          if (PREVIEWABLE_IMAGE_RE.test(selectedPath)) {
            setTextUnavailableMessage('Binary image preview only.')
            setOriginalText('')
            setDraftText('')
            return
          }
          setFileError('Binary files cannot be edited here.')
          setOriginalText('')
          setDraftText('')
          return
        }
        if (result.data.tooLarge) {
          if (PREVIEWABLE_IMAGE_RE.test(selectedPath)) {
            setTextUnavailableMessage('Text is too large for the internal editor.')
            setOriginalText('')
            setDraftText('')
            return
          }
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

  const openFileFromMenu = () => {
    const path = fileMenu?.path
    setFileMenu(null)
    if (!path) return
    setSelectedPath(path)
  }

  const stageFileFromMenu = () => {
    const path = fileMenu?.path
    const change = contextMenuChange
    setFileMenu(null)
    if (!path || !change || !currentRepoPath || !api) return
    void runSnapshotAction('File staged.', () => api.stageFile({ repoPath: currentRepoPath, filePath: path }))
  }

  const unstageFileFromMenu = () => {
    const path = fileMenu?.path
    const change = contextMenuChange
    setFileMenu(null)
    if (!path || !change || !currentRepoPath || !api) return
    void runSnapshotAction('File unstaged.', () => api.unstageFile({ repoPath: currentRepoPath, filePath: path }))
  }

  const openInEditorFromMenu = () => {
    const path = fileMenu?.path
    setFileMenu(null)
    if (!path || !currentRepoPath || !api) return
    void api.openInEditor({ targetPath: buildRepoFilePath(currentRepoPath, path) }).then((result) => {
      setNotice(result.ok ? result.data.message || 'File opened in editor.' : result.error.message)
    })
  }

  const openTerminalFromMenu = () => {
    const path = fileMenu?.path
    setFileMenu(null)
    if (!path || !currentRepoPath || !api) return
    void api.openTerminal(buildRepoFileDirectory(currentRepoPath, path)).then((result) => {
      setNotice(result.ok ? result.data.message || 'Terminal opened.' : result.error.message)
    })
  }

  const showInFileManagerFromMenu = () => {
    const path = fileMenu?.path
    setFileMenu(null)
    if (!path || !currentRepoPath || !api) return
    void api.showItemInFolder(buildRepoFilePath(currentRepoPath, path)).then((result) => {
      setNotice(result.ok ? result.data.message || 'Shown in file manager.' : result.error.message)
    })
  }

  const copyPathFromMenu = () => {
    const path = fileMenu?.path
    setFileMenu(null)
    if (!path || !currentRepoPath) return
    void navigator.clipboard.writeText(buildRepoFilePath(currentRepoPath, path))
  }

  const copyNameFromMenu = () => {
    const path = fileMenu?.path
    setFileMenu(null)
    if (!path) return
    void navigator.clipboard.writeText(path.split('/').pop() ?? path)
  }

  const saveFile = async () => {
    if (!api || !currentRepoPath || !selectedPath || !dirty || fileError) return
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

  const syncHighlightScroll = (event: ReactUIEvent<HTMLTextAreaElement>) => {
    syncEditorOverlays(event.currentTarget.scrollLeft, event.currentTarget.scrollTop)
  }

  return (
    <section className="changes-internal-editor" ref={editorRef} style={editorStyle}>
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
          ) : (
            <div className="changes-editor-tree-root">
              {visibleFileTree.files.map((file) => renderFileRow(file, file.path))}
              {visibleFileTree.children.map((folder) => renderFolderTree(folder, 0))}
            </div>
          )}
        </div>
      </aside>

      <div
        className="changes-editor-splitter"
        role="separator"
        aria-label="Resize file list and editor"
        aria-orientation="vertical"
        aria-valuemin={EDITOR_SIDEBAR_MIN_WIDTH}
        aria-valuemax={EDITOR_SIDEBAR_MAX_WIDTH}
        aria-valuenow={sidebarWidth}
        tabIndex={0}
        onPointerDown={startSidebarResize}
        onKeyDown={handleSidebarResizeKeyDown}
      >
        <span />
      </div>

      <div className="changes-editor-main">
        <header className="changes-editor-header">
          <div className="changes-editor-header-main">
            <h3>
              <FileCode2 size={16} />
              {selectedPath || 'Select a file'}
            </h3>
            <p>
              <span className={`file-type-icon file-type-${selectedIcon.tone}`} title={selectedIcon.title} aria-hidden="true">
                {selectedIcon.label}
              </span>
              {textUnavailableMessage ? textUnavailableMessage : dirty ? `${editedLines} edited line${editedLines === 1 ? '' : 's'} since load` : 'No edits since load'}
            </p>
            {renderViewModeTabs()}
          </div>
          <div className="changes-editor-header-actions">
            <label className="changes-editor-file-search">
              <Search size={15} />
              <input
                value={fileSearchQuery}
                onChange={(event) => setFileSearchQuery(event.target.value)}
                onKeyDown={handleFileSearchKeyDown}
                placeholder="Search in file"
                disabled={!selectedPath || fileLoading || Boolean(fileError) || Boolean(textUnavailableMessage) || viewMode === 'image'}
              />
              {fileSearchQuery && (
                <button type="button" title="Clear file search" aria-label="Clear file search" onClick={() => setFileSearchQuery('')}>
                  <X size={14} />
                </button>
              )}
              <span className="changes-editor-search-count">
                {fileSearchQuery.trim()
                  ? `${activeSearchIndex >= 0 ? activeSearchIndex + 1 : 0}/${fileSearchMatches.length}${fileSearchOverflow ? '+' : ''}`
                  : '0/0'}
              </span>
              <button type="button" title="Previous match" aria-label="Previous match" disabled={fileSearchMatches.length === 0} onClick={() => activateSearchMatch(activeSearchIndex < 0 ? -1 : activeSearchIndex - 1)}>
                <ChevronUp size={14} />
              </button>
              <button type="button" title="Next match" aria-label="Next match" disabled={fileSearchMatches.length === 0} onClick={() => activateSearchMatch(activeSearchIndex < 0 ? 0 : activeSearchIndex + 1)}>
                <ChevronDown size={14} />
              </button>
            </label>
            <button type="button" onClick={saveFile} disabled={!selectedPath || !dirty || saving || fileLoading || Boolean(fileError) || Boolean(textUnavailableMessage)}>
              <Save size={16} />
              {saving ? 'Saving...' : 'Save file'}
            </button>
          </div>
        </header>

        {fileError ? (
          <div className="quiet-box danger-text">{fileError}</div>
        ) : (
          <div
            className={dirty && viewMode === 'code' && !textUnavailableMessage ? 'changes-editor-body has-live-diff' : 'changes-editor-body'}
            onContextMenuCapture={(event) => {
              if (selectedPath) openFileContextMenu(event, selectedPath)
            }}
          >
            {renderActiveView()}
            {fileLoading && (
              <SignalStatus
                className="changes-editor-file-curtain changes-editor-body-curtain"
                label="Loading file"
                detail={selectedPath}
              />
            )}
            {dirty && !fileLoading && viewMode === 'code' && !textUnavailableMessage && (
              <aside className="changes-editor-live-diff" aria-label="Live file changes">
                <header>
                  <strong>Live changes</strong>
                  <span>{editedLines}</span>
                </header>
                <div>
                  {liveChanges.slice(0, 120).map((change) => (
                    <article className={`changes-editor-live-row ${change.kind}`} key={`${change.lineNumber}-${change.kind}`}>
                      <span>{change.lineNumber}</span>
                      <code>{highlight(change.after || change.before || ' ', selectedLang)}</code>
                      {change.kind === 'modified' && <small>{highlight(change.before || ' ', selectedLang)}</small>}
                    </article>
                  ))}
                  {liveChanges.length > 120 && <p>{liveChanges.length - 120} more changed lines.</p>}
                </div>
              </aside>
            )}
          </div>
        )}
      </div>

      {fileMenu && (
        <div className="context-menu changes-editor-context-menu" role="menu" style={{ top: fileMenu.y, left: fileMenu.x }}>
          <button type="button" role="menuitem" title="Open this file in the BranchPilot preview" onClick={openFileFromMenu}>
            <Eye size={15} />
            Open in BranchPilot
          </button>
          <button
            type="button"
            role="menuitem"
            title="Stage this file"
            onClick={stageFileFromMenu}
            disabled={!contextMenuChange || (!contextMenuChange.unstaged && !contextMenuChange.untracked) || !api || !currentRepoPath}
          >
            <PlusSquare size={15} />
            Stage file
          </button>
          <button
            type="button"
            role="menuitem"
            title="Unstage this file"
            onClick={unstageFileFromMenu}
            disabled={!contextMenuChange?.staged || !api || !currentRepoPath}
          >
            <MinusSquare size={15} />
            Unstage file
          </button>
          <div className="context-menu-separator" role="separator" />
          <button type="button" role="menuitem" title="Open this file in your editor" onClick={openInEditorFromMenu} disabled={!api || !currentRepoPath}>
            <Code2 size={15} />
            Open in editor
          </button>
          <button type="button" role="menuitem" title="Open a terminal in this file's folder" onClick={openTerminalFromMenu} disabled={!api || !currentRepoPath}>
            <Terminal size={15} />
            Open in terminal
          </button>
          <button type="button" role="menuitem" title="Show this file in the file manager" onClick={showInFileManagerFromMenu} disabled={!api || !currentRepoPath}>
            <FolderOpen size={15} />
            Show in file manager
          </button>
          <div className="context-menu-separator" role="separator" />
          <button type="button" role="menuitem" title="Copy the absolute file path" onClick={copyPathFromMenu}>
            <Copy size={15} />
            Copy path
          </button>
          <button type="button" role="menuitem" title="Copy the file name" onClick={copyNameFromMenu}>
            <Copy size={15} />
            Copy file name
          </button>
        </div>
      )}
    </section>
  )
}
