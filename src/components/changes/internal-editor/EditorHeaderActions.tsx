import type {
  Dispatch,
  KeyboardEvent as ReactKeyboardEvent,
  RefObject,
  SetStateAction
} from 'react'
import { FileCode2, Save, Sparkles, WandSparkles } from 'lucide-react'
import type { EditorDiagnostic } from './editorTypes'
import type { EditorLintRunState, EditorLintSettings } from './lintSettings'
import type { FileLineSearchTarget } from './editorStateTypes'
import type { EditorViewMode } from './editorViewHelpers'
import { LOCAL_AGENT_PROVIDERS, type LocalAgentProvider } from './localAgentSupport'
import { EditorFileSearchField } from './EditorFileSearchField'
import { EditorLintMenu } from './EditorLintMenu'
import { LocalAgentBrandIcon } from './LocalAgentBrandIcon'

interface EditorHeaderActionsProps {
  fileSearchInputRef: RefObject<HTMLInputElement | null>
  fileSearchQuery: string
  setFileSearchQuery: Dispatch<SetStateAction<string>>
  handleFileSearchKeyDown: (event: ReactKeyboardEvent<HTMLInputElement>) => void
  fileLineSearchTarget: FileLineSearchTarget | null
  activeSearchIndex: number
  fileSearchMatchCount: number
  fileSearchOverflow: boolean
  focusFileLineSearchTarget: () => boolean
  activateSearchMatch: (index: number) => void
  selectedPath: string
  fileLoading: boolean
  fileError: string | null
  textUnavailableMessage: string | null
  viewMode: EditorViewMode
  showLiveChangesPanel: boolean
  setLiveChangesOpen: Dispatch<SetStateAction<boolean>>
  textDirty: boolean
  liveChangesOpen: boolean
  liveChangesStale: boolean
  editedLines: number
  lintMenuClassName: string
  selectedLintSupported: boolean
  lintBlocked: boolean
  lintBadgeLabel: string
  lintRunState: EditorLintRunState
  runLint: (focusFirst?: boolean) => void
  diagnostics: EditorDiagnostic[]
  goToDiagnostic: (diagnostic: EditorDiagnostic) => void
  lintSettings: EditorLintSettings
  updateLintSettings: (patch: Partial<EditorLintSettings>) => void
  apiReady: boolean
  codexAgentOpen: boolean
  codexAgentProvider: LocalAgentProvider
  setCodexAgentOpen: Dispatch<SetStateAction<boolean>>
  selectLocalAgentProvider: (provider: LocalAgentProvider, open?: boolean) => void
  beautifyFile: () => void
  beautifyFileWithAi: () => void
  beautifying: boolean
  aiBeautifying: boolean
  chunkedTextActive: boolean
  saveFile: () => void
  saving: boolean
  hexLoading: boolean
  parsedHexError: string | null
  hexDirty: boolean
  textSaveBlocked: boolean
}

export function EditorHeaderActions({
  fileSearchInputRef,
  fileSearchQuery,
  setFileSearchQuery,
  handleFileSearchKeyDown,
  fileLineSearchTarget,
  activeSearchIndex,
  fileSearchMatchCount,
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
  apiReady,
  codexAgentOpen,
  codexAgentProvider,
  setCodexAgentOpen,
  selectLocalAgentProvider,
  beautifyFile,
  beautifyFileWithAi,
  beautifying,
  aiBeautifying,
  chunkedTextActive,
  saveFile,
  saving,
  hexLoading,
  parsedHexError,
  hexDirty,
  textSaveBlocked
}: EditorHeaderActionsProps) {
  return (
    <div className="changes-editor-header-actions">
      <EditorFileSearchField
        fileSearchInputRef={fileSearchInputRef}
        fileSearchQuery={fileSearchQuery}
        setFileSearchQuery={setFileSearchQuery}
        handleFileSearchKeyDown={handleFileSearchKeyDown}
        disabled={!selectedPath || fileLoading || Boolean(fileError) || Boolean(textUnavailableMessage) || viewMode === 'image' || viewMode === 'hex'}
        fileLineSearchTarget={fileLineSearchTarget}
        activeSearchIndex={activeSearchIndex}
        fileSearchMatchCount={fileSearchMatchCount}
        fileSearchOverflow={fileSearchOverflow}
        focusFileLineSearchTarget={focusFileLineSearchTarget}
        activateSearchMatch={activateSearchMatch}
      />
      <button
        type="button"
        className={[
          'changes-editor-tool-button',
          'compact-icon',
          'changes-editor-live-toggle',
          showLiveChangesPanel ? 'active' : ''
        ].filter(Boolean).join(' ')}
        onClick={() => setLiveChangesOpen((open) => !open)}
        disabled={!selectedPath || !textDirty || fileLoading || viewMode !== 'code' || Boolean(textUnavailableMessage)}
        title={liveChangesOpen ? 'Hide live changes' : 'Show live changes'}
        aria-label={liveChangesOpen ? 'Hide live changes' : 'Show live changes'}
        aria-pressed={showLiveChangesPanel}
      >
        <FileCode2 size={15} />
        {textDirty && (
          <span className="changes-editor-icon-badge" aria-hidden="true">
            {liveChangesStale ? '...' : editedLines}
          </span>
        )}
        <span className="changes-editor-button-label">Live changes</span>
      </button>
      <EditorLintMenu
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
      />
      {LOCAL_AGENT_PROVIDERS.map((provider) => (
        <button
          type="button"
          className={[
            'changes-editor-tool-button',
            'compact-icon',
            'changes-editor-codex-toggle',
            `agent-${provider.value}`,
            codexAgentOpen && codexAgentProvider === provider.value ? 'active' : ''
          ].filter(Boolean).join(' ')}
          onClick={() => {
            if (codexAgentOpen && codexAgentProvider === provider.value) {
              setCodexAgentOpen(false)
              return
            }
            selectLocalAgentProvider(provider.value)
          }}
          disabled={!apiReady}
          title={codexAgentOpen && codexAgentProvider === provider.value ? `Hide ${provider.label} agent` : `Open ${provider.label} agent`}
          aria-label={codexAgentOpen && codexAgentProvider === provider.value ? `Hide ${provider.label} agent` : `Open ${provider.label} agent`}
          aria-pressed={codexAgentOpen && codexAgentProvider === provider.value}
          key={provider.value}
        >
          <LocalAgentBrandIcon provider={provider.value} />
          <span className="changes-editor-button-label">{provider.label}</span>
        </button>
      ))}
      <button
        type="button"
        className="changes-editor-tool-button compact-icon"
        onClick={beautifyFile}
        disabled={!selectedPath || chunkedTextActive || beautifying || aiBeautifying || fileLoading || Boolean(fileError) || Boolean(textUnavailableMessage) || viewMode === 'image'}
        title={chunkedTextActive ? 'Beautify is disabled for file chunks' : beautifying ? 'Beautifying...' : 'Beautify locally'}
        aria-label={chunkedTextActive ? 'Beautify is disabled for file chunks' : 'Beautify locally'}
      >
        <Sparkles size={15} />
        <span className="changes-editor-button-label">{beautifying ? 'Beautifying...' : 'Beautify'}</span>
      </button>
      <button
        type="button"
        className="changes-editor-tool-button compact-icon ai"
        onClick={beautifyFileWithAi}
        disabled={!apiReady || !selectedPath || chunkedTextActive || beautifying || aiBeautifying || fileLoading || Boolean(fileError) || Boolean(textUnavailableMessage) || viewMode === 'image'}
        title={chunkedTextActive ? 'AI Beautify is disabled for file chunks' : aiBeautifying ? 'AI beautifying...' : 'Beautify with assistant'}
        aria-label={chunkedTextActive ? 'AI Beautify is disabled for file chunks' : 'Beautify with assistant'}
      >
        <WandSparkles size={15} />
        <span className="changes-editor-button-label">{aiBeautifying ? 'AI...' : 'AI Beautify'}</span>
      </button>
      <button
        type="button"
        className="changes-editor-save-button compact-icon"
        onClick={saveFile}
        disabled={!selectedPath || textSaveBlocked || saving || fileLoading || hexLoading || Boolean(fileError) || Boolean(parsedHexError) || (Boolean(textUnavailableMessage) && !hexDirty)}
        title={saving ? 'Saving file...' : 'Save file'}
        aria-label="Save file"
      >
        <Save size={16} />
        <span className="changes-editor-button-label">{saving ? 'Saving...' : 'Save file'}</span>
      </button>
    </div>
  )
}
