import {
  type Dispatch,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
  type SetStateAction
} from 'react'
import { formatBytes } from './editorPrimitives'
import { utf8ByteOffset } from './editorLintHelpers'
import { revertLiveChangeInText } from './liveLineChanges'
import { selectedSearchText, type EditorViewMode, type FileSearchMatch } from './editorViewHelpers'
import type { ChunkedTextPreview, EditorFileMenu, LiveLineChange } from './editorTypes'
import type { RepositoryContentSearchMatch } from './editorStateTypes'
import type { HexBytePreview } from './hexUtils'
import type { RepositoryFileEntry } from '../../../shared/branchPilot'

interface ParsedHexDraft {
  bytes: Uint8Array | null
  error: string | null
}

interface PendingEditorFocus {
  filePath: string
  lineNumber: number
  column: number
  length: number
  byteOffset?: number
}

interface UseEditorInteractionsParams {
  selectedChange: { status: string } | null
  gitChangedLines: number
  hexDirty: boolean
  parsedHexDraft: ParsedHexDraft
  viewMode: EditorViewMode
  hexBytes: HexBytePreview | null
  hexFullFileLoaded: boolean
  chunkedTextPreview: ChunkedTextPreview | null
  textUnavailableMessage: string | null
  textDirty: boolean
  editedLines: number
  gitDiffLoading: boolean
  setFileMenu: Dispatch<SetStateAction<EditorFileMenu | null>>
  pendingEditorFocusRef: { current: PendingEditorFocus | null }
  fileQuery: string
  setFileSearchQuery: Dispatch<SetStateAction<string>>
  setViewMode: Dispatch<SetStateAction<EditorViewMode>>
  setSelectedPath: Dispatch<SetStateAction<string>>
  selectedPath: string
  fileLoading: boolean
  focusCodePosition: (lineNumber: number, column?: number, length?: number) => void
  fileSearchMatches: FileSearchMatch[]
  setActiveSearchIndex: Dispatch<SetStateAction<number>>
  focusSearchMatch: (match: FileSearchMatch) => void
  activeSearchIndex: number
  focusFileLineSearchTarget: () => boolean
  fileError: string | null
  textareaRef: { current: HTMLTextAreaElement | null }
  fileSearchInputRef: { current: HTMLInputElement | null }
  draftText: string
  availableViewModes: Array<{ id: EditorViewMode; label: string }>
  pendingHexOffsetRef: { current: number | null }
  editorTextSnapshot: () => { text: string }
  chunkedTextActive: boolean
  activeEditorLineBase: number
  applyEditorTextChange: (nextText: string) => void
}

export function useEditorInteractions({
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
}: UseEditorInteractionsParams) {
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

  const renderViewModeTabs = (): ReactElement | null => {
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

  const revertLiveChange = (change: LiveLineChange) => {
    const snapshot = editorTextSnapshot()
    const localChange = chunkedTextActive
      ? { ...change, lineNumber: change.lineNumber - activeEditorLineBase + 1 }
      : change
    const nextText = revertLiveChangeInText(snapshot.text, localChange)
    if (nextText === snapshot.text) return

    applyEditorTextChange(nextText)
  }

  return {
    gitStatusText,
    editorStatusText,
    openFileContextMenu,
    openRepositoryFileRow,
    activateSearchMatch,
    handleFileSearchKeyDown,
    focusFileSearchInput,
    codeViewHexOffset,
    renderViewModeTabs,
    revertLiveChange
  }
}
