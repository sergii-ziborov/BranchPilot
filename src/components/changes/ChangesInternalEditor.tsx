import { EditorFileContextMenu } from './internal-editor/EditorFileContextMenu'
import { EditorMainPanel } from './internal-editor/EditorMainPanel'
import { EditorSidebar } from './internal-editor/EditorSidebar'
import { useEditorState } from './internal-editor/useEditorState'
import type { ChangesInternalEditorProps } from './internal-editor/changesInternalEditorProps'
import {
  EDITOR_SIDEBAR_MAX_WIDTH,
  EDITOR_SIDEBAR_MIN_WIDTH
} from './internal-editor/editorViewConstants'
import { useChangesInternalEditor } from './internal-editor/useChangesInternalEditor'

export function ChangesInternalEditor(props: ChangesInternalEditorProps) {
  const { api, currentRepoPath, onBack } = props

  const state = useEditorState(props)
  const {
    editorRef, textareaRef, fileSearchInputRef, highlightInnerRef, lineNumbersInnerRef,
    colorSwatchesInnerRef, overviewViewportRef, healthMenuRef, selectedFileRowRef,
    skipJsonEditBlurRef,
    sidebarWidth, editorStyle, startSidebarResize, handleSidebarResizeKeyDown,
    filesLoading, fileQuery, setFileQuery,
    fileContentMatches, fileContentSearchState,
    fileSearchQuery, setFileSearchQuery, activeSearchIndex,
    multiEditRanges, setMultiEditRanges, fileMenu, viewMode,
    selectedPath, setSelectedPath, draftText,
    chunkedTextPreview, imagePreview,
    imagePreviewLoading, imagePreviewError,
    hexTableBodyRef,
    hexBytes, hexLoading, hexError,
    activeHexByteIndex,
    hexByteDraft, hexOffsetDraft, setHexOffsetDraft,
    hexSearchQuery, setHexSearchQuery, activeHexSearchIndex, setActiveHexSearchIndex,
    parsedHexDraft, hexFullFileLoaded, hexChunkEditable,
    hexPreviewRows, activeHexByte, activeHexAscii, activeHexRowOffset, hexSearchMatches,
    hexDirty, goToHexOffset, jumpHexChunk, selectHexByte, updateHexByteDraft,
    commitHexByteDraft, handleHexByteInputKeyDown, hexByteChanged,
    goToHexSearchMatch, syncHexScroll,
    collapsedJsonPaths, jsonEdit, setJsonEdit,
    fileLoading, filesError, fileError,
    textUnavailableMessage, diagnostics,
    liveChangesOpen, setLiveChangesOpen,
    changeByPath, query, fileContentMatchCount, visibleFiles, visibleFileTree,
    chunkedTextActive, activeEditorText, activeEditorLineBase, editorSourceKey, textDirty,
    liveChanges, liveChangesStale, editedLines, changeKindByLine, draftLines,
    lineOffsets, multiEditLineNumbers, fileLineSearchTarget, effectiveFileSearchQuery,
    fileSearchMatches, dirty, showLiveChangesPanel, editorLineEnding, editorIndent,
    editorIndentSelectValue, diagnosticByLine, fileSearchOverflow, activeSearchMatch,
    editorSelection,
    editorOverviewViewport, editorLineWindow, visibleDraftLines,
    updateEditorSelectionStatus, focusEditorPosition,
    focusLiveChange, focusFileLineSearchTarget, beginEditorOverviewDrag, dragEditorOverview,
    endEditorOverviewDrag,
    capturePendingEditorHistory, updateEditorLineEnding, updateEditorIndent,
    updateEditorCssColor,
    handleEditorTextChange, handleEditorTextKeyDown, handleEditorPaste,
    lintSettings, lintRunState, selectedLintSupported, lintBlocked,
    lintBadgeLabel, lintMenuClassName, goToDiagnostic, updateLintSettings, runLint,
    editorOverviewMarkers, editorMinimapLines, editorCssColorTokens, selectedIsSvg,
    activeImagePreviewUrl, svgAnalysis, jsonParseResult, selectedIcon, selectedLang,
    contextMenuChange, textSaveBlocked
  } = state

  const {
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
  } = useChangesInternalEditor(props, state)

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

      <EditorMainPanel
        header={{ selectedPath, selectedIcon, editorStatusText, renderViewModeTabs }}
        fileError={fileError}
        selectedPath={selectedPath}
        openFileContextMenu={openFileContextMenu}
        showLiveChangesPanel={showLiveChangesPanel}
        fileLoading={fileLoading}
        showStatusBar={Boolean(selectedPath && viewMode === 'code' && !fileError && !textUnavailableMessage)}
        headerActions={{
          fileSearchInputRef,
          fileSearchQuery,
          setFileSearchQuery,
          handleFileSearchKeyDown,
          fileLineSearchTarget,
          activeSearchIndex,
          fileSearchMatchCount: fileSearchMatches.length,
          fileSearchOverflow,
          focusFileLineSearchTarget,
          activateSearchMatch,
          selectedPath,
          fileLoading,
          fileError,
          textUnavailableMessage,
          viewMode,
          showLiveChangesPanel,
          setLiveChangesOpen,
          textDirty,
          liveChangesOpen,
          liveChangesStale,
          editedLines,
          lintMenuClassName,
          selectedLintSupported,
          lintBlocked,
          lintBadgeLabel,
          lintRunState,
          runLint,
          diagnostics,
          goToDiagnostic,
          lintSettings,
          updateLintSettings,
          apiReady: Boolean(api && currentRepoPath),
          beautifyFile,
          beautifyFileWithAi,
          beautifying,
          aiBeautifying,
          chunkedTextActive,
          saveFile,
          saving,
          hexLoading,
          parsedHexError: parsedHexDraft.error,
          hexDirty,
          textSaveBlocked
        }}

        viewSwitch={{
          viewMode,
          textUnavailableMessage,
          dirty,
          chunkedTextActive,
          chunkedTextPreview,
          loadChunkedTextPage,
          lineNumbersInnerRef,
          highlightInnerRef,
          colorSwatchesInnerRef,
          overviewViewportRef,
          textareaRef,
          visibleDraftLines,
          draftLineCount: draftLines.length,
          activeEditorLineBase,
          editorLineWindowStart: editorLineWindow.start,
          diagnosticByLine,
          changeKindByLine,
          multiEditLineNumbers,
          lineOffsets,
          multiEditRanges,
          setMultiEditRanges,
          selectedLang,
          effectiveFileSearchQuery,
          activeSearchMatch,
          currentRepoPath,
          selectedPath,
          editorSourceKey,
          activeEditorText,
          fileLoading,
          capturePendingEditorHistory,
          handleEditorTextChange,
          handleEditorTextKeyDown,
          handleEditorPaste,
          syncHighlightScroll,
          updateEditorSelectionStatus,
          editorOverviewViewport,
          editorMinimapLines,
          editorOverviewMarkers,
          beginEditorOverviewDrag,
          dragEditorOverview,
          endEditorOverviewDrag,
          focusEditorPosition,
          editorCssColorTokens,
          updateEditorCssColor,
          diagnostics,
          goToDiagnostic,
          selectedIsSvg,
          draftText,
          activeImagePreviewUrl,
          imagePreview,
          imagePreviewError,
          imagePreviewLoading,
          hexLoading,
          hexError,
          hexBytes,
          hexFullFileLoaded,
          hexChunkEditable,
          hexPreviewRows,
          parsedHexDraft,
          activeHexByteIndex,
          activeHexByte,
          activeHexAscii,
          activeHexRowOffset,
          hexByteDraft,
          hexOffsetDraft,
          hexSearchQuery,
          activeHexSearchIndex,
          hexSearchMatches,
          hexTableBodyRef,
          setHexOffsetDraft,
          setHexSearchQuery,
          setActiveHexSearchIndex,
          jumpHexChunk,
          goToHexOffset,
          goToHexSearchMatch,
          selectHexByte,
          updateHexByteDraft,
          commitHexByteDraft,
          handleHexByteInputKeyDown,
          hexByteChanged,
          syncHexScroll,
          svgAnalysis,
          updateSvgRootAttribute,
          updateSvgColorAttribute,
          jsonParseResult,
          collapsedJsonPaths,
          jsonEdit,
          setJsonEdit,
          skipJsonEditBlurRef,
          expandAllJson,
          collapseAllJson,
          formatJsonDraft,
          toggleJsonNode,
          beginJsonEdit,
          cancelJsonEdit,
          commitJsonEdit
        }}
        liveChangesPanel={{
          liveChanges,
          liveChangesStale,
          editedLines,
          selectedLang,
          onClose: () => setLiveChangesOpen(false),
          focusLiveChange,
          revertLiveChange
        }}
        statusBar={{
          editorSelection,
          editorIndentSelectValue,
          editorIndent,
          updateEditorIndent,
          editorLineEnding,
          updateEditorLineEnding,
          chunkedTextActive,
          chunkedTextPreview
        }}
      />

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
