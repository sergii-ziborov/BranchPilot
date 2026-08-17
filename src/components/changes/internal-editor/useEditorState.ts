import { useRef, useState } from 'react'
import type { ImagePreview, RepositoryFileEntry } from '../../../shared/branchPilot'
import type { ChunkedTextPreview, EditorDiagnostic, EditorFileMenu, LiveLineChange } from './editorTypes'
import { type JsonEditCell } from './jsonTreeUtils'
import type { RepositoryContentSearchMatch, RepositoryContentSearchState } from './editorStateTypes'
import { useEditorSidebarResize } from './useEditorSidebarResize'
import { useEditorDerivedViewState } from './useEditorDerivedViewState'
import { useHexEditor } from './useHexEditor'
import { useEditorMultiEdit } from './useEditorMultiEdit'
import { useEditorTextHistory } from './useEditorTextHistory'
import { useEditorViewport } from './useEditorViewport'
import { useEditorLint } from './useEditorLint'
import { defaultViewModeForPath, type EditorTextRange, type EditorViewMode } from './editorViewHelpers'
import { useEditorLiveDerivedState } from './useEditorLiveDerivedState'
import type { ChangesInternalEditorProps } from './changesInternalEditorProps'

export function useEditorState(props: ChangesInternalEditorProps) {
  const { api, currentRepoPath, snapshot, initialFilePath, setNotice } = props
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
    changeByPath,
    selectedChange,
    query,
    fileContentMatchCount,
    visibleFiles,
    visibleFileTree,
    chunkedTextActive,
    activeEditorText,
    activeEditorLineBase,
    editorSourceKey,
    textDirty,
    liveChanges,
    liveChangesStale,
    editedLines,
    changeKindByLine,
    gitChangedLines,
    draftLines,
    lineOffsets,
    multiEditLineNumbers,
    fileLineSearchTarget,
    effectiveFileSearchQuery,
    fileSearchMatches,
    dirty,
    showLiveChangesPanel,
    editorLineEnding,
    editorIndent,
    editorIndentSelectValue,
    diagnosticByLine,
    fileSearchOverflow,
    activeSearchMatch,
    fileSearchLineNumbers
  } = useEditorLiveDerivedState({
    snapshot,
    fileQuery,
    files,
    fileContentMatches,
    chunkedTextPreview,
    draftText,
    originalText,
    liveChangesText,
    gitLineChanges,
    multiEditRanges,
    fileSearchQuery,
    activeSearchIndex,
    selectedPath,
    hexDirty,
    diagnostics,
    fileLoading,
    liveChangesOpen,
    viewMode,
    textUnavailableMessage
  })

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

  const {
    editorOverviewMarkers,
    editorMinimapLines,
    editorCssColorTokens,
    selectedIsSvg,
    activeImagePreviewUrl,
    svgAnalysis,
    jsonParseResult,
    selectedIcon,
    selectedLang,
    contextMenuChange,
    availableViewModes
  } = useEditorDerivedViewState({
    activeEditorLineBase,
    draftLines,
    draftText,
    visibleDraftLines,
    editorLineWindowStart: editorLineWindow.start,
    gitLineChanges,
    liveChanges,
    diagnostics,
    fileSearchMatches,
    changeKindByLine,
    diagnosticByLine,
    fileSearchLineNumbers,
    multiEditLineNumbers,
    selectedPath,
    textUnavailableMessage,
    chunkedTextActive,
    imagePreview,
    lintSettings,
    collapsedJsonPaths,
    fileMenu,
    changeByPath
  })

  const textSaveBlocked = false

  return {
    editorRef, textareaRef, fileSearchInputRef, highlightInnerRef, lineNumbersInnerRef,
    colorSwatchesInnerRef, overviewViewportRef, healthMenuRef, selectedFileRowRef,
    skipJsonEditBlurRef, chunkPageRequestRef, pendingEditorFocusRef, lastEditorScrollTopRef,
    suppressAutoChunkUntilRef,
    sidebarWidth, editorStyle, startSidebarResize, handleSidebarResizeKeyDown,
    files, setFiles, filesLoading, setFilesLoading, fileQuery, setFileQuery,
    fileContentMatches, setFileContentMatches, fileContentSearchState, setFileContentSearchState,
    fileSearchQuery, setFileSearchQuery, activeSearchIndex, setActiveSearchIndex,
    multiEditRanges, setMultiEditRanges, fileMenu, setFileMenu, viewMode, setViewMode,
    selectedPath, setSelectedPath, originalText, setOriginalText, draftText, setDraftText,
    chunkedTextPreview, setChunkedTextPreview, imagePreview, setImagePreview,
    imagePreviewLoading, setImagePreviewLoading, imagePreviewError, setImagePreviewError,
    hexTableBodyRef, lastHexScrollTopRef, suppressAutoHexChunkUntilRef, pendingHexOffsetRef,
    hexBytes, setHexBytes, hexLoading, setHexLoading, hexError, setHexError,
    setHexOriginalText, setHexDraftText, activeHexByteIndex, setActiveHexByteIndex,
    hexByteDraft, setHexByteDraft, hexOffsetDraft, setHexOffsetDraft,
    hexSearchQuery, setHexSearchQuery, activeHexSearchIndex, setActiveHexSearchIndex,
    parsedHexDraft, hexStartOffset, hexEndOffset, hexFullFileLoaded, hexChunkEditable,
    hexPreviewRows, activeHexByte, activeHexAscii, activeHexRowOffset, hexSearchMatches,
    hexDirty, loadHexChunk, goToHexOffset, jumpHexChunk, selectHexByte, updateHexByteDraft,
    commitHexByteDraft, handleHexByteInputKeyDown, hexByteChanged, hexDraftTextForSave,
    goToHexSearchMatch, syncHexScroll,
    collapsedJsonPaths, setCollapsedJsonPaths, jsonEdit, setJsonEdit,
    fileLoading, setFileLoading, filesError, setFilesError, fileError, setFileError,
    textUnavailableMessage, setTextUnavailableMessage, diagnostics, setDiagnostics,
    gitLineChanges, setGitLineChanges, gitDiffLoading, setGitDiffLoading,
    liveChangesOpen, setLiveChangesOpen, liveChangesText, setLiveChangesText,
    changeByPath, selectedChange, query, fileContentMatchCount, visibleFiles, visibleFileTree,
    chunkedTextActive, activeEditorText, activeEditorLineBase, editorSourceKey, textDirty,
    liveChanges, liveChangesStale, editedLines, changeKindByLine, gitChangedLines, draftLines,
    lineOffsets, multiEditLineNumbers, fileLineSearchTarget, effectiveFileSearchQuery,
    fileSearchMatches, dirty, showLiveChangesPanel, editorLineEnding, editorIndent,
    editorIndentSelectValue, diagnosticByLine, fileSearchOverflow, activeSearchMatch, fileSearchLineNumbers,
    editorVisualLineCountRef, setEditorScrollTop, setEditorViewportHeight, editorSelection,
    setEditorSelectionState, editorOverviewViewport, editorLineWindow, visibleDraftLines,
    measureEditorLineHeight, syncEditorOverlays, updateEditorLineWindowState,
    updateEditorSelectionStatus, focusEditorPosition, focusCodePosition, focusSearchMatch,
    focusLiveChange, focusFileLineSearchTarget, beginEditorOverviewDrag, dragEditorOverview,
    endEditorOverviewDrag,
    editorUndoStackRef, editorRedoStackRef, pendingEditorHistoryRef, editorDraftTextRef,
    editorTypingHistoryActiveRef, editorTextSnapshot, pushEditorUndoEntry,
    endEditorTypingHistoryGroup, touchEditorTypingHistoryGroup, clearEditorTextHistory,
    setActiveEditorDraftText, flushActiveEditorDraftText, applyEditorTextChange, undoEditorText,
    redoEditorText, capturePendingEditorHistory, updateEditorLineEnding, updateEditorIndent,
    updateEditorCssColor,
    activateNextMultiEditOccurrence, handleEditorTextChange, handleEditorTextKeyDown, handleEditorPaste,
    lintSettings, lintRunState, setLintRunState, selectedLintSupported, lintBlocked,
    lintBadgeLabel, lintMenuClassName, goToDiagnostic, updateLintSettings, runLint,
    editorOverviewMarkers, editorMinimapLines, editorCssColorTokens, selectedIsSvg,
    activeImagePreviewUrl, svgAnalysis, jsonParseResult, selectedIcon, selectedLang,
    contextMenuChange, availableViewModes, textSaveBlocked
  }
}
