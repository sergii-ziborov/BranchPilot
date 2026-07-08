import {
  type ChangeEvent as ReactChangeEvent,
  type ClipboardEvent as ReactClipboardEvent,
  type Dispatch,
  type KeyboardEvent as ReactKeyboardEvent,
  type SetStateAction
} from 'react'
import { clamp } from './editorPrimitives'
import {
  isEditorNavigationKey,
  normalizeTextRanges,
  rangesOverlap,
  selectedTextRange,
  shortcutKey,
  type EditorTextHistoryEntry,
  type EditorTextRange,
  type EditorViewMode
} from './editorViewHelpers'
import type { JsonEditCell } from './jsonTreeUtils'

interface UseEditorMultiEditParams {
  textareaRef: { current: HTMLTextAreaElement | null }
  viewMode: EditorViewMode
  textUnavailableMessage: string | null
  fileLoading: boolean
  activeEditorText: string
  multiEditRanges: EditorTextRange[]
  setMultiEditRanges: Dispatch<SetStateAction<EditorTextRange[]>>
  setJsonEdit: Dispatch<SetStateAction<JsonEditCell | null>>
  setNotice: (message: string) => void
  updateEditorSelectionStatus: (textarea?: HTMLTextAreaElement | null, immediate?: boolean) => void
  editorDraftTextRef: { current: string }
  pendingEditorHistoryRef: { current: EditorTextHistoryEntry | null }
  editorTypingHistoryActiveRef: { current: boolean }
  editorUndoStackRef: { current: EditorTextHistoryEntry[] }
  editorRedoStackRef: { current: EditorTextHistoryEntry[] }
  editorTextSnapshot: (textarea?: HTMLTextAreaElement | null) => EditorTextHistoryEntry
  pushEditorUndoEntry: (entry: EditorTextHistoryEntry) => void
  endEditorTypingHistoryGroup: () => void
  touchEditorTypingHistoryGroup: () => void
  setActiveEditorDraftText: (nextText: string, options?: { syncTextarea?: boolean }) => void
  capturePendingEditorHistory: () => void
  undoEditorText: () => void
  redoEditorText: () => void
}

export function useEditorMultiEdit({
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
}: UseEditorMultiEditParams) {
  const setEditorSelection = (start: number, end = start) => {
    window.requestAnimationFrame(() => {
      const textarea = textareaRef.current
      if (!textarea) return
      textarea.focus()
      textarea.setSelectionRange(clamp(start, 0, textarea.value.length), clamp(end, 0, textarea.value.length))
      updateEditorSelectionStatus(textarea, true)
    })
  }

  const activateNextMultiEditOccurrence = () => {
    const textarea = textareaRef.current
    if (!textarea || viewMode !== 'code' || textUnavailableMessage || fileLoading) return

    const text = textarea.value
    const primaryRange = multiEditRanges[0] ?? selectedTextRange(text, textarea.selectionStart, textarea.selectionEnd)
    if (!primaryRange) {
      setNotice('Select text or place the caret on a word before pressing Ctrl+D.')
      return
    }

    const queryText = text.slice(primaryRange.start, primaryRange.end)
    if (!queryText) return

    const ranges = normalizeTextRanges(multiEditRanges.length ? multiEditRanges : [primaryRange])
    const lastRange = ranges[ranges.length - 1]
    let nextIndex = text.indexOf(queryText, lastRange.end)
    if (nextIndex === -1) nextIndex = text.indexOf(queryText)

    while (nextIndex !== -1) {
      const nextRange = { start: nextIndex, end: nextIndex + queryText.length }
      if (!ranges.some((range) => rangesOverlap(range, nextRange) || (range.start === nextRange.start && range.end === nextRange.end))) {
        const nextRanges = normalizeTextRanges([...ranges, nextRange])
        setMultiEditRanges(nextRanges)
        setEditorSelection(nextRange.start, nextRange.end)
        setNotice(`${nextRanges.length} selections in this chunk.`)
        return
      }
      nextIndex = text.indexOf(queryText, nextIndex + Math.max(1, queryText.length))
    }

    setNotice(`No more "${queryText}" matches in this chunk.`)
  }

  const applyTextToMultiEditRanges = (replacement: string, mode: 'replace' | 'backspace' | 'delete' = 'replace') => {
    const textarea = textareaRef.current
    const sourceText = textarea?.value ?? activeEditorText
    const sourceRanges = normalizeTextRanges(multiEditRanges)
    if (sourceRanges.length === 0) return false

    const editableRanges = sourceRanges.map((range) => {
      if (mode === 'backspace' && range.start === range.end) {
        return { start: Math.max(0, range.start - 1), end: range.end }
      }
      if (mode === 'delete' && range.start === range.end) {
        return { start: range.start, end: Math.min(sourceText.length, range.end + 1) }
      }
      return range
    })

    if (editableRanges.every((range) => range.start === range.end) && replacement === '') return true

    let cursor = 0
    let nextText = ''
    const nextRanges: EditorTextRange[] = []
    for (const range of editableRanges) {
      nextText += sourceText.slice(cursor, range.start)
      const nextStart = nextText.length
      nextText += replacement
      const nextEnd = nextStart + replacement.length
      nextRanges.push({ start: nextEnd, end: nextEnd })
      cursor = range.end
    }
    nextText += sourceText.slice(cursor)

    pushEditorUndoEntry(editorTextSnapshot(textarea))
    endEditorTypingHistoryGroup()
    setActiveEditorDraftText(nextText)
    setJsonEdit(null)
    setMultiEditRanges(nextRanges)
    setEditorSelection(nextRanges[nextRanges.length - 1].start)
    return true
  }

  const handleEditorTextChange = (event: ReactChangeEvent<HTMLTextAreaElement>) => {
    if (multiEditRanges.length > 0) {
      setMultiEditRanges([])
    }

    const nextText = event.currentTarget.value
    const previousText = editorDraftTextRef.current
    const previous = pendingEditorHistoryRef.current ?? (editorTypingHistoryActiveRef.current ? null : {
      text: previousText,
      selectionStart: Math.min(previousText.length, event.currentTarget.selectionStart),
      selectionEnd: Math.min(previousText.length, event.currentTarget.selectionEnd)
    })
    pendingEditorHistoryRef.current = null

    if (previous && previous.text !== nextText) {
      pushEditorUndoEntry(previous)
    }
    editorTypingHistoryActiveRef.current = true
    touchEditorTypingHistoryGroup()
    updateEditorSelectionStatus(event.currentTarget)
    setActiveEditorDraftText(nextText, { syncTextarea: false })
  }

  const handleEditorTextKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    const key = shortcutKey(event)
    if ((event.ctrlKey || event.metaKey) && !event.altKey && key === 'd') {
      event.preventDefault()
      activateNextMultiEditOccurrence()
      return
    }

    if (multiEditRanges.length > 0 && isEditorNavigationKey(event.key)) {
      setMultiEditRanges([])
      return
    }

    if (multiEditRanges.length > 0 && !(event.ctrlKey || event.metaKey) && !event.altKey) {
      if (event.key.length === 1) {
        event.preventDefault()
        applyTextToMultiEditRanges(event.key)
        return
      }
      if (event.key === 'Enter') {
        event.preventDefault()
        applyTextToMultiEditRanges('\n')
        return
      }
      if (event.key === 'Tab') {
        event.preventDefault()
        applyTextToMultiEditRanges('\t')
        return
      }
      if (event.key === 'Backspace') {
        event.preventDefault()
        applyTextToMultiEditRanges('', 'backspace')
        return
      }
      if (event.key === 'Delete') {
        event.preventDefault()
        applyTextToMultiEditRanges('', 'delete')
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        setMultiEditRanges([])
        return
      }
    }

    if (!(event.ctrlKey || event.metaKey) || event.altKey) {
      if (
        event.key.length === 1 ||
        event.key === 'Enter' ||
        event.key === 'Backspace' ||
        event.key === 'Delete' ||
        event.key === 'Tab'
      ) {
        capturePendingEditorHistory()
      }
      return
    }

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

  const handleEditorPaste = (event: ReactClipboardEvent<HTMLTextAreaElement>) => {
    if (multiEditRanges.length === 0) return
    event.preventDefault()
    applyTextToMultiEditRanges(event.clipboardData.getData('text/plain'))
  }

  return {
    activateNextMultiEditOccurrence,
    handleEditorTextChange,
    handleEditorTextKeyDown,
    handleEditorPaste
  }
}
