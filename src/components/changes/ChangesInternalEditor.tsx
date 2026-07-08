import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type UIEvent as ReactUIEvent
} from 'react'
import { FileCode2 } from 'lucide-react'
import type { ApiResult, AssistantId, AssistantStatus, BranchPilotApi, ImagePreview, RepositoryFileEntry, RepositorySnapshot } from '../../shared/branchPilot'
import type { ConfirmationOptions } from '../../lib/prompts'
import { fileTypeIconForPath } from '../../lib/fileTypeIcons'
import { friendlyIpcErrorMessage } from '../../lib/ipcErrorMessage'
import { langFromPath } from '../../lib/highlight'
import { SignalStatus } from '../SignalStatus'
import {
  findCssColorTokens,
  isCssColorFile
} from '../diff/CssColorSwatch'
import { clamp, formatBytes } from './internal-editor/editorPrimitives'
import type {
  ChunkedTextPreview,
  EditorCssColorToken,
  EditorDiagnostic,
  EditorFileMenu,
  EditorMinimapLine,
  EditorOverviewMarker,
  LiveLineChange
} from './internal-editor/editorTypes'
import { byteToHex } from './internal-editor/hexUtils'
import {
  analyzeSvgText,
  parseSvgDocument,
  safeSvgDataUrl,
  serializeSvgDocument,
  svgElements,
  type SvgColorTarget
} from './internal-editor/svgUtils'
import {
  buildJsonLineNumberMap,
  collectJsonExpandablePaths,
  flattenJsonTree,
  jsonEditInitialValue,
  jsonEditableKind,
  parseJsonEditValue,
  updateJsonValueAtPath,
  type JsonEditCell,
  type JsonTreeNode
} from './internal-editor/jsonTreeUtils'
import { beautifyJsoncText } from './internal-editor/editorBeautify'
import {
  JSON_RE,
  isJsoncFilePath,
  parseEditorJsonText,
  utf8ByteOffset
} from './internal-editor/editorLintHelpers'
import {
  buildLiveLineChanges,
  revertLiveChangeInText,
  textLines
} from './internal-editor/liveLineChanges'
import { buildRepositoryFileTree } from './internal-editor/fileTree'
import type {
  RepositoryContentSearchMatch,
  RepositoryContentSearchState
} from './internal-editor/editorStateTypes'
import { CodeEditorView } from './internal-editor/CodeEditorView'
import { EditorFileContextMenu } from './internal-editor/EditorFileContextMenu'
import { EditorHeaderActions } from './internal-editor/EditorHeaderActions'
import { EditorSidebar } from './internal-editor/EditorSidebar'
import { EditorStatusBar } from './internal-editor/EditorStatusBar'
import { HexEditorView } from './internal-editor/HexEditorView'
import { ImagePreviewView } from './internal-editor/ImagePreviewView'
import { JsonViewerView } from './internal-editor/JsonViewerView'
import { LiveChangesPanel } from './internal-editor/LiveChangesPanel'
import { LocalAgentPanel } from './internal-editor/LocalAgentPanel'
import { SvgEditorView } from './internal-editor/SvgEditorView'
import { useEditorDataLoading } from './internal-editor/useEditorDataLoading'
import { useEditorFileActions } from './internal-editor/useEditorFileActions'
import { useEditorHealth } from './internal-editor/useEditorHealth'
import { useEditorLint } from './internal-editor/useEditorLint'
import { useEditorSaveActions } from './internal-editor/useEditorSaveActions'
import { useEditorSidebarResize } from './internal-editor/useEditorSidebarResize'
import { useHexEditor } from './internal-editor/useHexEditor'
import { useLocalAgentPanel } from './internal-editor/useLocalAgentPanel'
import { useEditorMultiEdit } from './internal-editor/useEditorMultiEdit'
import { useEditorTextHistory } from './internal-editor/useEditorTextHistory'
import { useEditorViewport } from './internal-editor/useEditorViewport'
import {
  EDITOR_FILE_CHUNK_BYTES,
  EDITOR_LIVE_CHANGES_DEBOUNCE_MS,
  EDITOR_MINIMAP_LINE_LIMIT,
  EDITOR_SEARCH_MATCH_LIMIT,
  EDITOR_SIDEBAR_MAX_WIDTH,
  EDITOR_SIDEBAR_MIN_WIDTH,
  PREVIEWABLE_IMAGE_RE,
  SVG_RE
} from './internal-editor/editorViewConstants'
import {
  buildLineOffsets,
  chunkedTextPreviewFromResult,
  closeOpenEditorDetails,
  defaultViewModeForPath,
  detectEditorIndent,
  detectEditorLineEnding,
  editorTextSourceKey,
  findFileSearchMatches,
  isNativeEditableTarget,
  lineBreakCount,
  parseFileLineSearchQuery,
  rangesOverlap,
  selectedSearchText,
  shortcutKey,
  type EditorTextRange,
  type EditorViewMode
} from './internal-editor/editorViewHelpers'

interface ChangesInternalEditorProps {
  api: BranchPilotApi | undefined
  currentRepoPath: string | undefined
  snapshot: RepositorySnapshot | null
  initialFilePath: string | null
  selectedAssistant: AssistantId
  assistants: AssistantStatus[]
  assistantsChecking: boolean
  checkAssistants: () => void | Promise<void>
  onBack: () => void
  setNotice: (message: string) => void
  requestConfirmation: (message: string, options?: ConfirmationOptions) => Promise<boolean>
  runSnapshotAction: (label: string, action: () => Promise<ApiResult<RepositorySnapshot>>) => boolean | void | Promise<boolean>
}


export function ChangesInternalEditor({
  api,
  currentRepoPath,
  snapshot,
  initialFilePath,
  selectedAssistant,
  assistants,
  assistantsChecking,
  checkAssistants,
  onBack,
  setNotice,
  requestConfirmation,
  runSnapshotAction
}: ChangesInternalEditorProps) {
  const editorRef = useRef<HTMLElement | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const fileSearchInputRef = useRef<HTMLInputElement | null>(null)
  const highlightInnerRef = useRef<HTMLDivElement | null>(null)
  const lineNumbersInnerRef = useRef<HTMLDivElement | null>(null)
  const colorSwatchesInnerRef = useRef<HTMLDivElement | null>(null)
  const overviewViewportRef = useRef<HTMLDivElement | null>(null)
  const healthMenuRef = useRef<HTMLDivElement | null>(null)
  const selectedFileRowRef = useRef<HTMLButtonElement | null>(null)
  const skipJsonEditBlurRef = useRef(false)
  const chunkPageRequestRef = useRef(false)
  const pendingEditorFocusRef = useRef<{ filePath: string; lineNumber: number; column: number; length: number; byteOffset?: number } | null>(null)
  const lastEditorScrollTopRef = useRef(0)
  const suppressAutoChunkUntilRef = useRef(0)
  const { sidebarWidth, editorStyle, startSidebarResize, handleSidebarResizeKeyDown } = useEditorSidebarResize({ editorRef })
  const [files, setFiles] = useState<RepositoryFileEntry[]>([])
  const [filesLoading, setFilesLoading] = useState(false)
  const [fileQuery, setFileQuery] = useState('')
  const [fileContentMatches, setFileContentMatches] = useState<Record<string, RepositoryContentSearchMatch>>({})
  const [fileContentSearchState, setFileContentSearchState] = useState<RepositoryContentSearchState>({
    status: 'idle',
    scanned: 0,
    truncated: false,
    error: null
  })
  const [fileSearchQuery, setFileSearchQuery] = useState('')
  const [activeSearchIndex, setActiveSearchIndex] = useState(-1)
  const [multiEditRanges, setMultiEditRanges] = useState<EditorTextRange[]>([])
  const [fileMenu, setFileMenu] = useState<EditorFileMenu | null>(null)
  const [viewMode, setViewMode] = useState<EditorViewMode>(() => defaultViewModeForPath(initialFilePath ?? ''))
  const [selectedPath, setSelectedPath] = useState(initialFilePath ?? '')
  const [originalText, setOriginalText] = useState('')
  const [draftText, setDraftText] = useState('')
  const [chunkedTextPreview, setChunkedTextPreview] = useState<ChunkedTextPreview | null>(null)
  const [imagePreview, setImagePreview] = useState<ImagePreview | null>(null)
  const [imagePreviewLoading, setImagePreviewLoading] = useState(false)
  const [imagePreviewError, setImagePreviewError] = useState<string | null>(null)
  const {
    hexTableBodyRef,
    lastHexScrollTopRef,
    suppressAutoHexChunkUntilRef,
    pendingHexOffsetRef,
    hexBytes,
    setHexBytes,
    hexLoading,
    setHexLoading,
    hexError,
    setHexError,
    setHexOriginalText,
    setHexDraftText,
    activeHexByteIndex,
    setActiveHexByteIndex,
    hexByteDraft,
    setHexByteDraft,
    hexOffsetDraft,
    setHexOffsetDraft,
    hexSearchQuery,
    setHexSearchQuery,
    activeHexSearchIndex,
    setActiveHexSearchIndex,
    parsedHexDraft,
    hexStartOffset,
    hexEndOffset,
    hexFullFileLoaded,
    hexChunkEditable,
    hexPreviewRows,
    activeHexByte,
    activeHexAscii,
    activeHexRowOffset,
    hexSearchMatches,
    hexDirty,
    loadHexChunk,
    goToHexOffset,
    jumpHexChunk,
    selectHexByte,
    updateHexByteDraft,
    commitHexByteDraft,
    handleHexByteInputKeyDown,
    hexByteChanged,
    hexDraftTextForSave,
    goToHexSearchMatch,
    syncHexScroll
  } = useHexEditor({ api, currentRepoPath, selectedPath, setNotice })
  const [collapsedJsonPaths, setCollapsedJsonPaths] = useState<Set<string>>(new Set())
  const [jsonEdit, setJsonEdit] = useState<JsonEditCell | null>(null)
  const [fileLoading, setFileLoading] = useState(false)
  const [filesError, setFilesError] = useState<string | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [textUnavailableMessage, setTextUnavailableMessage] = useState<string | null>(null)
  const [diagnostics, setDiagnostics] = useState<EditorDiagnostic[]>([])
  const [gitLineChanges, setGitLineChanges] = useState<LiveLineChange[]>([])
  const [gitDiffLoading, setGitDiffLoading] = useState(false)
  const [liveChangesOpen, setLiveChangesOpen] = useState(true)
  const [liveChangesText, setLiveChangesText] = useState<string | null>(null)
  const {
    codexAgentTextareaRef,
    codexAgentOpen,
    setCodexAgentOpen,
    codexAgentPrompt,
    setCodexAgentPrompt,
    setCodexAgentPromptFocused,
    codexAgentRunning,
    codexAgentResult,
    codexAgentError,
    codexAgentLiveEvents,
    codexAgentStopping,
    stopCodexAgent,
    codexAgentAttachments,
    codexAgentPreviewAttachment,
    setCodexAgentPreviewAttachment,
    codexAgentProvider,
    codexAgentAssistant,
    setCodexAgentAssistant,
    codexAgentReasoning,
    setCodexAgentReasoning,
    codexAgentSandbox,
    setCodexAgentSandbox,
    codexAgentStatusLabel,
    codexAgentStatusMessage,
    codexAgentUsageText,
    codexAgentCommandSuggestions,
    selectLocalAgentProvider,
    addCodexAgentAttachments,
    handleCodexAgentPaste,
    handleCodexAgentDragOver,
    handleCodexAgentDrop,
    removeCodexAgentAttachment,
    applyCodexAgentCommand,
    runCodexAgentPanel
  } = useLocalAgentPanel({
    api,
    currentRepoPath,
    selectedPath,
    selectedAssistant,
    assistants,
    assistantsChecking,
    checkAssistants,
    setNotice,
    requestConfirmation,
    runSnapshotAction,
    viewMode,
    textUnavailableMessage,
    fileError,
    diagnostics,
    flushActiveEditorDraftText: () => flushActiveEditorDraftText()
  })

  useEffect(() => {
    setManualHealthByPath(new Map())
    setHealthScanState({ status: 'idle', scanned: 0, linted: 0, signals: 0, error: null })
  }, [currentRepoPath])

  const changeByPath = useMemo(() => new Map((snapshot?.status.changes ?? []).map((change) => [change.path, change])), [snapshot])
  const selectedChange = selectedPath ? changeByPath.get(selectedPath) ?? null : null
  const query = fileQuery.trim().toLowerCase()
  const contentMatchedPaths = useMemo(() => new Set(Object.keys(fileContentMatches)), [fileContentMatches])
  const fileContentMatchCount = contentMatchedPaths.size
  const visibleFiles = useMemo(() => (
    query ? files.filter((file) => file.path.toLowerCase().includes(query) || contentMatchedPaths.has(file.path)) : files
  ), [contentMatchedPaths, files, query])
  const visibleFileTree = useMemo(() => buildRepositoryFileTree(visibleFiles), [visibleFiles])
  const chunkedTextActive = Boolean(chunkedTextPreview)
  const activeEditorText = chunkedTextPreview?.text ?? draftText
  const activeEditorLineBase = chunkedTextPreview?.startLine ?? 1
  const editorSourceKey = useMemo(() => editorTextSourceKey(originalText), [originalText])
  const textDirty = activeEditorText !== originalText
  const liveChangesSourceText = liveChangesText ?? activeEditorText
  const liveChanges = useMemo(() => {
    if (!textDirty) return []
    const changes = buildLiveLineChanges(originalText, liveChangesSourceText)
    return chunkedTextActive
      ? changes.map((change) => ({ ...change, lineNumber: activeEditorLineBase + change.lineNumber - 1 }))
      : changes
  }, [activeEditorLineBase, chunkedTextActive, liveChangesSourceText, originalText, textDirty])
  const liveChangesStale = textDirty && liveChangesSourceText !== activeEditorText
  const editedLines = liveChanges.length
  const changeKindByLine = useMemo(() => {
    const next = new Map<number, LiveLineChange['kind']>()
    for (const change of gitLineChanges) {
      if (change.kind !== 'removed') next.set(change.lineNumber, change.kind)
    }
    for (const change of liveChanges) {
      if (change.kind !== 'removed') next.set(change.lineNumber, change.kind)
    }
    return next
  }, [gitLineChanges, liveChanges])
  const gitChangedLines = gitLineChanges.length
  const draftLines = useMemo(() => textLines(activeEditorText), [activeEditorText])
  const lineOffsets = useMemo(() => buildLineOffsets(draftLines), [draftLines])
  const multiEditLineNumbers = useMemo(() => {
    const lines = new Set<number>()
    if (multiEditRanges.length === 0) return lines

    for (let index = 0; index < draftLines.length; index += 1) {
      const lineStart = lineOffsets[index] ?? 0
      const lineEnd = lineStart + draftLines[index].length
      if (multiEditRanges.some((range) => (
        range.start === range.end
          ? range.start >= lineStart && range.start <= lineEnd
          : rangesOverlap(range, { start: lineStart, end: Math.max(lineStart + 1, lineEnd) })
      ))) {
        lines.add(activeEditorLineBase + index)
      }
    }

    return lines
  }, [activeEditorLineBase, draftLines, lineOffsets, multiEditRanges])
  const fileLineSearchTarget = useMemo(() => parseFileLineSearchQuery(fileSearchQuery), [fileSearchQuery])
  const effectiveFileSearchQuery = fileLineSearchTarget ? '' : fileSearchQuery
  const fileSearchMatches = useMemo(() => (
    fileLineSearchTarget ? [] : findFileSearchMatches(draftLines, fileSearchQuery).map((match) => ({
      ...match,
      lineNumber: activeEditorLineBase + match.lineNumber - 1
    }))
  ), [activeEditorLineBase, draftLines, fileLineSearchTarget, fileSearchQuery])
  const dirty = textDirty || hexDirty
  const showLiveChangesPanel = textDirty && liveChangesOpen && !fileLoading && viewMode === 'code' && !textUnavailableMessage
  const editorLineEnding = useMemo(() => detectEditorLineEnding(activeEditorText), [activeEditorText])
  const editorIndent = useMemo(() => detectEditorIndent(activeEditorText), [activeEditorText])
  const editorIndentSelectValue = editorIndent.kind === 'tabs'
    ? 'tabs'
    : editorIndent.kind === 'spaces'
      ? `spaces-${clamp(editorIndent.size, 1, 8)}`
      : editorIndent.kind
  const diagnosticByLine = useMemo(() => new Map(diagnostics.map((diagnostic) => [diagnostic.lineNumber, diagnostic])), [diagnostics])
  const fileSearchOverflow = fileSearchMatches.length >= EDITOR_SEARCH_MATCH_LIMIT
  const activeSearchMatch = activeSearchIndex >= 0 ? fileSearchMatches[activeSearchIndex] ?? null : null
  const fileSearchLineNumbers = useMemo(
    () => new Set(fileSearchMatches.map((match) => match.lineNumber)),
    [fileSearchMatches]
  )

  const {
    editorVisualLineCountRef,
    setEditorScrollTop,
    setEditorViewportHeight,
    editorSelection,
    setEditorSelectionState,
    editorOverviewViewport,
    editorLineWindow,
    visibleDraftLines,
    measureEditorLineHeight,
    syncEditorOverlays,
    updateEditorLineWindowState,
    updateEditorSelectionStatus,
    focusEditorPosition,
    focusCodePosition,
    focusSearchMatch,
    focusLiveChange,
    focusFileLineSearchTarget,
    beginEditorOverviewDrag,
    dragEditorOverview,
    endEditorOverviewDrag
  } = useEditorViewport({
    textareaRef,
    highlightInnerRef,
    lineNumbersInnerRef,
    colorSwatchesInnerRef,
    overviewViewportRef,
    lastEditorScrollTopRef,
    draftLines,
    lineOffsets,
    activeEditorLineBase,
    chunkedTextActive,
    fileLineSearchTarget,
    setViewMode,
    setNotice
  })

  const {
    editorUndoStackRef,
    editorRedoStackRef,
    pendingEditorHistoryRef,
    editorDraftTextRef,
    editorTypingHistoryActiveRef,
    editorTextSnapshot,
    pushEditorUndoEntry,
    endEditorTypingHistoryGroup,
    touchEditorTypingHistoryGroup,
    clearEditorTextHistory,
    setActiveEditorDraftText,
    flushActiveEditorDraftText,
    applyEditorTextChange,
    undoEditorText,
    redoEditorText,
    capturePendingEditorHistory,
    updateEditorLineEnding,
    updateEditorIndent,
    updateEditorCssColor
  } = useEditorTextHistory({
    textareaRef,
    activeEditorText,
    chunkedTextPreview,
    setChunkedTextPreview,
    setDraftText,
    setJsonEdit,
    setMultiEditRanges,
    setCollapsedJsonPaths,
    setViewMode,
    fileLoading,
    activeEditorLineBase,
    chunkedTextActive,
    editorIndent,
    editorVisualLineCountRef,
    updateEditorSelectionStatus,
    updateEditorLineWindowState,
    syncEditorOverlays
  })

  const {
    activateNextMultiEditOccurrence,
    handleEditorTextChange,
    handleEditorTextKeyDown,
    handleEditorPaste
  } = useEditorMultiEdit({
    textareaRef,
    viewMode,
    textUnavailableMessage,
    fileLoading,
    activeEditorText,
    multiEditRanges,
    setMultiEditRanges,
    setJsonEdit,
    setNotice,
    updateEditorSelectionStatus,
    editorDraftTextRef,
    pendingEditorHistoryRef,
    editorTypingHistoryActiveRef,
    editorUndoStackRef,
    editorRedoStackRef,
    editorTextSnapshot,
    pushEditorUndoEntry,
    endEditorTypingHistoryGroup,
    touchEditorTypingHistoryGroup,
    setActiveEditorDraftText,
    capturePendingEditorHistory,
    undoEditorText,
    redoEditorText
  })

  const {
    lintSettings,
    lintRunState,
    setLintRunState,
    selectedLintSupported,
    lintBlocked,
    lintBadgeLabel,
    lintMenuClassName,
    goToDiagnostic,
    updateLintSettings,
    runLint
  } = useEditorLint({
    selectedPath,
    chunkedTextActive,
    textUnavailableMessage,
    fileLoading,
    fileError,
    viewMode,
    draftText,
    diagnostics,
    setDiagnostics,
    focusCodePosition,
    flushActiveEditorDraftText,
    setNotice
  })
  const editorOverviewMarkers = useMemo<EditorOverviewMarker[]>(() => {
    const firstLine = activeEditorLineBase
    const lastLine = activeEditorLineBase + Math.max(0, draftLines.length - 1)
    const markers: EditorOverviewMarker[] = []
    const seen = new Set<string>()
    const addMarker = (marker: EditorOverviewMarker) => {
      if (marker.lineNumber < firstLine || marker.lineNumber > lastLine) return
      const key = `${marker.kind}:${marker.lineNumber}`
      if (seen.has(key)) return
      seen.add(key)
      markers.push(marker)
    }

    for (const change of gitLineChanges) {
      addMarker({ lineNumber: change.lineNumber, kind: change.kind, title: `Git ${change.kind} line ${change.lineNumber}` })
    }
    for (const change of liveChanges) {
      addMarker({ lineNumber: change.lineNumber, kind: change.kind, title: `Unsaved ${change.kind} line ${change.lineNumber}` })
    }
    for (const diagnostic of diagnostics) {
      addMarker({ lineNumber: diagnostic.lineNumber, kind: 'diagnostic', title: `${diagnostic.source}: ${diagnostic.message}` })
    }
    for (const match of fileSearchMatches) {
      addMarker({ lineNumber: match.lineNumber, kind: 'search', title: `Search match on line ${match.lineNumber}` })
    }

    return markers.sort((a, b) => a.lineNumber - b.lineNumber).slice(0, 1200)
  }, [activeEditorLineBase, diagnostics, draftLines.length, fileSearchMatches, gitLineChanges, liveChanges])
  const editorMinimapLines = useMemo<EditorMinimapLine[]>(() => {
    if (draftLines.length === 0) return []

    const step = Math.max(1, Math.ceil(draftLines.length / EDITOR_MINIMAP_LINE_LIMIT))
    const lines: EditorMinimapLine[] = []

    for (let index = 0; index < draftLines.length; index += step) {
      const lineNumber = activeEditorLineBase + index
      const trimmedLength = draftLines[index].trimEnd().length
      const changeKind = changeKindByLine.get(lineNumber)
      const kind: EditorMinimapLine['kind'] = diagnosticByLine.has(lineNumber)
        ? 'diagnostic'
        : fileSearchLineNumbers.has(lineNumber)
          ? 'search'
          : multiEditLineNumbers.has(lineNumber)
            ? 'multi-edit'
            : changeKind ?? 'plain'

      lines.push({
        lineNumber,
        kind,
        widthPercent: clamp(10 + Math.sqrt(Math.max(1, trimmedLength)) * 7, 10, 92)
      })
    }

    return lines
  }, [
    activeEditorLineBase,
    changeKindByLine,
    diagnosticByLine,
    draftLines,
    fileSearchLineNumbers,
    multiEditLineNumbers
  ])
  const editorCssColorTokens = useMemo<EditorCssColorToken[]>(() => {
    if (!isCssColorFile(selectedPath) || textUnavailableMessage) return []
    return visibleDraftLines.flatMap((line, index) => (
      findCssColorTokens(line).map((token) => ({
        ...token,
        lineNumber: activeEditorLineBase + editorLineWindow.start + index,
        renderLineIndex: index
      }))
    ))
  }, [activeEditorLineBase, editorLineWindow.start, selectedPath, textUnavailableMessage, visibleDraftLines])
  const selectedIsImage = PREVIEWABLE_IMAGE_RE.test(selectedPath)
  const selectedIsSvg = SVG_RE.test(selectedPath)
  const selectedIsJson = JSON_RE.test(selectedPath)
  const selectedIsBinaryPreview = selectedIsImage && Boolean(textUnavailableMessage)
  const svgPreviewUrl = selectedIsSvg && !chunkedTextActive && draftText ? safeSvgDataUrl(draftText) : ''
  const activeImagePreviewUrl = selectedIsSvg ? (svgPreviewUrl || imagePreview?.dataUrl || '') : imagePreview?.dataUrl ?? ''
  const svgAnalysis = useMemo(() => (selectedIsSvg && !chunkedTextActive ? analyzeSvgText(draftText) : null), [chunkedTextActive, draftText, selectedIsSvg])
  const jsonParseResult = useMemo(() => {
    if (chunkedTextActive || !selectedIsJson || !draftText.trim()) {
      return { rows: [] as JsonTreeNode[], expandablePaths: [] as string[], error: null as string | null }
    }
    try {
      const parsed = parseEditorJsonText(selectedPath, draftText, lintSettings)
      const lineNumbers = buildJsonLineNumberMap(parsed.preparedText)
      return {
        rows: flattenJsonTree(parsed.value, collapsedJsonPaths, lineNumbers),
        expandablePaths: collectJsonExpandablePaths(parsed.value),
        error: null
      }
    } catch (error) {
      return {
        rows: [] as JsonTreeNode[],
        expandablePaths: [] as string[],
        error: error instanceof Error ? error.message : 'Invalid JSON.'
      }
    }
  }, [chunkedTextActive, collapsedJsonPaths, draftText, lintSettings, selectedIsJson, selectedPath])
  const selectedIcon = fileTypeIconForPath(selectedPath)
  const selectedLang = langFromPath(selectedPath)
  const textSaveBlocked = false
  const contextMenuChange = fileMenu ? changeByPath.get(fileMenu.path) : null
  const availableViewModes = useMemo<Array<{ id: EditorViewMode; label: string }>>(() => {
    const modes: Array<{ id: EditorViewMode; label: string }> = []
    if (selectedIsImage) modes.push({ id: 'image', label: 'Preview' })
    if (selectedIsSvg && !selectedIsBinaryPreview && !chunkedTextActive) modes.push({ id: 'svg-editor', label: 'Edit' })
    if (!selectedIsBinaryPreview || selectedIsSvg) modes.push({ id: 'code', label: selectedIsSvg ? 'SVG' : 'Code' })
    if (selectedIsJson && !selectedIsBinaryPreview && !chunkedTextActive) modes.push({ id: 'json', label: 'JSON' })
    if (selectedPath) modes.push({ id: 'hex', label: 'Hex' })
    return modes.length ? modes : [{ id: 'code', label: 'Code' }]
  }, [chunkedTextActive, selectedIsBinaryPreview, selectedIsImage, selectedIsJson, selectedIsSvg, selectedPath])

  const gitStatusText = selectedChange
    ? `${selectedChange.status} in git${gitChangedLines > 0 ? ` - ${gitChangedLines} marked line${gitChangedLines === 1 ? '' : 's'}` : ''}`
    : null
  const editorStatusText = hexDirty
    ? `${parsedHexDraft.bytes?.length ?? 0} edited byte${parsedHexDraft.bytes?.length === 1 ? '' : 's'} since load`
    : viewMode === 'hex' && hexBytes && !hexFullFileLoaded
      ? `Editable hex chunk ${formatBytes(hexBytes.startOffset)}-${formatBytes(hexBytes.endOffset)} of ${formatBytes(hexBytes.byteSize)}`
      : chunkedTextPreview
        ? `Editable chunk ${formatBytes(chunkedTextPreview.startOffset)}-${formatBytes(chunkedTextPreview.endOffset)} of ${formatBytes(chunkedTextPreview.byteSize)}`
        : textUnavailableMessage
          ? textUnavailableMessage
          : textDirty
            ? `${editedLines} edited line${editedLines === 1 ? '' : 's'} since load${gitStatusText ? ` - ${gitStatusText}` : ''}`
            : gitDiffLoading
              ? 'Loading git changes...'
              : gitStatusText ?? 'No edits since load'

  const openFileContextMenu = (event: ReactMouseEvent, path: string) => {
    if (!path) return
    event.preventDefault()
    event.stopPropagation()
    setFileMenu({ x: event.clientX, y: event.clientY, path })
  }

  const openRepositoryFileRow = (file: RepositoryFileEntry, contentMatch?: RepositoryContentSearchMatch) => {
    if (contentMatch) {
      pendingEditorFocusRef.current = {
        filePath: file.path,
        lineNumber: contentMatch.lineNumber,
        column: contentMatch.column,
        length: contentMatch.length,
        byteOffset: contentMatch.byteOffset
      }
      setFileSearchQuery(fileQuery.trim())
      setViewMode('code')
    }

    setSelectedPath(file.path)
    if (contentMatch && selectedPath === file.path && !fileLoading) {
      pendingEditorFocusRef.current = null
      focusCodePosition(contentMatch.lineNumber, contentMatch.column, contentMatch.length)
    }
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
    if (focusFileLineSearchTarget()) return
    activateSearchMatch(activeSearchIndex < 0 ? (event.shiftKey ? -1 : 0) : activeSearchIndex + (event.shiftKey ? -1 : 1))
  }

  const focusFileSearchInput = (copyEditorSelection = false) => {
    if (!selectedPath || fileLoading || fileError || textUnavailableMessage) return false
    if (viewMode === 'hex' || viewMode === 'image') setViewMode('code')

    if (copyEditorSelection) {
      const textarea = textareaRef.current
      const query = textarea
        ? selectedSearchText(textarea.value, textarea.selectionStart, textarea.selectionEnd)
        : ''
      if (query) {
        setFileSearchQuery(query)
        setActiveSearchIndex(-1)
      }
    }

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const input = fileSearchInputRef.current
        if (!input || input.disabled) return
        input.focus()
        input.select()
      })
    })
    return true
  }

  const loadChunkedTextPage = async (direction: 'next' | 'previous', scrollPlacement: 'start' | 'end' = 'start') => {
    const current = chunkedTextPreview
    if (!api || !currentRepoPath || !selectedPath || !current || current.loading || chunkPageRequestRef.current) return
    if (textDirty) {
      setNotice('Save or undo current chunk edits before loading another chunk.')
      return
    }

    const markers = [...current.markers]
    let targetIndex = direction === 'previous' ? current.pageIndex - 1 : current.pageIndex + 1

    if (direction === 'previous' && targetIndex < 0) return
    if (direction === 'next' && targetIndex >= markers.length) {
      if (!current.hasMore) return
      markers.push({
        offset: current.endOffset,
        lineNumber: current.startLine + lineBreakCount(current.text)
      })
      targetIndex = markers.length - 1
    }

    const marker = markers[targetIndex]
    if (!marker) {
      return
    }

    chunkPageRequestRef.current = true
    setChunkedTextPreview({ ...current, loading: true, error: null })
    setFileLoading(true)
    try {
      const result = await api.getRepositoryFileChunk({
        repoPath: currentRepoPath,
        filePath: selectedPath,
        offset: marker.offset,
        maxBytes: EDITOR_FILE_CHUNK_BYTES
      })
      if (!result.ok) {
        const message = friendlyIpcErrorMessage(result.error.message, 'Failed to load file chunk.')
        setChunkedTextPreview((latest) => latest ? { ...latest, loading: false, error: message } : latest)
        setNotice(message)
        return
      }
      if (result.data.binary) {
        const message = 'Binary file - Hex editor available.'
        setChunkedTextPreview(null)
        setTextUnavailableMessage(message)
        setViewMode('hex')
        setNotice(message)
        return
      }

      setChunkedTextPreview(chunkedTextPreviewFromResult(result.data, {
        startLine: marker.lineNumber,
        markers,
        pageIndex: targetIndex
      }))
      setOriginalText(result.data.text)
      setDraftText(result.data.text)
      suppressAutoChunkUntilRef.current = window.performance.now() + 250
      window.requestAnimationFrame(() => {
        const textarea = textareaRef.current
        if (!textarea) return
        const lineHeight = measureEditorLineHeight(textarea)
        const nextScrollTop = scrollPlacement === 'end'
          ? Math.max(0, textarea.scrollHeight - textarea.clientHeight - lineHeight * 2)
          : 0
        textarea.scrollTop = nextScrollTop
        textarea.scrollLeft = 0
        lastEditorScrollTopRef.current = nextScrollTop
        setEditorScrollTop(nextScrollTop)
        syncEditorOverlays(0, nextScrollTop, textarea.clientHeight)
      })
    } catch (error) {
      const message = friendlyIpcErrorMessage(error instanceof Error ? error.message : '', 'Failed to load file chunk.')
      setChunkedTextPreview((latest) => latest ? { ...latest, loading: false, error: message } : latest)
      setNotice(message)
    } finally {
      chunkPageRequestRef.current = false
      setFileLoading(false)
    }
  }

  const renderCodeEditor = () => (
    <CodeEditorView
      textUnavailableMessage={textUnavailableMessage}
      dirty={dirty}
      chunkedTextActive={chunkedTextActive}
      chunkedTextPreview={chunkedTextPreview}
      loadChunkedTextPage={loadChunkedTextPage}
      lineNumbersInnerRef={lineNumbersInnerRef}
      highlightInnerRef={highlightInnerRef}
      colorSwatchesInnerRef={colorSwatchesInnerRef}
      overviewViewportRef={overviewViewportRef}
      textareaRef={textareaRef}
      visibleDraftLines={visibleDraftLines}
      draftLineCount={draftLines.length}
      activeEditorLineBase={activeEditorLineBase}
      editorLineWindowStart={editorLineWindow.start}
      diagnosticByLine={diagnosticByLine}
      changeKindByLine={changeKindByLine}
      multiEditLineNumbers={multiEditLineNumbers}
      lineOffsets={lineOffsets}
      multiEditRanges={multiEditRanges}
      setMultiEditRanges={setMultiEditRanges}
      selectedLang={selectedLang}
      effectiveFileSearchQuery={effectiveFileSearchQuery}
      activeSearchMatch={activeSearchMatch}
      currentRepoPath={currentRepoPath}
      selectedPath={selectedPath}
      editorSourceKey={editorSourceKey}
      activeEditorText={activeEditorText}
      fileLoading={fileLoading}
      capturePendingEditorHistory={capturePendingEditorHistory}
      handleEditorTextChange={handleEditorTextChange}
      handleEditorTextKeyDown={handleEditorTextKeyDown}
      handleEditorPaste={handleEditorPaste}
      syncHighlightScroll={syncHighlightScroll}
      updateEditorSelectionStatus={updateEditorSelectionStatus}
      editorOverviewViewport={editorOverviewViewport}
      editorMinimapLines={editorMinimapLines}
      editorOverviewMarkers={editorOverviewMarkers}
      beginEditorOverviewDrag={beginEditorOverviewDrag}
      dragEditorOverview={dragEditorOverview}
      endEditorOverviewDrag={endEditorOverviewDrag}
      focusEditorPosition={focusEditorPosition}
      editorCssColorTokens={editorCssColorTokens}
      updateEditorCssColor={updateEditorCssColor}
      diagnostics={diagnostics}
      goToDiagnostic={goToDiagnostic}
    />
  )

  const renderImagePreview = () => (
    <ImagePreviewView
      selectedPath={selectedPath}
      selectedIsSvg={selectedIsSvg}
      draftText={draftText}
      activeImagePreviewUrl={activeImagePreviewUrl}
      imagePreview={imagePreview}
      imagePreviewError={imagePreviewError}
      imagePreviewLoading={imagePreviewLoading}
    />
  )

  const codeViewHexOffset = () => {
    if (chunkedTextPreview) {
      return chunkedTextPreview.startOffset
    }

    const selectionStart = textareaRef.current?.selectionStart
    if (selectionStart !== undefined && draftText) {
      return utf8ByteOffset(draftText, selectionStart)
    }

    return 0
  }

  const renderHexEditor = () => (
    <HexEditorView
      selectedPath={selectedPath}
      hexLoading={hexLoading}
      hexError={hexError}
      hexBytes={hexBytes}
      hexFullFileLoaded={hexFullFileLoaded}
      hexChunkEditable={hexChunkEditable}
      hexPreviewRows={hexPreviewRows}
      parsedHexDraft={parsedHexDraft}
      activeHexByteIndex={activeHexByteIndex}
      activeHexByte={activeHexByte}
      activeHexAscii={activeHexAscii}
      activeHexRowOffset={activeHexRowOffset}
      hexByteDraft={hexByteDraft}
      hexOffsetDraft={hexOffsetDraft}
      hexSearchQuery={hexSearchQuery}
      activeHexSearchIndex={activeHexSearchIndex}
      hexSearchMatches={hexSearchMatches}
      hexTableBodyRef={hexTableBodyRef}
      setHexOffsetDraft={setHexOffsetDraft}
      setHexSearchQuery={setHexSearchQuery}
      setActiveHexSearchIndex={setActiveHexSearchIndex}
      jumpHexChunk={jumpHexChunk}
      goToHexOffset={goToHexOffset}
      goToHexSearchMatch={goToHexSearchMatch}
      selectHexByte={selectHexByte}
      updateHexByteDraft={updateHexByteDraft}
      commitHexByteDraft={commitHexByteDraft}
      handleHexByteInputKeyDown={handleHexByteInputKeyDown}
      hexByteChanged={hexByteChanged}
      syncHexScroll={syncHexScroll}
    />
  )

  const updateSvgRootAttribute = (attr: string, value: string) => {
    const parsed = parseSvgDocument(draftText)
    if (!parsed.document) {
      setNotice(parsed.error || 'SVG edit failed.')
      return
    }

    const nextValue = value.trim()
    if (nextValue) parsed.document.documentElement.setAttribute(attr, nextValue)
    else parsed.document.documentElement.removeAttribute(attr)
    applyEditorTextChange(serializeSvgDocument(parsed.document))
  }

  const updateSvgColorAttribute = (target: SvgColorTarget, value: string) => {
    const parsed = parseSvgDocument(draftText)
    if (!parsed.document) {
      setNotice(parsed.error || 'SVG edit failed.')
      return
    }

    const element = svgElements(parsed.document)[target.index]
    if (!element) {
      setNotice('SVG element no longer exists.')
      return
    }

    const nextValue = value.trim()
    if (nextValue) element.setAttribute(target.attr, nextValue)
    else element.removeAttribute(target.attr)
    applyEditorTextChange(serializeSvgDocument(parsed.document))
  }

  const renderSvgEditor = () => (
    <SvgEditorView
      selectedPath={selectedPath}
      draftText={draftText}
      textUnavailableMessage={textUnavailableMessage}
      svgAnalysis={svgAnalysis}
      activeImagePreviewUrl={activeImagePreviewUrl}
      updateSvgRootAttribute={updateSvgRootAttribute}
      updateSvgColorAttribute={updateSvgColorAttribute}
    />
  )

  const toggleJsonNode = (path: string) => {
    setCollapsedJsonPaths((current) => {
      const next = new Set(current)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  const expandAllJson = () => setCollapsedJsonPaths(new Set())

  const collapseAllJson = () => {
    setCollapsedJsonPaths(new Set(jsonParseResult.expandablePaths))
  }

  const formatJsonDraft = () => {
    try {
      const formatted = isJsoncFilePath(selectedPath)
        ? beautifyJsoncText(draftText)
        : `${JSON.stringify(parseEditorJsonText(selectedPath, draftText, lintSettings).value, null, 2)}\n`
      applyEditorTextChange(formatted, { resetJsonCollapse: true })
      setCollapsedJsonPaths(new Set())
      setJsonEdit(null)
    } catch (error) {
      setNotice(error instanceof Error ? `JSON format failed: ${error.message}` : 'JSON format failed.')
    }
  }

  const beginJsonEdit = (row: JsonTreeNode) => {
    const kind = jsonEditableKind(row.value)
    if (!kind) return
    setJsonEdit({
      path: row.path,
      kind,
      value: jsonEditInitialValue(row.value)
    })
  }

  const cancelJsonEdit = () => {
    skipJsonEditBlurRef.current = true
    setJsonEdit(null)
  }

  const commitJsonEdit = (edit = jsonEdit) => {
    if (!edit) return

    try {
      const rootValue = parseEditorJsonText(selectedPath, draftText, lintSettings).value
      const nextValue = parseJsonEditValue(edit.kind, edit.value)
      const nextRootValue = updateJsonValueAtPath(rootValue, edit.path, nextValue)
      applyEditorTextChange(`${JSON.stringify(nextRootValue, null, 2)}\n`)
      setJsonEdit(null)
    } catch (error) {
      setNotice(error instanceof Error ? `JSON edit failed: ${error.message}` : 'JSON edit failed.')
    }
  }

  const renderJsonViewer = () => (
    <JsonViewerView
      textUnavailableMessage={textUnavailableMessage}
      draftText={draftText}
      jsonParseResult={jsonParseResult}
      collapsedJsonPaths={collapsedJsonPaths}
      jsonEdit={jsonEdit}
      setJsonEdit={setJsonEdit}
      skipJsonEditBlurRef={skipJsonEditBlurRef}
      expandAllJson={expandAllJson}
      collapseAllJson={collapseAllJson}
      formatJsonDraft={formatJsonDraft}
      toggleJsonNode={toggleJsonNode}
      beginJsonEdit={beginJsonEdit}
      cancelJsonEdit={cancelJsonEdit}
      commitJsonEdit={commitJsonEdit}
    />
  )

  const renderActiveView = () => {
    if (viewMode === 'image') return renderImagePreview()
    if (viewMode === 'svg-editor') return renderSvgEditor()
    if (viewMode === 'json') return renderJsonViewer()
    if (viewMode === 'hex') return renderHexEditor()
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
            onClick={() => {
              if (mode.id === 'hex') pendingHexOffsetRef.current = codeViewHexOffset()
              setViewMode(mode.id)
            }}
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
    chunkPageRequestRef.current = false
    clearEditorTextHistory()
    setViewMode(defaultViewModeForPath(selectedPath))
    setImagePreview(null)
    setImagePreviewError(null)
    setImagePreviewLoading(false)
    setHexBytes(null)
    setHexError(null)
    setHexLoading(false)
    setHexOriginalText('')
    setHexDraftText('')
    setActiveHexByteIndex(0)
    setHexByteDraft('')
    setHexOffsetDraft('')
    setHexSearchQuery('')
    setActiveHexSearchIndex(-1)
    setChunkedTextPreview(null)
    setTextUnavailableMessage(null)
    setCollapsedJsonPaths(new Set())
    setJsonEdit(null)
    setMultiEditRanges([])
    setDiagnostics([])
    setLiveChangesOpen(true)
    setLiveChangesText(null)
    setEditorSelectionState({ lineNumber: 1, column: 1, selectedChars: 0, selectedLines: 0 })
    setLintRunState({
      status: 'idle',
      message: 'Lint has not run yet.',
      detail: selectedPath ? 'Waiting for file content.' : 'Select a file.'
    })
    setEditorScrollTop(0)
    setEditorViewportHeight(0)
    lastEditorScrollTopRef.current = 0
    lastHexScrollTopRef.current = 0
    editorVisualLineCountRef.current = { text: '', count: 1 }
    suppressAutoChunkUntilRef.current = 0
    suppressAutoHexChunkUntilRef.current = 0
    if (textareaRef.current) {
      textareaRef.current.scrollTop = 0
      textareaRef.current.scrollLeft = 0
    }
    if (hexTableBodyRef.current) {
      hexTableBodyRef.current.scrollTop = 0
    }
    syncEditorOverlays(0, 0)
  }, [selectedPath])

  useEffect(() => {
    setLiveChangesOpen(true)
  }, [viewMode])

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Element)) return

      const openDetails = target.closest('details')
      closeOpenEditorDetails(editorRef.current, openDetails)

      if (!healthMenuRef.current?.contains(target)) {
        setHealthMenuOpen(false)
      }
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setHealthMenuOpen(false)
      closeOpenEditorDetails(editorRef.current)
    }

    document.addEventListener('pointerdown', handlePointerDown, true)
    document.addEventListener('keydown', handleKeyDown, true)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true)
      document.removeEventListener('keydown', handleKeyDown, true)
    }
  }, [])

  useEffect(() => {
    setHealthMenuOpen(false)
    closeOpenEditorDetails(editorRef.current)
  }, [currentRepoPath, selectedPath, viewMode])

  useEffect(() => {
    if (!textDirty) setLiveChangesOpen(true)
  }, [textDirty])

  useEffect(() => {
    if (!textDirty) {
      setLiveChangesText(activeEditorText)
    }
  }, [activeEditorText, textDirty])

  useEffect(() => {
    if (!textDirty) return

    const handle = window.setTimeout(() => {
      setLiveChangesText(activeEditorText)
    }, EDITOR_LIVE_CHANGES_DEBOUNCE_MS)

    return () => window.clearTimeout(handle)
  }, [activeEditorLineBase, activeEditorText, selectedPath, textDirty])

  useEffect(() => {
    if (!selectedPath) return

    const frame = window.requestAnimationFrame(() => {
      const row = selectedFileRowRef.current
      const list = row?.closest('.changes-editor-file-list') as HTMLElement | null
      if (!row || !list) return

      const rowRect = row.getBoundingClientRect()
      const listRect = list.getBoundingClientRect()
      const rowOutsideViewport = rowRect.top < listRect.top || rowRect.bottom > listRect.bottom
      if (rowOutsideViewport) row.scrollIntoView({ block: 'center' })
    })

    return () => window.cancelAnimationFrame(frame)
  }, [selectedPath, fileQuery, visibleFiles.length])

  useEditorDataLoading({
    api,
    currentRepoPath,
    selectedPath,
    selectedChange,
    headOid: snapshot?.summary.headOid,
    fileQuery,
    files,
    fileLoading,
    fileError,
    textUnavailableMessage,
    chunkedTextPreview,
    activeEditorLineBase,
    draftLineCount: draftLines.length,
    pendingEditorFocusRef,
    lastEditorScrollTopRef,
    setFileContentMatches,
    setFileContentSearchState,
    setGitLineChanges,
    setGitDiffLoading,
    setImagePreview,
    setImagePreviewLoading,
    setImagePreviewError,
    setFiles,
    setFilesLoading,
    setFilesError,
    setSelectedPath,
    setFileLoading,
    setFileError,
    setTextUnavailableMessage,
    setChunkedTextPreview,
    setOriginalText,
    setDraftText,
    setViewMode,
    focusCodePosition,
    setNotice
  })

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
    if (!api || !currentRepoPath || !selectedPath) return
    if (viewMode !== 'hex' && !textUnavailableMessage) return

    const preferredOffset = pendingHexOffsetRef.current ?? codeViewHexOffset()
    pendingHexOffsetRef.current = null
    if (
      hexBytes?.filePath === selectedPath &&
      preferredOffset >= hexBytes.startOffset &&
      preferredOffset < hexBytes.endOffset
    ) {
      selectHexByte(preferredOffset)
      return
    }

    void loadHexChunk(preferredOffset, preferredOffset, { scrollPlacement: 'start' })
  }, [api, currentRepoPath, selectedPath, textUnavailableMessage, viewMode])

  useEffect(() => {
    setActiveSearchIndex(-1)
  }, [fileSearchQuery, selectedPath])

  useEffect(() => {
    if (activeSearchIndex >= fileSearchMatches.length && fileSearchMatches.length > 0) {
      setActiveSearchIndex(Math.max(0, fileSearchMatches.length - 1))
    }
  }, [activeSearchIndex, fileSearchMatches.length])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return

      const key = shortcutKey(event)
      if (key === 'f') {
        if (focusFileSearchInput(true)) {
          event.preventDefault()
          event.stopPropagation()
        }
        return
      }

      if (key === 'd' && event.target === textareaRef.current && !event.defaultPrevented) {
        event.preventDefault()
        activateNextMultiEditOccurrence()
        return
      }

      if (event.defaultPrevented || event.target === textareaRef.current || isNativeEditableTarget(event.target)) return

      const undo = key === 'z' && !event.shiftKey
      const redo = key === 'y' || (key === 'z' && event.shiftKey)
      if (!undo && !redo) return
      if (undo && editorUndoStackRef.current.length === 0) return
      if (redo && editorRedoStackRef.current.length === 0) return

      event.preventDefault()
      endEditorTypingHistoryGroup()
      if (undo) undoEditorText()
      else redoEditorText()
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [fileError, fileLoading, selectedPath, textUnavailableMessage, viewMode])

  useEffect(() => {
    if (activeHexSearchIndex >= hexSearchMatches.length && hexSearchMatches.length > 0) {
      setActiveHexSearchIndex(Math.max(0, hexSearchMatches.length - 1))
    }
  }, [activeHexSearchIndex, hexSearchMatches.length])

  useEffect(() => {
    const bytes = parsedHexDraft.bytes
    if (!bytes || bytes.length === 0) {
      if (activeHexByteIndex !== hexStartOffset) setActiveHexByteIndex(hexStartOffset)
      setHexByteDraft((current) => current ? '' : current)
      return
    }

    const nextIndex = clamp(activeHexByteIndex, hexStartOffset, Math.max(hexStartOffset, hexEndOffset - 1))
    if (nextIndex !== activeHexByteIndex) {
      setActiveHexByteIndex(nextIndex)
      return
    }

    const nextDraft = byteToHex(bytes[nextIndex - hexStartOffset])
    setHexByteDraft((current) => current === nextDraft ? current : nextDraft)
  }, [activeHexByteIndex, hexEndOffset, hexStartOffset, parsedHexDraft.bytes])

  useEffect(() => {
    if (fileLoading || fileError) return

    const frame = window.requestAnimationFrame(() => {
      const textarea = textareaRef.current
      if (!textarea) return

      setEditorViewportHeight(textarea.clientHeight)
      setEditorScrollTop(textarea.scrollTop)
      syncEditorOverlays(textarea.scrollLeft, textarea.scrollTop, textarea.clientHeight)
    })

    return () => {
      window.cancelAnimationFrame(frame)
    }
  }, [draftLines.length, fileError, fileLoading, selectedPath, viewMode])

  const {
    stageFileFromMenu,
    unstageFileFromMenu,
    openInEditorFromMenu,
    openTerminalFromMenu,
    showInFileManagerFromMenu,
    copyPathFromMenu,
    copyNameFromMenu,
    reloadEditorFiles,
    renameFileFromMenu,
    deleteFileFromMenu
  } = useEditorFileActions({
    api,
    currentRepoPath,
    selectedPath,
    dirty,
    fileMenu,
    contextMenuChange,
    setFileMenu,
    setNotice,
    requestConfirmation,
    runSnapshotAction,
    setFiles,
    setFilesLoading,
    setFilesError,
    setSelectedPath
  })

  const {
    healthSettings,
    healthMenuOpen,
    setHealthMenuOpen,
    healthScanState,
    setHealthScanState,
    setManualHealthByPath,
    healthEnabled,
    fileHealthByPath,
    liveHealthReports,
    selectedHealthReport,
    healthSignalCount,
    healthPanelSeverity,
    healthSummaryTitle,
    healthRunDisabled,
    healthScanSummary,
    updateHealthSettings,
    resetHealthSettings,
    runAllFilesHealthCheck
  } = useEditorHealth({
    api,
    currentRepoPath,
    setNotice,
    files,
    filesLoading,
    changeByPath,
    selectedPath,
    selectedChange,
    viewMode,
    chunkedTextPreview,
    diagnostics,
    dirty,
    draftLineCount: draftLines.length,
    fileError,
    gitChangedLines,
    hexBytes,
    textUnavailableMessage,
    lintSettings,
    reloadEditorFiles
  })

  const {
    saving,
    beautifying,
    aiBeautifying,
    saveFile,
    beautifyFile,
    beautifyFileWithAi
  } = useEditorSaveActions({
    api,
    currentRepoPath,
    selectedPath,
    selectedAssistant,
    viewMode,
    fileLoading,
    fileError,
    textUnavailableMessage,
    textSaveBlocked,
    chunkedTextActive,
    chunkedTextPreview,
    setChunkedTextPreview,
    originalText,
    setOriginalText,
    setDraftText,
    hexDirty,
    hexBytes,
    setHexBytes,
    hexStartOffset,
    hexEndOffset,
    hexFullFileLoaded,
    setHexOriginalText,
    setHexDraftText,
    setActiveHexByteIndex,
    hexDraftTextForSave,
    flushActiveEditorDraftText,
    applyEditorTextChange,
    runSnapshotAction,
    setNotice
  })

  const revertLiveChange = (change: LiveLineChange) => {
    const snapshot = editorTextSnapshot()
    const localChange = chunkedTextActive
      ? { ...change, lineNumber: change.lineNumber - activeEditorLineBase + 1 }
      : change
    const nextText = revertLiveChangeInText(snapshot.text, localChange)
    if (nextText === snapshot.text) return

    applyEditorTextChange(nextText)
  }

  const syncHighlightScroll = (event: ReactUIEvent<HTMLTextAreaElement>) => {
    const nextScrollTop = event.currentTarget.scrollTop
    const scrollingDown = nextScrollTop > lastEditorScrollTopRef.current
    const scrollingUp = nextScrollTop < lastEditorScrollTopRef.current
    lastEditorScrollTopRef.current = nextScrollTop

    updateEditorLineWindowState(nextScrollTop, event.currentTarget.clientHeight)
    syncEditorOverlays(event.currentTarget.scrollLeft, nextScrollTop, event.currentTarget.clientHeight)
    const remainingScroll = event.currentTarget.scrollHeight - nextScrollTop - event.currentTarget.clientHeight
    const canAutoLoadChunk = Boolean(
      chunkedTextPreview &&
      !chunkedTextPreview.loading &&
      window.performance.now() >= suppressAutoChunkUntilRef.current
    )

    if (canAutoLoadChunk && scrollingDown && chunkedTextPreview?.hasMore && remainingScroll < 64) {
      void loadChunkedTextPage('next')
      return
    }

    if (canAutoLoadChunk && scrollingUp && chunkedTextPreview && chunkedTextPreview.pageIndex > 0 && nextScrollTop < 64) {
      void loadChunkedTextPage('previous', 'end')
    }
  }

  return (
    <section className="changes-internal-editor" ref={editorRef} style={editorStyle}>
      <EditorSidebar
        onBack={onBack}
        fileQuery={fileQuery}
        setFileQuery={setFileQuery}
        query={query}
        fileContentMatchCount={fileContentMatchCount}
        healthMenuRef={healthMenuRef}
        healthPanelSeverity={healthPanelSeverity}
        healthEnabled={healthEnabled}
        healthSummaryTitle={healthSummaryTitle}
        healthMenuOpen={healthMenuOpen}
        setHealthMenuOpen={setHealthMenuOpen}
        healthSignalCount={healthSignalCount}
        runAllFilesHealthCheck={runAllFilesHealthCheck}
        healthRunDisabled={healthRunDisabled}
        healthScanState={healthScanState}
        healthScanSummary={healthScanSummary}
        healthSettings={healthSettings}
        updateHealthSettings={updateHealthSettings}
        resetHealthSettings={resetHealthSettings}
        selectedPath={selectedPath}
        selectedHealthReport={selectedHealthReport}
        liveHealthReports={liveHealthReports}
        setSelectedPath={setSelectedPath}
        filesLoading={filesLoading}
        filesError={filesError}
        visibleFiles={visibleFiles}
        fileContentSearchState={fileContentSearchState}
        visibleFileTree={visibleFileTree}
        changeByPath={changeByPath}
        dirty={dirty}
        healthRowSignals={healthSettings.rowSignals}
        fileHealthByPath={fileHealthByPath}
        fileContentMatches={fileContentMatches}
        selectedFileRowRef={selectedFileRowRef}
        openRepositoryFileRow={openRepositoryFileRow}
        openFileContextMenu={openFileContextMenu}
      />

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
              {editorStatusText}
            </p>
            {renderViewModeTabs()}
          </div>
          <EditorHeaderActions
            fileSearchInputRef={fileSearchInputRef}
            fileSearchQuery={fileSearchQuery}
            setFileSearchQuery={setFileSearchQuery}
            handleFileSearchKeyDown={handleFileSearchKeyDown}
            fileLineSearchTarget={fileLineSearchTarget}
            activeSearchIndex={activeSearchIndex}
            fileSearchMatchCount={fileSearchMatches.length}
            fileSearchOverflow={fileSearchOverflow}
            focusFileLineSearchTarget={focusFileLineSearchTarget}
            activateSearchMatch={activateSearchMatch}
            selectedPath={selectedPath}
            fileLoading={fileLoading}
            fileError={fileError}
            textUnavailableMessage={textUnavailableMessage}
            viewMode={viewMode}
            showLiveChangesPanel={showLiveChangesPanel}
            setLiveChangesOpen={setLiveChangesOpen}
            textDirty={textDirty}
            liveChangesOpen={liveChangesOpen}
            liveChangesStale={liveChangesStale}
            editedLines={editedLines}
            lintMenuClassName={lintMenuClassName}
            selectedLintSupported={selectedLintSupported}
            lintBlocked={lintBlocked}
            lintBadgeLabel={lintBadgeLabel}
            lintRunState={lintRunState}
            runLint={runLint}
            diagnostics={diagnostics}
            goToDiagnostic={goToDiagnostic}
            lintSettings={lintSettings}
            updateLintSettings={updateLintSettings}
            apiReady={Boolean(api && currentRepoPath)}
            codexAgentOpen={codexAgentOpen}
            codexAgentProvider={codexAgentProvider}
            setCodexAgentOpen={setCodexAgentOpen}
            selectLocalAgentProvider={selectLocalAgentProvider}
            beautifyFile={beautifyFile}
            beautifyFileWithAi={beautifyFileWithAi}
            beautifying={beautifying}
            aiBeautifying={aiBeautifying}
            chunkedTextActive={chunkedTextActive}
            saveFile={saveFile}
            saving={saving}
            hexLoading={hexLoading}
            parsedHexError={parsedHexDraft.error}
            hexDirty={hexDirty}
            textSaveBlocked={textSaveBlocked}
          />
        </header>

        {codexAgentOpen && (
          <LocalAgentPanel
            codexAgentProvider={codexAgentProvider}
            selectedPath={selectedPath}
            apiReady={Boolean(api && currentRepoPath)}
            codexAgentAssistant={codexAgentAssistant}
            setCodexAgentAssistant={setCodexAgentAssistant}
            codexAgentReasoning={codexAgentReasoning}
            setCodexAgentReasoning={setCodexAgentReasoning}
            codexAgentSandbox={codexAgentSandbox}
            setCodexAgentSandbox={setCodexAgentSandbox}
            codexAgentStatusLabel={codexAgentStatusLabel}
            codexAgentStatusMessage={codexAgentStatusMessage}
            codexAgentUsageText={codexAgentUsageText}
            assistantsChecking={assistantsChecking}
            checkAssistants={checkAssistants}
            codexAgentResult={codexAgentResult}
            codexAgentError={codexAgentError}
            codexAgentRunning={codexAgentRunning}
            codexAgentLiveEvents={codexAgentLiveEvents}
            codexAgentStopping={codexAgentStopping}
            stopCodexAgent={stopCodexAgent}
            codexAgentPrompt={codexAgentPrompt}
            setCodexAgentPrompt={setCodexAgentPrompt}
            setCodexAgentPromptFocused={setCodexAgentPromptFocused}
            codexAgentTextareaRef={codexAgentTextareaRef}
            codexAgentCommandSuggestions={codexAgentCommandSuggestions}
            applyCodexAgentCommand={applyCodexAgentCommand}
            codexAgentAttachments={codexAgentAttachments}
            codexAgentPreviewAttachment={codexAgentPreviewAttachment}
            setCodexAgentPreviewAttachment={setCodexAgentPreviewAttachment}
            removeCodexAgentAttachment={removeCodexAgentAttachment}
            addCodexAgentAttachments={addCodexAgentAttachments}
            handleCodexAgentPaste={handleCodexAgentPaste}
            handleCodexAgentDragOver={handleCodexAgentDragOver}
            handleCodexAgentDrop={handleCodexAgentDrop}
            runCodexAgentPanel={runCodexAgentPanel}
            onClose={() => setCodexAgentOpen(false)}
          />
        )}

        {fileError ? (
          <div className="quiet-box danger-text">{fileError}</div>
        ) : (
          <div
            className={showLiveChangesPanel ? 'changes-editor-body has-live-diff' : 'changes-editor-body'}
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
            {showLiveChangesPanel && (
              <LiveChangesPanel
                liveChanges={liveChanges}
                liveChangesStale={liveChangesStale}
                editedLines={editedLines}
                selectedLang={selectedLang}
                onClose={() => setLiveChangesOpen(false)}
                focusLiveChange={focusLiveChange}
                revertLiveChange={revertLiveChange}
              />
            )}
          </div>
        )}
        {selectedPath && viewMode === 'code' && !fileError && !textUnavailableMessage && (
          <EditorStatusBar
            editorSelection={editorSelection}
            editorIndentSelectValue={editorIndentSelectValue}
            editorIndent={editorIndent}
            updateEditorIndent={updateEditorIndent}
            editorLineEnding={editorLineEnding}
            updateEditorLineEnding={updateEditorLineEnding}
            chunkedTextActive={chunkedTextActive}
            chunkedTextPreview={chunkedTextPreview}
          />
        )}
      </div>

      {fileMenu && (
        <EditorFileContextMenu
          fileMenu={fileMenu}
          contextMenuChange={contextMenuChange}
          apiReady={Boolean(api && currentRepoPath)}
          stageFileFromMenu={stageFileFromMenu}
          unstageFileFromMenu={unstageFileFromMenu}
          renameFileFromMenu={renameFileFromMenu}
          deleteFileFromMenu={deleteFileFromMenu}
          openInEditorFromMenu={openInEditorFromMenu}
          openTerminalFromMenu={openTerminalFromMenu}
          showInFileManagerFromMenu={showInFileManagerFromMenu}
          copyPathFromMenu={copyPathFromMenu}
          copyNameFromMenu={copyNameFromMenu}
        />
      )}
    </section>
  )
}
