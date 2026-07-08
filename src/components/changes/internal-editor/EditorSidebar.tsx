import type { Dispatch, SetStateAction } from 'react'
import { ArrowLeft, Search } from 'lucide-react'
import { EditorHealthMenu, type EditorHealthMenuProps } from './EditorHealthMenu'
import { EditorFileTreePanel, type EditorFileTreePanelProps } from './EditorFileTreePanel'

type EditorSidebarProps = EditorHealthMenuProps & EditorFileTreePanelProps & {
  onBack: () => void
  fileQuery: string
  setFileQuery: Dispatch<SetStateAction<string>>
  query: string
  fileContentMatchCount: number
}

export function EditorSidebar(props: EditorSidebarProps) {
  const {
    onBack,
    fileQuery,
    setFileQuery,
    query,
    fileContentMatchCount,
    healthMenuRef,
    healthPanelSeverity,
    healthEnabled,
    healthSummaryTitle,
    healthMenuOpen,
    setHealthMenuOpen,
    healthSignalCount,
    runAllFilesHealthCheck,
    healthRunDisabled,
    healthScanState,
    healthScanSummary,
    healthSettings,
    updateHealthSettings,
    resetHealthSettings,
    selectedPath,
    selectedHealthReport,
    liveHealthReports,
    setSelectedPath,
    filesLoading,
    filesError,
    visibleFiles,
    fileContentSearchState,
    visibleFileTree,
    changeByPath,
    dirty,
    healthRowSignals,
    fileHealthByPath,
    fileContentMatches,
    selectedFileRowRef,
    openRepositoryFileRow,
    openFileContextMenu
  } = props

  return (
    <aside className="changes-editor-sidebar">
      <div className="changes-editor-sidebar-actions">
        <button type="button" className="secondary changes-editor-back" onClick={onBack}>
          <ArrowLeft size={16} />
          Back to diff
        </button>
        <EditorHealthMenu
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
        />
      </div>
      <label className="changes-editor-search">
        <Search size={15} />
        <input value={fileQuery} onChange={(event) => setFileQuery(event.target.value)} placeholder="Search files and content" />
      </label>
      {query && (
        <div className="changes-editor-content-search-status">
          {fileContentSearchState.error ? (
            <span className="danger-text">{fileContentSearchState.error}</span>
          ) : fileContentSearchState.status === 'searching' ? (
            <span>Searching content...</span>
          ) : fileContentMatchCount > 0 ? (
            <span>{fileContentMatchCount} content match{fileContentMatchCount === 1 ? '' : 'es'}{fileContentSearchState.truncated ? ' (limited)' : ''}</span>
          ) : (
            <span>Path + content search</span>
          )}
        </div>
      )}
      <EditorFileTreePanel
        filesLoading={filesLoading}
        filesError={filesError}
        visibleFiles={visibleFiles}
        fileContentSearchState={fileContentSearchState}
        visibleFileTree={visibleFileTree}
        changeByPath={changeByPath}
        selectedPath={selectedPath}
        dirty={dirty}
        healthEnabled={healthEnabled}
        healthRowSignals={healthRowSignals}
        fileHealthByPath={fileHealthByPath}
        fileContentMatches={fileContentMatches}
        selectedFileRowRef={selectedFileRowRef}
        openRepositoryFileRow={openRepositoryFileRow}
        openFileContextMenu={openFileContextMenu}
      />
    </aside>
  )
}
