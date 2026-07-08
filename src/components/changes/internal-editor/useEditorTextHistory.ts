import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react'
import type { CssColorEditDraft } from '../../diff/CssColorSwatch'
import { clamp } from './editorPrimitives'
import type { EditorIndentInfo, EditorLineEnding } from './editorStateTypes'
import type { ChunkedTextPreview } from './editorTypes'
import {
  EDITOR_TEXT_HISTORY_LIMIT,
  EDITOR_TYPING_HISTORY_GROUP_MS
} from './editorViewConstants'
import {
  convertEditorIndent,
  convertEditorLineEnding,
  textareaVisualLineCount,
  type EditorTextHistoryEntry,
  type EditorTextRange,
  type EditorViewMode
} from './editorViewHelpers'
import type { JsonEditCell } from './jsonTreeUtils'
import { updateLineInText } from './liveLineChanges'

interface UseEditorTextHistoryParams {
  textareaRef: { current: HTMLTextAreaElement | null }
  activeEditorText: string
  chunkedTextPreview: ChunkedTextPreview | null
  setChunkedTextPreview: Dispatch<SetStateAction<ChunkedTextPreview | null>>
  setDraftText: Dispatch<SetStateAction<string>>
  setJsonEdit: Dispatch<SetStateAction<JsonEditCell | null>>
  setMultiEditRanges: Dispatch<SetStateAction<EditorTextRange[]>>
  setCollapsedJsonPaths: Dispatch<SetStateAction<Set<string>>>
  setViewMode: Dispatch<SetStateAction<EditorViewMode>>
  fileLoading: boolean
  activeEditorLineBase: number
  chunkedTextActive: boolean
  editorIndent: EditorIndentInfo
  editorVisualLineCountRef: { current: { text: string; count: number } }
  updateEditorSelectionStatus: (textarea?: HTMLTextAreaElement | null, immediate?: boolean) => void
  updateEditorLineWindowState: (scrollTop: number, viewportHeight: number) => void
  syncEditorOverlays: (scrollLeft: number, scrollTop: number, viewportHeight?: number) => void
}

export function useEditorTextHistory({
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
}: UseEditorTextHistoryParams) {
  const editorUndoStackRef = useRef<EditorTextHistoryEntry[]>([])
  const editorRedoStackRef = useRef<EditorTextHistoryEntry[]>([])
  const pendingEditorHistoryRef = useRef<EditorTextHistoryEntry | null>(null)
  const editorDraftTextRef = useRef('')
  const editorTypingHistoryActiveRef = useRef(false)
  const editorTypingHistoryTimerRef = useRef<number | null>(null)

  useEffect(() => {
    editorDraftTextRef.current = activeEditorText
    const textarea = textareaRef.current
    if (textarea && textarea.value !== activeEditorText) {
      const selectionStart = Math.min(activeEditorText.length, textarea.selectionStart)
      const selectionEnd = Math.min(activeEditorText.length, textarea.selectionEnd)
      textarea.value = activeEditorText
      textarea.setSelectionRange(selectionStart, selectionEnd)
      editorVisualLineCountRef.current = {
        text: activeEditorText,
        count: textareaVisualLineCount(activeEditorText)
      }
      window.requestAnimationFrame(() => {
        syncEditorOverlays(textarea.scrollLeft, textarea.scrollTop, textarea.clientHeight)
      })
    }
  }, [activeEditorText])

  useEffect(() => () => {
    clearEditorTypingHistoryTimer()
  }, [])

  const editorTextSnapshot = (textarea = textareaRef.current): EditorTextHistoryEntry => {
    const text = textarea?.value ?? activeEditorText
    const selectionStart = Math.min(text.length, textarea?.selectionStart ?? text.length)
    const selectionEnd = Math.min(text.length, textarea?.selectionEnd ?? selectionStart)
    return { text, selectionStart, selectionEnd }
  }

  const pushEditorHistoryEntry = (stack: EditorTextHistoryEntry[], entry: EditorTextHistoryEntry) => {
    const last = stack[stack.length - 1]
    if (
      last &&
      last.text === entry.text &&
      last.selectionStart === entry.selectionStart &&
      last.selectionEnd === entry.selectionEnd
    ) {
      return
    }

    stack.push(entry)
    if (stack.length > EDITOR_TEXT_HISTORY_LIMIT) stack.shift()
  }

  const pushEditorUndoEntry = (entry: EditorTextHistoryEntry) => {
    pushEditorHistoryEntry(editorUndoStackRef.current, entry)
    editorRedoStackRef.current = []
  }

  const clearEditorTypingHistoryTimer = () => {
    if (editorTypingHistoryTimerRef.current === null) return
    window.clearTimeout(editorTypingHistoryTimerRef.current)
    editorTypingHistoryTimerRef.current = null
  }

  const endEditorTypingHistoryGroup = () => {
    clearEditorTypingHistoryTimer()
    editorTypingHistoryActiveRef.current = false
    pendingEditorHistoryRef.current = null
  }

  const touchEditorTypingHistoryGroup = () => {
    clearEditorTypingHistoryTimer()
    editorTypingHistoryTimerRef.current = window.setTimeout(() => {
      editorTypingHistoryTimerRef.current = null
      editorTypingHistoryActiveRef.current = false
      pendingEditorHistoryRef.current = null
    }, EDITOR_TYPING_HISTORY_GROUP_MS)
  }

  const clearEditorTextHistory = () => {
    editorUndoStackRef.current = []
    editorRedoStackRef.current = []
    endEditorTypingHistoryGroup()
    pendingEditorHistoryRef.current = null
  }

  const setActiveEditorDraftText = (nextText: string, options: { syncTextarea?: boolean } = {}) => {
    const syncTextarea = options.syncTextarea ?? true
    editorDraftTextRef.current = nextText
    if (syncTextarea && textareaRef.current && textareaRef.current.value !== nextText) {
      textareaRef.current.value = nextText
    }

    if (chunkedTextPreview) {
      setChunkedTextPreview((current) => current ? { ...current, text: nextText } : current)
      return
    }

    setDraftText(nextText)
  }

  const flushActiveEditorDraftText = () => {
    const nextText = textareaRef.current?.value ?? editorDraftTextRef.current
    if (nextText !== activeEditorText) {
      setActiveEditorDraftText(nextText, { syncTextarea: false })
    }
    return nextText
  }

  const applyEditorTextChange = (
    nextText: string,
    options: {
      selectionStart?: number
      selectionEnd?: number
      viewMode?: EditorViewMode
      resetJsonCollapse?: boolean
    } = {}
  ) => {
    const snapshot = editorTextSnapshot()
    if (snapshot.text === nextText) return false

    pushEditorUndoEntry(snapshot)
    endEditorTypingHistoryGroup()
    setActiveEditorDraftText(nextText)
    setJsonEdit(null)
    setMultiEditRanges([])
    if (options.resetJsonCollapse) setCollapsedJsonPaths(new Set())
    if (options.viewMode) setViewMode(options.viewMode)

    const selectionStart = clamp(options.selectionStart ?? snapshot.selectionStart, 0, nextText.length)
    const selectionEnd = clamp(options.selectionEnd ?? selectionStart, 0, nextText.length)
    window.requestAnimationFrame(() => {
      const textarea = textareaRef.current
      if (!textarea) return
      textarea.focus()
      textarea.setSelectionRange(selectionStart, selectionEnd)
      updateEditorSelectionStatus(textarea, true)
      updateEditorLineWindowState(textarea.scrollTop, textarea.clientHeight)
      syncEditorOverlays(textarea.scrollLeft, textarea.scrollTop, textarea.clientHeight)
    })
    return true
  }

  const restoreEditorTextSnapshot = (entry: EditorTextHistoryEntry) => {
    endEditorTypingHistoryGroup()
    setActiveEditorDraftText(entry.text)
    setJsonEdit(null)
    setMultiEditRanges([])
    window.requestAnimationFrame(() => {
      const textarea = textareaRef.current
      if (!textarea) return
      const selectionStart = Math.min(entry.selectionStart, textarea.value.length)
      const selectionEnd = Math.min(entry.selectionEnd, textarea.value.length)
      textarea.focus()
      textarea.setSelectionRange(selectionStart, selectionEnd)
      updateEditorSelectionStatus(textarea, true)
      updateEditorLineWindowState(textarea.scrollTop, textarea.clientHeight)
      syncEditorOverlays(textarea.scrollLeft, textarea.scrollTop, textarea.clientHeight)
    })
  }

  const undoEditorText = () => {
    const previous = editorUndoStackRef.current.pop()
    if (!previous) return

    pushEditorHistoryEntry(editorRedoStackRef.current, editorTextSnapshot())
    restoreEditorTextSnapshot(previous)
  }

  const redoEditorText = () => {
    const next = editorRedoStackRef.current.pop()
    if (!next) return

    pushEditorHistoryEntry(editorUndoStackRef.current, editorTextSnapshot())
    restoreEditorTextSnapshot(next)
  }

  const capturePendingEditorHistory = () => {
    if (fileLoading) return
    if (editorTypingHistoryActiveRef.current) {
      touchEditorTypingHistoryGroup()
      return
    }
    editorTypingHistoryActiveRef.current = true
    pendingEditorHistoryRef.current = editorTextSnapshot()
    touchEditorTypingHistoryGroup()
  }

  const updateEditorLineEnding = (nextLineEnding: Exclude<EditorLineEnding, 'Mixed'>) => {
    applyEditorTextChange(convertEditorLineEnding(flushActiveEditorDraftText(), nextLineEnding))
  }

  const updateEditorIndent = (nextValue: string) => {
    if (nextValue === 'mixed' || nextValue === 'none') return
    const nextIndent = nextValue === 'tabs'
      ? { target: 'tabs' as const, size: editorIndent.size || 2 }
      : { target: 'spaces' as const, size: Number(nextValue.replace('spaces-', '')) || editorIndent.size || 2 }

    applyEditorTextChange(convertEditorIndent(flushActiveEditorDraftText(), nextIndent.target, nextIndent.size))
  }

  const updateEditorCssColor = (request: CssColorEditDraft) => {
    const snapshot = editorTextSnapshot()
    const current = snapshot.text
    const lines = current.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
    const relativeLineNumber = chunkedTextActive
      ? request.lineNumber - activeEditorLineBase + 1
      : request.lineNumber
    const lineIndex = relativeLineNumber - 1
    const line = lines[lineIndex]
    if (line === undefined) return

    const directMatch = line.slice(request.columnStart, request.columnStart + request.oldValue.length) === request.oldValue
    const columnStart = directMatch ? request.columnStart : line.indexOf(request.oldValue)
    if (columnStart < 0) return

    const nextLine = `${line.slice(0, columnStart)}${request.newValue}${line.slice(columnStart + request.oldValue.length)}`
    const nextText = updateLineInText(current, relativeLineNumber, nextLine)
    applyEditorTextChange(nextText)
  }

  return {
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
  }
}
