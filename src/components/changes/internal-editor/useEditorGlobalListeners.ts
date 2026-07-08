import { useEffect } from 'react'
import type { Dispatch, MutableRefObject, RefObject, SetStateAction } from 'react'
import type { EditorFileMenu } from './editorTypes'
import {
  closeOpenEditorDetails,
  isNativeEditableTarget,
  shortcutKey,
  type EditorTextHistoryEntry,
  type EditorViewMode
} from './editorViewHelpers'

interface UseEditorGlobalListenersParams {
  editorRef: RefObject<HTMLElement | null>
  healthMenuRef: RefObject<HTMLDivElement | null>
  textareaRef: RefObject<HTMLTextAreaElement | null>
  setHealthMenuOpen: Dispatch<SetStateAction<boolean>>
  currentRepoPath: string | undefined
  selectedPath: string
  viewMode: EditorViewMode
  fileMenu: EditorFileMenu | null
  setFileMenu: Dispatch<SetStateAction<EditorFileMenu | null>>
  focusFileSearchInput: (copyEditorSelection?: boolean) => boolean
  activateNextMultiEditOccurrence: () => void
  editorUndoStackRef: MutableRefObject<EditorTextHistoryEntry[]>
  editorRedoStackRef: MutableRefObject<EditorTextHistoryEntry[]>
  endEditorTypingHistoryGroup: () => void
  undoEditorText: () => void
  redoEditorText: () => void
  fileError: string | null
  fileLoading: boolean
  textUnavailableMessage: string | null
}

export function useEditorGlobalListeners({
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
}: UseEditorGlobalListenersParams): void {
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
}
