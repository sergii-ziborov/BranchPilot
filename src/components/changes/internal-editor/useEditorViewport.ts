import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type PointerEvent as ReactPointerEvent,
  type SetStateAction
} from 'react'
import { clamp } from './editorPrimitives'
import type { EditorSelectionStatus, FileLineSearchTarget } from './editorStateTypes'
import type { LiveLineChange } from './editorTypes'
import {
  EDITOR_LINE_HEIGHT,
  EDITOR_LINE_HEIGHT_EPSILON,
  EDITOR_SELECTION_STATUS_DEBOUNCE_MS
} from './editorViewConstants'
import {
  editorLineWindowForScroll,
  editorSelectionStatusFromOffsets,
  textareaVisualLineCount,
  type EditorViewMode,
  type FileSearchMatch
} from './editorViewHelpers'

interface UseEditorViewportParams {
  textareaRef: { current: HTMLTextAreaElement | null }
  highlightInnerRef: { current: HTMLDivElement | null }
  lineNumbersInnerRef: { current: HTMLDivElement | null }
  colorSwatchesInnerRef: { current: HTMLDivElement | null }
  overviewViewportRef: { current: HTMLDivElement | null }
  lastEditorScrollTopRef: { current: number }
  draftLines: string[]
  lineOffsets: number[]
  activeEditorLineBase: number
  chunkedTextActive: boolean
  fileLineSearchTarget: FileLineSearchTarget | null
  setViewMode: Dispatch<SetStateAction<EditorViewMode>>
  setNotice: (message: string) => void
}

export function useEditorViewport({
  textareaRef,
  highlightInnerRef,
  lineNumbersInnerRef,
  colorSwatchesInnerRef,
  overviewViewportRef,
  lastEditorScrollTopRef,
  draftLines,
  lineOffsets,
  activeEditorLineBase,
  chunkedTextActive,
  fileLineSearchTarget,
  setViewMode,
  setNotice
}: UseEditorViewportParams) {
  const editorSelectionStatusTimerRef = useRef<number | null>(null)
  const editorLineHeightRef = useRef(EDITOR_LINE_HEIGHT)
  const editorVisualLineCountRef = useRef<{ text: string; count: number }>({ text: '', count: 1 })
  const [editorScrollTop, setEditorScrollTop] = useState(0)
  const [editorViewportHeight, setEditorViewportHeight] = useState(0)
  const [editorLineHeight, setEditorLineHeight] = useState(EDITOR_LINE_HEIGHT)
  const [editorSelection, setEditorSelectionState] = useState<EditorSelectionStatus>({
    lineNumber: 1,
    column: 1,
    selectedChars: 0,
    selectedLines: 0
  })
  const editorOverviewViewport = useMemo(() => {
    const totalLines = Math.max(1, draftLines.length)
    const contentHeight = Math.max(editorLineHeight, totalLines * editorLineHeight)
    const viewportHeight = clamp(editorViewportHeight || editorLineHeight, editorLineHeight, contentHeight)
    const height = clamp((viewportHeight / contentHeight) * 100, 3, 100)
    const maxScrollTop = Math.max(1, contentHeight - viewportHeight)
    const maxOverviewTop = Math.max(0, 100 - height)
    const top = clamp((editorScrollTop / maxScrollTop) * maxOverviewTop, 0, maxOverviewTop)

    return { top, height }
  }, [draftLines.length, editorLineHeight, editorScrollTop, editorViewportHeight])
  const editorLineWindow = useMemo(
    () => editorLineWindowForScroll(draftLines.length, editorScrollTop, editorViewportHeight, editorLineHeight),
    [draftLines.length, editorLineHeight, editorScrollTop, editorViewportHeight]
  )
  const visibleDraftLines = useMemo(
    () => draftLines.slice(editorLineWindow.start, editorLineWindow.end),
    [draftLines, editorLineWindow.end, editorLineWindow.start]
  )

  useEffect(() => () => {
    if (editorSelectionStatusTimerRef.current !== null) {
      window.clearTimeout(editorSelectionStatusTimerRef.current)
      editorSelectionStatusTimerRef.current = null
    }
  }, [])

  const measureEditorLineHeight = (textarea = textareaRef.current): number => {
    if (!textarea) return editorLineHeightRef.current

    const computed = window.getComputedStyle(textarea)
    const parsedLineHeight = Number.parseFloat(computed.lineHeight)
    const parsedFontSize = Number.parseFloat(computed.fontSize)
    const cssLineHeight = Number.isFinite(parsedLineHeight) && parsedLineHeight > 4
      ? parsedLineHeight
      : Number.isFinite(parsedFontSize) && parsedFontSize > 4
        ? parsedFontSize * (EDITOR_LINE_HEIGHT / 12)
        : EDITOR_LINE_HEIGHT
    const paddingTop = Number.parseFloat(computed.paddingTop)
    const paddingBottom = Number.parseFloat(computed.paddingBottom)
    const verticalPadding = (Number.isFinite(paddingTop) ? paddingTop : 0) + (Number.isFinite(paddingBottom) ? paddingBottom : 0)
    let visualLineCount = editorVisualLineCountRef.current.count
    if (editorVisualLineCountRef.current.text !== textarea.value) {
      visualLineCount = textareaVisualLineCount(textarea.value)
      editorVisualLineCountRef.current = { text: textarea.value, count: visualLineCount }
    }
    const measuredLineHeight = visualLineCount > 8
      ? (textarea.scrollHeight - verticalPadding) / visualLineCount
      : 0
    const nextLineHeight = Number.isFinite(measuredLineHeight) &&
      measuredLineHeight > cssLineHeight * 0.75 &&
      measuredLineHeight < cssLineHeight * 1.35
      ? measuredLineHeight
      : cssLineHeight

    if (Math.abs(nextLineHeight - editorLineHeightRef.current) > EDITOR_LINE_HEIGHT_EPSILON) {
      editorLineHeightRef.current = nextLineHeight
      setEditorLineHeight(nextLineHeight)
    }

    return nextLineHeight
  }

  const syncEditorOverlays = (scrollLeft: number, scrollTop: number, viewportHeight = editorViewportHeight) => {
    const lineHeight = measureEditorLineHeight()
    const lineWindow = editorLineWindowForScroll(draftLines.length, scrollTop, viewportHeight, lineHeight)
    const translateY = lineWindow.offsetTop - scrollTop
    const totalLines = Math.max(1, draftLines.length)
    const contentHeight = Math.max(lineHeight, totalLines * lineHeight)
    const safeViewportHeight = clamp(viewportHeight || lineHeight, lineHeight, contentHeight)
    const overviewHeight = clamp((safeViewportHeight / contentHeight) * 100, 3, 100)
    const maxScrollTop = Math.max(1, contentHeight - safeViewportHeight)
    const maxOverviewTop = Math.max(0, 100 - overviewHeight)
    const overviewTop = clamp((scrollTop / maxScrollTop) * maxOverviewTop, 0, maxOverviewTop)

    if (highlightInnerRef.current) {
      highlightInnerRef.current.style.transform = `translate(${-scrollLeft}px, ${translateY}px)`
    }
    if (lineNumbersInnerRef.current) {
      lineNumbersInnerRef.current.style.transform = `translateY(${translateY}px)`
    }
    if (colorSwatchesInnerRef.current) {
      colorSwatchesInnerRef.current.style.transform = `translate(${-scrollLeft}px, ${translateY}px)`
    }
    if (overviewViewportRef.current) {
      overviewViewportRef.current.style.top = `${overviewTop}%`
      overviewViewportRef.current.style.height = `${overviewHeight}%`
    }
  }

  const updateEditorLineWindowState = (scrollTop: number, viewportHeight: number) => {
    const lineHeight = measureEditorLineHeight()
    const nextLineWindow = editorLineWindowForScroll(draftLines.length, scrollTop, viewportHeight, lineHeight)
    const viewportChanged = Math.abs(viewportHeight - editorViewportHeight) > 1
    if (
      viewportChanged ||
      nextLineWindow.start !== editorLineWindow.start ||
      nextLineWindow.end !== editorLineWindow.end
    ) {
      setEditorScrollTop(scrollTop)
      setEditorViewportHeight(viewportHeight)
    }
  }

  const updateEditorSelectionStatus = (textarea = textareaRef.current, immediate = false) => {
    if (!textarea) return
    const nextStatus = editorSelectionStatusFromOffsets(
      textarea.value,
      textarea.selectionStart,
      textarea.selectionEnd,
      activeEditorLineBase
    )

    if (editorSelectionStatusTimerRef.current !== null) {
      window.clearTimeout(editorSelectionStatusTimerRef.current)
      editorSelectionStatusTimerRef.current = null
    }

    if (immediate) {
      setEditorSelectionState(nextStatus)
      return
    }

    editorSelectionStatusTimerRef.current = window.setTimeout(() => {
      editorSelectionStatusTimerRef.current = null
      setEditorSelectionState(nextStatus)
    }, EDITOR_SELECTION_STATUS_DEBOUNCE_MS)
  }

  const focusEditorPosition = (lineNumber: number, column = 0, length = 0) => {
    const textarea = textareaRef.current
    if (!textarea) return

    const firstLineNumber = activeEditorLineBase
    const lastLineNumber = activeEditorLineBase + Math.max(0, draftLines.length - 1)
    const safeLineNumber = Math.max(firstLineNumber, Math.min(lineNumber, Math.max(firstLineNumber, lastLineNumber)))
    const relativeLineIndex = Math.max(0, safeLineNumber - activeEditorLineBase)
    const safeColumn = Math.max(0, column)
    const offset = (lineOffsets[relativeLineIndex] ?? 0) + safeColumn

    window.requestAnimationFrame(() => {
      textarea.focus()
      textarea.setSelectionRange(offset, offset + Math.max(0, length))
      updateEditorSelectionStatus(textarea, true)
      const lineHeight = measureEditorLineHeight(textarea)
      const top = Math.max(0, relativeLineIndex * lineHeight - textarea.clientHeight * 0.32)
      updateEditorLineWindowState(top, textarea.clientHeight)
      textarea.scrollTop = top
      syncEditorOverlays(textarea.scrollLeft, textarea.scrollTop, textarea.clientHeight)
    })
  }

  const scrollEditorToLine = (lineNumber: number) => {
    const textarea = textareaRef.current
    if (!textarea) return

    const firstLineNumber = activeEditorLineBase
    const lastLineNumber = activeEditorLineBase + Math.max(0, draftLines.length - 1)
    const safeLineNumber = Math.max(firstLineNumber, Math.min(lineNumber, Math.max(firstLineNumber, lastLineNumber)))
    const relativeLineIndex = Math.max(0, safeLineNumber - activeEditorLineBase)
    const lineHeight = measureEditorLineHeight(textarea)
    const nextScrollTop = Math.max(0, relativeLineIndex * lineHeight - textarea.clientHeight * 0.5)

    textarea.scrollTop = nextScrollTop
    lastEditorScrollTopRef.current = nextScrollTop
    updateEditorLineWindowState(nextScrollTop, textarea.clientHeight)
    syncEditorOverlays(textarea.scrollLeft, nextScrollTop, textarea.clientHeight)
  }

  const scrollEditorOverviewAt = (clientY: number, element: HTMLDivElement) => {
    const rect = element.getBoundingClientRect()
    const ratio = clamp((clientY - rect.top) / Math.max(1, rect.height), 0, 1)
    const lineNumber = activeEditorLineBase + Math.round(ratio * Math.max(0, draftLines.length - 1))
    scrollEditorToLine(lineNumber)
  }

  const beginEditorOverviewDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    if (event.target instanceof Element && event.target.closest('.changes-editor-overview-marker')) return

    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    scrollEditorOverviewAt(event.clientY, event.currentTarget)
  }

  const dragEditorOverview = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
    event.preventDefault()
    scrollEditorOverviewAt(event.clientY, event.currentTarget)
  }

  const endEditorOverviewDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  const focusSearchMatch = (match: FileSearchMatch) => {
    focusEditorPosition(match.lineNumber, match.column, match.length)
  }

  const focusLiveChange = (change: LiveLineChange) => {
    const firstLineNumber = activeEditorLineBase
    const lastLineNumber = activeEditorLineBase + Math.max(0, draftLines.length - 1)
    if (chunkedTextActive && (change.lineNumber < firstLineNumber || change.lineNumber > lastLineNumber)) {
      setNotice(`Line ${change.lineNumber} is outside the loaded chunk (${firstLineNumber}-${lastLineNumber}).`)
      return
    }

    focusCodePosition(change.lineNumber, 0, Math.max(1, Math.min(80, (change.after || change.before).length)))
  }

  const focusCodePosition = (lineNumber: number, column = 0, length = 0) => {
    setViewMode('code')
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => focusEditorPosition(lineNumber, column, length))
    })
  }

  const focusFileLineSearchTarget = () => {
    if (!fileLineSearchTarget) return false
    const firstLineNumber = activeEditorLineBase
    const lastLineNumber = activeEditorLineBase + Math.max(0, draftLines.length - 1)
    if (chunkedTextActive && (fileLineSearchTarget.lineNumber < firstLineNumber || fileLineSearchTarget.lineNumber > lastLineNumber)) {
      setNotice(`Line ${fileLineSearchTarget.lineNumber} is outside the loaded chunk (${firstLineNumber}-${lastLineNumber}).`)
      return true
    }

    focusCodePosition(fileLineSearchTarget.lineNumber, fileLineSearchTarget.column, 1)
    return true
  }

  return {
    editorVisualLineCountRef,
    setEditorScrollTop,
    setEditorViewportHeight,
    editorSelection,
    setEditorSelectionState,
    editorOverviewViewport,
    editorLineWindow,
    visibleDraftLines,
    measureEditorLineHeight,
    syncEditorOverlays,
    updateEditorLineWindowState,
    updateEditorSelectionStatus,
    focusEditorPosition,
    focusCodePosition,
    focusSearchMatch,
    focusLiveChange,
    focusFileLineSearchTarget,
    beginEditorOverviewDrag,
    dragEditorOverview,
    endEditorOverviewDrag
  }
}
