import {
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type UIEvent as ReactUIEvent
} from 'react'
import type { BranchPilotApi } from '../../../shared/branchPilot'
import { friendlyIpcErrorMessage } from '../../../lib/ipcErrorMessage'
import { clamp } from './editorPrimitives'
import {
  HEX_BYTES_PER_ROW,
  HEX_CHUNK_BYTES,
  alignHexOffset,
  asciiFromByte,
  byteToHex,
  bytesFromBase64,
  bytesToHexText,
  findHexSearchMatches,
  hexEditorRows,
  normalizeHexByteDraft,
  offsetToHex,
  parseHexOffsetDraft,
  parseHexText,
  type HexBytePreview
} from './hexUtils'

interface UseHexEditorOptions {
  api: BranchPilotApi | undefined
  currentRepoPath: string | undefined
  selectedPath: string
  setNotice: (message: string) => void
}

export function useHexEditor({ api, currentRepoPath, selectedPath, setNotice }: UseHexEditorOptions) {
  const hexTableBodyRef = useRef<HTMLDivElement | null>(null)
  const hexChunkRequestRef = useRef(0)
  const lastHexScrollTopRef = useRef(0)
  const suppressAutoHexChunkUntilRef = useRef(0)
  const pendingHexOffsetRef = useRef<number | null>(null)
  const [hexBytes, setHexBytes] = useState<HexBytePreview | null>(null)
  const [hexLoading, setHexLoading] = useState(false)
  const [hexError, setHexError] = useState<string | null>(null)
  const [hexOriginalText, setHexOriginalText] = useState('')
  const [hexDraftText, setHexDraftText] = useState('')
  const [activeHexByteIndex, setActiveHexByteIndex] = useState(0)
  const [hexByteDraft, setHexByteDraft] = useState('')
  const [hexOffsetDraft, setHexOffsetDraft] = useState('')
  const [hexSearchQuery, setHexSearchQuery] = useState('')
  const [activeHexSearchIndex, setActiveHexSearchIndex] = useState(-1)
  const parsedHexDraft = useMemo(() => parseHexText(hexDraftText), [hexDraftText])
  const parsedHexOriginal = useMemo(() => parseHexText(hexOriginalText), [hexOriginalText])
  const hexStartOffset = hexBytes?.startOffset ?? 0
  const hexEndOffset = hexBytes?.endOffset ?? hexStartOffset
  const hexFullFileLoaded = Boolean(hexBytes?.fullFileLoaded)
  const hexChunkEditable = Boolean(hexBytes)
  const hexPreviewRows = useMemo(
    () => (parsedHexDraft.bytes ? hexEditorRows(parsedHexDraft.bytes, hexStartOffset) : []),
    [hexStartOffset, parsedHexDraft.bytes]
  )
  const activeHexLocalIndex = activeHexByteIndex - hexStartOffset
  const activeHexByte = activeHexLocalIndex >= 0 ? parsedHexDraft.bytes?.[activeHexLocalIndex] ?? null : null
  const activeHexAscii = activeHexByte === null ? '' : asciiFromByte(activeHexByte)
  const activeHexRowOffset = Math.floor(activeHexByteIndex / HEX_BYTES_PER_ROW) * HEX_BYTES_PER_ROW
  const hexSearchMatches = useMemo(
    () => findHexSearchMatches(parsedHexDraft.bytes, hexSearchQuery, hexStartOffset),
    [hexSearchQuery, hexStartOffset, parsedHexDraft.bytes]
  )
  const normalizedActiveHexByteDraft = normalizeHexByteDraft(hexByteDraft)
  const activeHexByteDraftValue = normalizedActiveHexByteDraft
    ? Number.parseInt(normalizedActiveHexByteDraft.padStart(2, '0'), 16)
    : null
  const activeHexByteDraftDirty = hexChunkEditable && activeHexByte !== null && activeHexByteDraftValue !== null && activeHexByteDraftValue !== activeHexByte
  const hexDirty = hexChunkEditable && (hexDraftText !== hexOriginalText || activeHexByteDraftDirty)

  const scrollHexTable = (placement: 'start' | 'end') => {
    window.requestAnimationFrame(() => {
      const body = hexTableBodyRef.current
      if (!body) return
      const nextScrollTop = placement === 'end'
        ? Math.max(0, body.scrollHeight - body.clientHeight)
        : 0
      body.scrollTop = nextScrollTop
      lastHexScrollTopRef.current = nextScrollTop
    })
  }

  const loadHexChunk = async (
    requestedOffset: number,
    selectOffset = requestedOffset,
    options: { scrollPlacement?: 'start' | 'end' } = {}
  ) => {
    if (!api || !currentRepoPath || !selectedPath) return
    if (hexDirty && hexBytes) {
      setNotice('Save or undo current hex chunk edits before loading another chunk.')
      return
    }

    const knownMaxOffset = hexBytes ? Math.max(0, hexBytes.byteSize - 1) : Number.POSITIVE_INFINITY
    const safeOffset = Number.isFinite(requestedOffset)
      ? alignHexOffset(clamp(Math.floor(requestedOffset), 0, knownMaxOffset))
      : 0
    const requestId = hexChunkRequestRef.current + 1
    hexChunkRequestRef.current = requestId
    setHexLoading(true)
    setHexError(null)

    try {
      const result = await api.getRepositoryFileChunk({
        repoPath: currentRepoPath,
        filePath: selectedPath,
        offset: safeOffset,
        maxBytes: HEX_CHUNK_BYTES,
        mode: 'bytes'
      })
      if (hexChunkRequestRef.current !== requestId) return
      setHexLoading(false)
      if (!result.ok) {
        setHexBytes(null)
        setHexOriginalText('')
        setHexDraftText('')
        setHexError(friendlyIpcErrorMessage(result.error.message, 'Failed to load hex bytes.'))
        return
      }

      const bytes = bytesFromBase64(result.data.base64 ?? '')
      const hexText = bytesToHexText(bytes)
      const nextStart = result.data.startOffset
      const nextEnd = result.data.endOffset
      const fullFileLoaded = nextStart === 0 && nextEnd >= result.data.byteSize
      const selectedOffset = bytes.length > 0
        ? clamp(selectOffset, nextStart, Math.max(nextStart, nextEnd - 1))
        : nextStart

      setHexBytes({
        filePath: result.data.filePath,
        byteSize: result.data.byteSize,
        startOffset: nextStart,
        endOffset: nextEnd,
        hasMore: result.data.hasMore,
        fullFileLoaded
      })
      setHexOriginalText(hexText)
      setHexDraftText(hexText)
      setActiveHexByteIndex(selectedOffset)
      setHexByteDraft(bytes.length > 0 ? byteToHex(bytes[selectedOffset - nextStart]) : '')
      setHexOffsetDraft(bytes.length > 0 ? offsetToHex(selectedOffset) : '')
      setActiveHexSearchIndex(-1)
      suppressAutoHexChunkUntilRef.current = window.performance.now() + 250
      if (options.scrollPlacement) scrollHexTable(options.scrollPlacement)
    } catch (error) {
      if (hexChunkRequestRef.current !== requestId) return
      setHexLoading(false)
      setHexBytes(null)
      setHexOriginalText('')
      setHexDraftText('')
      setHexError(friendlyIpcErrorMessage(error instanceof Error ? error.message : '', 'Failed to load hex bytes.'))
    }
  }

  const goToHexOffset = () => {
    const offset = parseHexOffsetDraft(hexOffsetDraft)
    if (offset === null) {
      setNotice('Offset must be decimal, hex, or 0x-prefixed hex.')
      return
    }

    const safeOffset = hexBytes ? clamp(offset, 0, Math.max(0, hexBytes.byteSize - 1)) : offset
    if (safeOffset >= hexStartOffset && safeOffset < hexEndOffset) {
      selectHexByte(safeOffset)
      return
    }

    void loadHexChunk(safeOffset, safeOffset, { scrollPlacement: 'start' })
  }

  const jumpHexChunk = (direction: 'previous' | 'next') => {
    if (!hexBytes) return
    const offset = direction === 'previous'
      ? Math.max(0, hexBytes.startOffset - HEX_CHUNK_BYTES)
      : hexBytes.endOffset
    const selectOffset = direction === 'previous'
      ? Math.max(0, hexBytes.startOffset - 1)
      : offset
    void loadHexChunk(offset, selectOffset, { scrollPlacement: direction === 'previous' ? 'end' : 'start' })
  }

  function selectHexByte(index: number) {
    const bytes = parsedHexDraft.bytes
    if (!bytes || bytes.length === 0) return

    const nextIndex = clamp(index, hexStartOffset, Math.max(hexStartOffset, hexEndOffset - 1))
    setActiveHexByteIndex(nextIndex)
    setHexByteDraft(byteToHex(bytes[nextIndex - hexStartOffset]))
    setHexOffsetDraft(offsetToHex(nextIndex))
  }

  const updateHexByteAt = (index: number, value: number) => {
    const bytes = parsedHexDraft.bytes
    if (!hexChunkEditable || !bytes) return
    const localIndex = index - hexStartOffset
    if (localIndex < 0 || localIndex >= bytes.length) return

    const nextBytes = new Uint8Array(bytes)
    nextBytes[localIndex] = value
    setHexDraftText(bytesToHexText(nextBytes))
  }

  const commitHexByteDraft = (index: number, rawDraft: string): boolean => {
    const normalized = normalizeHexByteDraft(rawDraft)
    const currentByte = parsedHexDraft.bytes?.[index - hexStartOffset]
    if (!hexChunkEditable || !normalized) {
      if (currentByte !== undefined) setHexByteDraft(byteToHex(currentByte))
      return false
    }

    const value = Number.parseInt(normalized.padStart(2, '0'), 16)
    updateHexByteAt(index, value)
    setHexByteDraft(byteToHex(value))
    return true
  }

  const updateHexByteDraft = (index: number, rawDraft: string) => {
    const normalized = normalizeHexByteDraft(rawDraft)
    setHexByteDraft(normalized)

    if (!hexChunkEditable || normalized.length !== 2) return

    const value = Number.parseInt(normalized, 16)
    updateHexByteAt(index, value)
    const bytes = parsedHexDraft.bytes
    if (!bytes) return

    if (hexChunkEditable && index < hexEndOffset - 1) {
      setActiveHexByteIndex(index + 1)
    } else {
      setHexByteDraft(byteToHex(value))
    }
  }

  const moveHexSelection = (event: ReactKeyboardEvent<HTMLInputElement>, fromIndex: number, toIndex: number) => {
    event.preventDefault()
    commitHexByteDraft(fromIndex, event.currentTarget.value)
    selectHexByte(toIndex)
  }

  const handleHexByteInputKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>, index: number) => {
    if (event.key === 'ArrowRight') {
      moveHexSelection(event, index, index + 1)
      return
    }
    if (event.key === 'ArrowLeft') {
      moveHexSelection(event, index, index - 1)
      return
    }
    if (event.key === 'ArrowDown') {
      moveHexSelection(event, index, index + HEX_BYTES_PER_ROW)
      return
    }
    if (event.key === 'ArrowUp') {
      moveHexSelection(event, index, index - HEX_BYTES_PER_ROW)
      return
    }
    if (event.key === 'Home') {
      moveHexSelection(event, index, Math.floor(index / HEX_BYTES_PER_ROW) * HEX_BYTES_PER_ROW)
      return
    }
    if (event.key === 'End') {
      moveHexSelection(event, index, Math.floor(index / HEX_BYTES_PER_ROW) * HEX_BYTES_PER_ROW + HEX_BYTES_PER_ROW - 1)
      return
    }
    if (event.key === 'PageDown') {
      moveHexSelection(event, index, index + HEX_BYTES_PER_ROW * 16)
      return
    }
    if (event.key === 'PageUp') {
      moveHexSelection(event, index, index - HEX_BYTES_PER_ROW * 16)
      return
    }
    if (event.key === 'Enter') {
      moveHexSelection(event, index, index + 1)
      return
    }
    if (event.key === 'Tab') {
      moveHexSelection(event, index, index + (event.shiftKey ? -1 : 1))
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      const byte = parsedHexDraft.bytes?.[index - hexStartOffset]
      if (byte !== undefined) {
        setHexByteDraft(byteToHex(byte))
        event.currentTarget.select()
      }
    }
  }

  const hexByteChanged = (index: number, byte: number): boolean => {
    const originalBytes = parsedHexOriginal.bytes
    if (!hexChunkEditable || !originalBytes) return false
    const localIndex = index - hexStartOffset
    return localIndex >= 0 && originalBytes[localIndex] !== byte
  }

  const hexDraftTextForSave = (): string => {
    if (!hexChunkEditable || !activeHexByteDraftDirty || activeHexByteDraftValue === null || !parsedHexDraft.bytes) return hexDraftText
    const localIndex = activeHexByteIndex - hexStartOffset
    if (localIndex < 0 || localIndex >= parsedHexDraft.bytes.length) return hexDraftText

    const nextBytes = new Uint8Array(parsedHexDraft.bytes)
    nextBytes[localIndex] = activeHexByteDraftValue
    return bytesToHexText(nextBytes)
  }

  const goToHexSearchMatch = (direction: 'previous' | 'next') => {
    if (hexSearchMatches.length === 0) return
    const nextIndex = direction === 'previous'
      ? (activeHexSearchIndex <= 0 ? hexSearchMatches.length - 1 : activeHexSearchIndex - 1)
      : (activeHexSearchIndex < 0 || activeHexSearchIndex >= hexSearchMatches.length - 1 ? 0 : activeHexSearchIndex + 1)
    setActiveHexSearchIndex(nextIndex)
    selectHexByte(hexSearchMatches[nextIndex].offset)
  }

  const syncHexScroll = (event: ReactUIEvent<HTMLDivElement>) => {
    const nextScrollTop = event.currentTarget.scrollTop
    const scrollingDown = nextScrollTop > lastHexScrollTopRef.current
    const scrollingUp = nextScrollTop < lastHexScrollTopRef.current
    lastHexScrollTopRef.current = nextScrollTop

    if (!hexBytes || hexLoading || window.performance.now() < suppressAutoHexChunkUntilRef.current) return

    const remainingScroll = event.currentTarget.scrollHeight - nextScrollTop - event.currentTarget.clientHeight
    if (scrollingDown && hexBytes.hasMore && remainingScroll < 72) {
      void loadHexChunk(hexBytes.endOffset, hexBytes.endOffset, { scrollPlacement: 'start' })
      return
    }

    if (scrollingUp && hexBytes.startOffset > 0 && nextScrollTop < 72) {
      const previousOffset = Math.max(0, hexBytes.startOffset - HEX_CHUNK_BYTES)
      const selectOffset = Math.max(0, hexBytes.startOffset - 1)
      void loadHexChunk(previousOffset, selectOffset, { scrollPlacement: 'end' })
    }
  }

  return {
    hexTableBodyRef,
    lastHexScrollTopRef,
    suppressAutoHexChunkUntilRef,
    pendingHexOffsetRef,
    hexBytes,
    setHexBytes,
    hexLoading,
    setHexLoading,
    hexError,
    setHexError,
    setHexOriginalText,
    setHexDraftText,
    activeHexByteIndex,
    setActiveHexByteIndex,
    hexByteDraft,
    setHexByteDraft,
    hexOffsetDraft,
    setHexOffsetDraft,
    hexSearchQuery,
    setHexSearchQuery,
    activeHexSearchIndex,
    setActiveHexSearchIndex,
    parsedHexDraft,
    hexStartOffset,
    hexEndOffset,
    hexFullFileLoaded,
    hexChunkEditable,
    hexPreviewRows,
    activeHexByte,
    activeHexAscii,
    activeHexRowOffset,
    hexSearchMatches,
    hexDirty,
    loadHexChunk,
    goToHexOffset,
    jumpHexChunk,
    selectHexByte,
    updateHexByteDraft,
    commitHexByteDraft,
    handleHexByteInputKeyDown,
    hexByteChanged,
    hexDraftTextForSave,
    goToHexSearchMatch,
    syncHexScroll
  }
}
