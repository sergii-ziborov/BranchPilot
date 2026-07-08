import type { ComponentProps, MouseEvent, ReactNode } from 'react'
import { FileCode2 } from 'lucide-react'
import { SignalStatus } from '../../SignalStatus'
import type { FileTypeIconInfo } from '../../../lib/fileTypeIcons'
import { EditorHeaderActions } from './EditorHeaderActions'
import { EditorStatusBar } from './EditorStatusBar'
import { EditorViewSwitch } from './EditorViewSwitch'
import { LiveChangesPanel } from './LiveChangesPanel'
import { LocalAgentPanel } from './LocalAgentPanel'

interface EditorMainHeaderInfo {
  selectedPath: string
  selectedIcon: FileTypeIconInfo
  editorStatusText: ReactNode
  renderViewModeTabs: () => ReactNode
}

interface EditorMainPanelProps {
  header: EditorMainHeaderInfo
  headerActions: ComponentProps<typeof EditorHeaderActions>
  showLocalAgent: boolean
  localAgent: ComponentProps<typeof LocalAgentPanel>
  fileError: string | null
  selectedPath: string
  openFileContextMenu: (event: MouseEvent, path: string) => void
  showLiveChangesPanel: boolean
  fileLoading: boolean
  viewSwitch: ComponentProps<typeof EditorViewSwitch>
  liveChangesPanel: ComponentProps<typeof LiveChangesPanel>
  showStatusBar: boolean
  statusBar: ComponentProps<typeof EditorStatusBar>
}

export function EditorMainPanel({
  header,
  headerActions,
  showLocalAgent,
  localAgent,
  fileError,
  selectedPath,
  openFileContextMenu,
  showLiveChangesPanel,
  fileLoading,
  viewSwitch,
  liveChangesPanel,
  showStatusBar,
  statusBar
}: EditorMainPanelProps) {
  return (
    <div className="changes-editor-main">
      <header className="changes-editor-header">
        <div className="changes-editor-header-main">
          <h3>
            <FileCode2 size={16} />
            {header.selectedPath || 'Select a file'}
          </h3>
          <p>
            <span className={`file-type-icon file-type-${header.selectedIcon.tone}`} title={header.selectedIcon.title} aria-hidden="true">
              {header.selectedIcon.label}
            </span>
            {header.editorStatusText}
          </p>
          {header.renderViewModeTabs()}
        </div>
        <EditorHeaderActions {...headerActions} />
      </header>

      {showLocalAgent && <LocalAgentPanel {...localAgent} />}

      {fileError ? (
        <div className="quiet-box danger-text">{fileError}</div>
      ) : (
        <div
          className={showLiveChangesPanel ? 'changes-editor-body has-live-diff' : 'changes-editor-body'}
          onContextMenuCapture={(event) => {
            if (selectedPath) openFileContextMenu(event, selectedPath)
          }}
        >
          <EditorViewSwitch {...viewSwitch} />
          {fileLoading && (
            <SignalStatus
              className="changes-editor-file-curtain changes-editor-body-curtain"
              label="Loading file"
              detail={selectedPath}
            />
          )}
          {showLiveChangesPanel && <LiveChangesPanel {...liveChangesPanel} />}
        </div>
      )}

      {showStatusBar && <EditorStatusBar {...statusBar} />}
    </div>
  )
}
