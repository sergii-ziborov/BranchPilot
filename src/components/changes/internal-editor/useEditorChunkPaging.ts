import type {
  Dispatch,
  MutableRefObject,
  RefObject,
  SetStateAction,
  UIEvent as ReactUIEvent
} from 'react'
import type { BranchPilotApi } from '../../../shared/branchPilot'
import { friendlyIpcErrorMessage } from '../../../lib/ipcErrorMessage'
import type { ChunkedTextPreview } from './editorTypes'
import { EDITOR_FILE_CHUNK_BYTES } from './editorViewConstants'
import {
  chunkedTextPreviewFromResult,
  lineBreakCount,
  type EditorViewMode
} from './editorViewHelpers'

interface UseEditorChunkPagingParams {
  api: BranchPilotApi | undefined
  currentRepoPath: string | undefined
  selectedPath: string
  chunkedTextPreview: ChunkedTextPreview | null
  textDirty: boolean
  chunkPageRequestRef: MutableRefObject<boolean>
  suppressAutoChunkUntilRef: MutableRefObject<number>
  lastEditorScrollTopRef: MutableRefObject<number>
  textareaRef: RefObject<HTMLTextAreaElement | null>
  setChunkedTextPreview: Dispatch<SetStateAction<ChunkedTextPreview | null>>
  setFileLoading: Dispatch<SetStateAction<boolean>>
  setTextUnavailableMessage: Dispatch<SetStateAction<string | null>>
  setViewMode: Dispatch<SetStateAction<EditorViewMode>>
  setOriginalText: Dispatch<SetStateAction<string>>
  setDraftText: Dispatch<SetStateAction<string>>
  setEditorScrollTop: Dispatch<SetStateAction<number>>
  measureEditorLineHeight: (textarea?: HTMLTextAreaElement | null) => number
  syncEditorOverlays: (scrollLeft: number, scrollTop: number, viewportHeight?: number) => void
  updateEditorLineWindowState: (scrollTop: number, viewportHeight: number) => void
  setNotice: (message: string) => void
}

export function useEditorChunkPaging({
  api,
  currentRepoPath,
  selectedPath,
  chunkedTextPreview,
  textDirty,
  chunkPageRequestRef,
  suppressAutoChunkUntilRef,
  lastEditorScrollTopRef,
  textareaRef,
  setChunkedTextPreview,
  setFileLoading,
  setTextUnavailableMessage,
  setViewMode,
  setOriginalText,
  setDraftText,
  setEditorScrollTop,
  measureEditorLineHeight,
  syncEditorOverlays,
  updateEditorLineWindowState,
  setNotice
}: UseEditorChunkPagingParams) {
  const loadChunkedTextPage = async (direction: 'next' | 'previous', scrollPlacement: 'start' | 'end' = 'start') => {
    const current = chunkedTextPreview
    if (!api || !currentRepoPath || !selectedPath || !current || current.loading || chunkPageRequestRef.current) return
    if (textDirty) {
      setNotice('Save or undo current chunk edits before loading another chunk.')
      return
    }

    const markers = [...current.markers]
    let targetIndex = direction === 'previous' ? current.pageIndex - 1 : current.pageIndex + 1

    if (direction === 'previous' && targetIndex < 0) return
    if (direction === 'next' && targetIndex >= markers.length) {
      if (!current.hasMore) return
      markers.push({
        offset: current.endOffset,
        lineNumber: current.startLine + lineBreakCount(current.text)
      })
      targetIndex = markers.length - 1
    }

    const marker = markers[targetIndex]
    if (!marker) {
      return
    }

    chunkPageRequestRef.current = true
    setChunkedTextPreview({ ...current, loading: true, error: null })
    setFileLoading(true)
    try {
      const result = await api.getRepositoryFileChunk({
        repoPath: currentRepoPath,
        filePath: selectedPath,
        offset: marker.offset,
        maxBytes: EDITOR_FILE_CHUNK_BYTES
      })
      if (!result.ok) {
        const message = friendlyIpcErrorMessage(result.error.message, 'Failed to load file chunk.')
        setChunkedTextPreview((latest) => latest ? { ...latest, loading: false, error: message } : latest)
        setNotice(message)
        return
      }
      if (result.data.binary) {
        const message = 'Binary file - Hex editor available.'
        setChunkedTextPreview(null)
        setTextUnavailableMessage(message)
        setViewMode('hex')
        setNotice(message)
        return
      }

      setChunkedTextPreview(chunkedTextPreviewFromResult(result.data, {
        startLine: marker.lineNumber,
        markers,
        pageIndex: targetIndex
      }))
      setOriginalText(result.data.text)
      setDraftText(result.data.text)
      suppressAutoChunkUntilRef.current = window.performance.now() + 250
      window.requestAnimationFrame(() => {
        const textarea = textareaRef.current
        if (!textarea) return
        const lineHeight = measureEditorLineHeight(textarea)
        const nextScrollTop = scrollPlacement === 'end'
          ? Math.max(0, textarea.scrollHeight - textarea.clientHeight - lineHeight * 2)
          : 0
        textarea.scrollTop = nextScrollTop
        textarea.scrollLeft = 0
        lastEditorScrollTopRef.current = nextScrollTop
        setEditorScrollTop(nextScrollTop)
        syncEditorOverlays(0, nextScrollTop, textarea.clientHeight)
      })
    } catch (error) {
      const message = friendlyIpcErrorMessage(error instanceof Error ? error.message : '', 'Failed to load file chunk.')
      setChunkedTextPreview((latest) => latest ? { ...latest, loading: false, error: message } : latest)
      setNotice(message)
    } finally {
      chunkPageRequestRef.current = false
      setFileLoading(false)
    }
  }

  const syncHighlightScroll = (event: ReactUIEvent<HTMLTextAreaElement>) => {
    const nextScrollTop = event.currentTarget.scrollTop
    const scrollingDown = nextScrollTop > lastEditorScrollTopRef.current
    const scrollingUp = nextScrollTop < lastEditorScrollTopRef.current
    lastEditorScrollTopRef.current = nextScrollTop

    updateEditorLineWindowState(nextScrollTop, event.currentTarget.clientHeight)
    syncEditorOverlays(event.currentTarget.scrollLeft, nextScrollTop, event.currentTarget.clientHeight)
    const remainingScroll = event.currentTarget.scrollHeight - nextScrollTop - event.currentTarget.clientHeight
    const canAutoLoadChunk = Boolean(
      chunkedTextPreview &&
      !chunkedTextPreview.loading &&
      window.performance.now() >= suppressAutoChunkUntilRef.current
    )

    if (canAutoLoadChunk && scrollingDown && chunkedTextPreview?.hasMore && remainingScroll < 64) {
      void loadChunkedTextPage('next')
      return
    }

    if (canAutoLoadChunk && scrollingUp && chunkedTextPreview && chunkedTextPreview.pageIndex > 0 && nextScrollTop < 64) {
      void loadChunkedTextPage('previous', 'end')
    }
  }

  return { loadChunkedTextPage, syncHighlightScroll }
}
