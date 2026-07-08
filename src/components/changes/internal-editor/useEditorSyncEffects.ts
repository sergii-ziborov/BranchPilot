import { useEffect, type Dispatch, type RefObject, type SetStateAction } from 'react'
import { clamp } from './editorPrimitives'
import { byteToHex } from './hexUtils'

interface UseEditorSyncEffectsParams {
  fileSearchQuery: string
  selectedPath: string
  setActiveSearchIndex: Dispatch<SetStateAction<number>>
  activeSearchIndex: number
  fileSearchMatches: readonly unknown[]
  activeHexSearchIndex: number
  hexSearchMatches: readonly unknown[]
  setActiveHexSearchIndex: Dispatch<SetStateAction<number>>
  parsedHexDraft: { bytes: Uint8Array | null }
  activeHexByteIndex: number
  hexStartOffset: number
  hexEndOffset: number
  setActiveHexByteIndex: Dispatch<SetStateAction<number>>
  setHexByteDraft: Dispatch<SetStateAction<string>>
  fileLoading: boolean
  fileError: string | null
  textareaRef: RefObject<HTMLTextAreaElement | null>
  setEditorViewportHeight: (height: number) => void
  setEditorScrollTop: (top: number) => void
  syncEditorOverlays: (scrollLeft: number, scrollTop: number, clientHeight?: number) => void
  draftLines: readonly string[]
  viewMode: string
}

export function useEditorSyncEffects({
  fileSearchQuery,
  selectedPath,
  setActiveSearchIndex,
  activeSearchIndex,
  fileSearchMatches,
  activeHexSearchIndex,
  hexSearchMatches,
  setActiveHexSearchIndex,
  parsedHexDraft,
  activeHexByteIndex,
  hexStartOffset,
  hexEndOffset,
  setActiveHexByteIndex,
  setHexByteDraft,
  fileLoading,
  fileError,
  textareaRef,
  setEditorViewportHeight,
  setEditorScrollTop,
  syncEditorOverlays,
  draftLines,
  viewMode
}: UseEditorSyncEffectsParams) {
  useEffect(() => {
    setActiveSearchIndex(-1)
  }, [fileSearchQuery, selectedPath])

  useEffect(() => {
    if (activeSearchIndex >= fileSearchMatches.length && fileSearchMatches.length > 0) {
      setActiveSearchIndex(Math.max(0, fileSearchMatches.length - 1))
    }
  }, [activeSearchIndex, fileSearchMatches.length])

  useEffect(() => {
    if (activeHexSearchIndex >= hexSearchMatches.length && hexSearchMatches.length > 0) {
      setActiveHexSearchIndex(Math.max(0, hexSearchMatches.length - 1))
    }
  }, [activeHexSearchIndex, hexSearchMatches.length])

  useEffect(() => {
    const bytes = parsedHexDraft.bytes
    if (!bytes || bytes.length === 0) {
      if (activeHexByteIndex !== hexStartOffset) setActiveHexByteIndex(hexStartOffset)
      setHexByteDraft((current) => current ? '' : current)
      return
    }

    const nextIndex = clamp(activeHexByteIndex, hexStartOffset, Math.max(hexStartOffset, hexEndOffset - 1))
    if (nextIndex !== activeHexByteIndex) {
      setActiveHexByteIndex(nextIndex)
      return
    }

    const nextDraft = byteToHex(bytes[nextIndex - hexStartOffset])
    setHexByteDraft((current) => current === nextDraft ? current : nextDraft)
  }, [activeHexByteIndex, hexEndOffset, hexStartOffset, parsedHexDraft.bytes])

  useEffect(() => {
    if (fileLoading || fileError) return

    const frame = window.requestAnimationFrame(() => {
      const textarea = textareaRef.current
      if (!textarea) return

      setEditorViewportHeight(textarea.clientHeight)
      setEditorScrollTop(textarea.scrollTop)
      syncEditorOverlays(textarea.scrollLeft, textarea.scrollTop, textarea.clientHeight)
    })

    return () => {
      window.cancelAnimationFrame(frame)
    }
  }, [draftLines.length, fileError, fileLoading, selectedPath, viewMode])
}
