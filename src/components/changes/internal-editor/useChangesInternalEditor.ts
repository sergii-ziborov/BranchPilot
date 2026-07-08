import { useEffect } from 'react'
import type { ChangesInternalEditorProps } from './changesInternalEditorProps'
import type { useEditorState } from './useEditorState'
import { useEditorFileActions } from './useEditorFileActions'
import { useEditorHealth } from './useEditorHealth'
import { useEditorGlobalListeners } from './useEditorGlobalListeners'
import { useEditorSaveActions } from './useEditorSaveActions'
import { useEditorInteractions } from './useEditorInteractions'
import { useEditorChunkPaging } from './useEditorChunkPaging'
import { useEditorStructuredEditing } from './useEditorStructuredEditing'
import { useEditorLiveChangesSync } from './useEditorLiveChangesSync'
import { useEditorSyncEffects } from './useEditorSyncEffects'
import { useEditorDataLoading } from './useEditorDataLoading'
import { defaultViewModeForPath } from './editorViewHelpers'

type EditorState = ReturnType<typeof useEditorState>

/**
 * Composite view-model hook: runs the full post-state wiring for the editor and
 * returns every bundle the parent JSX consumes. Preserves the exact hook-call
 * order of the original component: interactions -> chunk paging -> structured
 * editing -> selectedPath/repo reaction effects -> live-changes sync -> data
 * loading -> hex load -> sync effects -> (repo health reset) -> file actions ->
 * health -> global listeners -> save actions. `focusFileSearchInput` and
 * `codeViewHexOffset` are produced here (by useEditorInteractions) and consumed
 * internally, so the parent no longer threads them through.
 */
export function useChangesInternalEditor(
  props: ChangesInternalEditorProps,
  state: EditorState
) {
  const {
    api, currentRepoPath, selectedAssistant, setNotice, requestConfirmation,
    runSnapshotAction, snapshot, initialFilePath
  } = props

  const {
    selectedPath, dirty, fileMenu, contextMenuChange, setFileMenu,
    setFiles, setFilesLoading, setFilesError, setSelectedPath,
    files, filesLoading, changeByPath, selectedChange, viewMode, chunkedTextPreview,
    diagnostics, draftLines, fileError, gitChangedLines, hexBytes, textUnavailableMessage,
    lintSettings, editorRef, healthMenuRef, textareaRef, activateNextMultiEditOccurrence,
    editorUndoStackRef, editorRedoStackRef, endEditorTypingHistoryGroup, undoEditorText,
    redoEditorText, fileLoading, textSaveBlocked, chunkedTextActive, setChunkedTextPreview,
    originalText, setOriginalText, setDraftText, hexDirty, setHexBytes, hexStartOffset,
    hexEndOffset, hexFullFileLoaded, setHexOriginalText, setHexDraftText, setActiveHexByteIndex,
    hexDraftTextForSave, flushActiveEditorDraftText, applyEditorTextChange,
    parsedHexDraft, editedLines, gitDiffLoading, pendingEditorFocusRef, fileQuery,
    setFileSearchQuery, setViewMode, focusCodePosition, fileSearchMatches, setActiveSearchIndex,
    focusSearchMatch, activeSearchIndex, focusFileLineSearchTarget, fileSearchInputRef,
    draftText, availableViewModes, pendingHexOffsetRef, editorTextSnapshot, activeEditorLineBase,
    textDirty, chunkPageRequestRef, suppressAutoChunkUntilRef, lastEditorScrollTopRef,
    setFileLoading, setFileError, setTextUnavailableMessage, setEditorScrollTop, measureEditorLineHeight,
    syncEditorOverlays, updateEditorLineWindowState, jsonEdit, jsonParseResult, skipJsonEditBlurRef,
    setCollapsedJsonPaths, setJsonEdit, clearEditorTextHistory, setImagePreview, setImagePreviewError,
    setImagePreviewLoading, setHexError, setHexLoading, setHexByteDraft, setHexOffsetDraft,
    setHexSearchQuery, setActiveHexSearchIndex, setMultiEditRanges, setDiagnostics, setLiveChangesOpen,
    setLiveChangesText, setEditorSelectionState, setLintRunState, setEditorViewportHeight,
    lastHexScrollTopRef, editorVisualLineCountRef, suppressAutoHexChunkUntilRef, hexTableBodyRef,
    activeEditorText, selectedFileRowRef, visibleFiles, setFileContentMatches,
    setFileContentSearchState, setGitLineChanges, setGitDiffLoading, selectHexByte, loadHexChunk,
    activeHexSearchIndex, hexSearchMatches, activeHexByteIndex, fileSearchQuery
  } = state

  const {
    editorStatusText,
    openFileContextMenu,
    openRepositoryFileRow,
    activateSearchMatch,
    handleFileSearchKeyDown,
    focusFileSearchInput,
    codeViewHexOffset,
    renderViewModeTabs,
    revertLiveChange
  } = useEditorInteractions({
    selectedChange,
    gitChangedLines,
    hexDirty,
    parsedHexDraft,
    viewMode,
    hexBytes,
    hexFullFileLoaded,
    chunkedTextPreview,
    textUnavailableMessage,
    textDirty,
    editedLines,
    gitDiffLoading,
    setFileMenu,
    pendingEditorFocusRef,
    fileQuery,
    setFileSearchQuery,
    setViewMode,
    setSelectedPath,
    selectedPath,
    fileLoading,
    focusCodePosition,
    fileSearchMatches,
    setActiveSearchIndex,
    focusSearchMatch,
    activeSearchIndex,
    focusFileLineSearchTarget,
    fileError,
    textareaRef,
    fileSearchInputRef,
    draftText,
    availableViewModes,
    pendingHexOffsetRef,
    editorTextSnapshot,
    chunkedTextActive,
    activeEditorLineBase,
    applyEditorTextChange
  })

  const { loadChunkedTextPage, syncHighlightScroll } = useEditorChunkPaging({
    api,
    currentRepoPath,
    selectedPath,
    chunkedTextPreview,
    textDirty,
    chunkPageRequestRef,
    suppressAutoChunkUntilRef,
    lastEditorScrollTopRef,
    textareaRef,
    setChunkedTextPreview,
    setFileLoading,
    setTextUnavailableMessage,
    setViewMode,
    setOriginalText,
    setDraftText,
    setEditorScrollTop,
    measureEditorLineHeight,
    syncEditorOverlays,
    updateEditorLineWindowState,
    setNotice
  })

  const {
    updateSvgRootAttribute,
    updateSvgColorAttribute,
    toggleJsonNode,
    expandAllJson,
    collapseAllJson,
    formatJsonDraft,
    beginJsonEdit,
    cancelJsonEdit,
    commitJsonEdit
  } = useEditorStructuredEditing({
    selectedPath,
    draftText,
    lintSettings,
    jsonEdit,
    jsonExpandablePaths: jsonParseResult.expandablePaths,
    skipJsonEditBlurRef,
    setCollapsedJsonPaths,
    setJsonEdit,
    applyEditorTextChange,
    setNotice
  })

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

  useEditorLiveChangesSync({
    viewMode,
    textDirty,
    activeEditorText,
    activeEditorLineBase,
    selectedPath,
    setLiveChangesOpen,
    setLiveChangesText
  })

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

  useEditorSyncEffects({
    fileSearchQuery,
    selectedPath,
    setActiveSearchIndex,
    activeSearchIndex,
    fileSearchMatches,
    activeHexSearchIndex,
    hexSearchMatches,
    setActiveHexSearchIndex,
    parsedHexDraft,
    activeHexByteIndex,
    hexStartOffset,
    hexEndOffset,
    setActiveHexByteIndex,
    setHexByteDraft,
    fileLoading,
    fileError,
    textareaRef,
    setEditorViewportHeight,
    setEditorScrollTop,
    syncEditorOverlays,
    draftLines,
    viewMode
  })

  // Reset per-repo health state when the repository changes. Registered before
  // useEditorHealth so it runs ahead of that hook's own effects, matching the
  // original ordering; the referenced setters are read at effect-run time.
  useEffect(() => {
    setManualHealthByPath(new Map())
    setHealthScanState({ status: 'idle', scanned: 0, linted: 0, signals: 0, error: null })
  }, [currentRepoPath])

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

  useEditorGlobalListeners({
    editorRef,
    healthMenuRef,
    textareaRef,
    setHealthMenuOpen,
    currentRepoPath,
    selectedPath,
    viewMode,
    fileMenu,
    setFileMenu,
    focusFileSearchInput,
    activateNextMultiEditOccurrence,
    editorUndoStackRef,
    editorRedoStackRef,
    endEditorTypingHistoryGroup,
    undoEditorText,
    redoEditorText,
    fileError,
    fileLoading,
    textUnavailableMessage
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

  return {
    editorStatusText,
    openFileContextMenu,
    openRepositoryFileRow,
    activateSearchMatch,
    handleFileSearchKeyDown,
    renderViewModeTabs,
    revertLiveChange,
    loadChunkedTextPage,
    syncHighlightScroll,
    updateSvgRootAttribute,
    updateSvgColorAttribute,
    toggleJsonNode,
    expandAllJson,
    collapseAllJson,
    formatJsonDraft,
    beginJsonEdit,
    cancelJsonEdit,
    commitJsonEdit,
    stageFileFromMenu,
    unstageFileFromMenu,
    openInEditorFromMenu,
    openTerminalFromMenu,
    showInFileManagerFromMenu,
    copyPathFromMenu,
    copyNameFromMenu,
    renameFileFromMenu,
    deleteFileFromMenu,
    healthSettings,
    healthMenuOpen,
    setHealthMenuOpen,
    healthScanState,
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
    runAllFilesHealthCheck,
    saving,
    beautifying,
    aiBeautifying,
    saveFile,
    beautifyFile,
    beautifyFileWithAi
  }
}
