import { Code2, Copy, FolderOpen, MinusSquare, Pencil, PlusSquare, Terminal, Trash2 } from 'lucide-react'
import type { FileChange } from '../../../shared/branchPilot'
import type { EditorFileMenu } from './editorTypes'

interface EditorFileContextMenuProps {
  fileMenu: EditorFileMenu
  contextMenuChange: FileChange | null | undefined
  apiReady: boolean
  stageFileFromMenu: () => void
  unstageFileFromMenu: () => void
  renameFileFromMenu: () => Promise<void>
  deleteFileFromMenu: () => Promise<void>
  openInEditorFromMenu: () => void
  openTerminalFromMenu: () => void
  showInFileManagerFromMenu: () => void
  copyPathFromMenu: () => void
  copyNameFromMenu: () => void
}

export function EditorFileContextMenu({
  fileMenu,
  contextMenuChange,
  apiReady,
  stageFileFromMenu,
  unstageFileFromMenu,
  renameFileFromMenu,
  deleteFileFromMenu,
  openInEditorFromMenu,
  openTerminalFromMenu,
  showInFileManagerFromMenu,
  copyPathFromMenu,
  copyNameFromMenu
}: EditorFileContextMenuProps) {
  return (
    <div className="context-menu changes-editor-context-menu" role="menu" style={{ top: fileMenu.y, left: fileMenu.x }}>
      <button
        type="button"
        role="menuitem"
        title="Stage this file"
        onClick={stageFileFromMenu}
        disabled={!contextMenuChange || (!contextMenuChange.unstaged && !contextMenuChange.untracked) || !apiReady}
      >
        <PlusSquare size={15} />
        Stage file
      </button>
      <button
        type="button"
        role="menuitem"
        title="Unstage this file"
        onClick={unstageFileFromMenu}
        disabled={!contextMenuChange?.staged || !apiReady}
      >
        <MinusSquare size={15} />
        Unstage file
      </button>
      <div className="context-menu-separator" role="separator" />
      <button type="button" role="menuitem" title="Rename this file" onClick={renameFileFromMenu} disabled={!apiReady}>
        <Pencil size={15} />
        Rename file
      </button>
      <button type="button" role="menuitem" title="Delete this file from the working tree" onClick={deleteFileFromMenu} disabled={!apiReady}>
        <Trash2 size={15} />
        Delete file
      </button>
      <div className="context-menu-separator" role="separator" />
      <button type="button" role="menuitem" title="Open this file in your editor" onClick={openInEditorFromMenu} disabled={!apiReady}>
        <Code2 size={15} />
        Open in editor
      </button>
      <button type="button" role="menuitem" title="Open a terminal in this file's folder" onClick={openTerminalFromMenu} disabled={!apiReady}>
        <Terminal size={15} />
        Open in terminal
      </button>
      <button type="button" role="menuitem" title="Show this file in the file manager" onClick={showInFileManagerFromMenu} disabled={!apiReady}>
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
  )
}
