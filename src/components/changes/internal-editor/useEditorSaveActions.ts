import { useState, type Dispatch, type SetStateAction } from 'react'
import type { ApiResult, AssistantId, BranchPilotApi, RepositorySnapshot } from '../../../shared/branchPilot'
import { friendlyIpcErrorMessage } from '../../../lib/ipcErrorMessage'
import { clamp } from './editorPrimitives'
import type { ChunkedTextPreview } from './editorTypes'
import {
  base64FromBytes,
  bytesToHexText,
  parseHexText,
  type HexBytePreview
} from './hexUtils'
import {
  beautifyPreservesTokens,
  beautifyTextLocally,
  normalizeTextForEditor
} from './editorBeautify'
import { utf8ByteOffset } from './editorLintHelpers'
import type { EditorViewMode } from './editorViewHelpers'

interface UseEditorSaveActionsParams {
  api: BranchPilotApi | undefined
  currentRepoPath: string | undefined
  selectedPath: string
  selectedAssistant: AssistantId
  viewMode: EditorViewMode
  fileLoading: boolean
  fileError: string | null
  textUnavailableMessage: string | null
  textSaveBlocked: boolean
  chunkedTextActive: boolean
  chunkedTextPreview: ChunkedTextPreview | null
  setChunkedTextPreview: Dispatch<SetStateAction<ChunkedTextPreview | null>>
  originalText: string
  setOriginalText: Dispatch<SetStateAction<string>>
  setDraftText: Dispatch<SetStateAction<string>>
  hexDirty: boolean
  hexBytes: HexBytePreview | null
  setHexBytes: Dispatch<SetStateAction<HexBytePreview | null>>
  hexStartOffset: number
  hexEndOffset: number
  hexFullFileLoaded: boolean
  setHexOriginalText: Dispatch<SetStateAction<string>>
  setHexDraftText: Dispatch<SetStateAction<string>>
  setActiveHexByteIndex: Dispatch<SetStateAction<number>>
  hexDraftTextForSave: () => string
  flushActiveEditorDraftText: () => string
  applyEditorTextChange: (
    nextText: string,
    options?: {
      selectionStart?: number
      selectionEnd?: number
      viewMode?: EditorViewMode
      resetJsonCollapse?: boolean
    }
  ) => boolean
  runSnapshotAction: (label: string, action: () => Promise<ApiResult<RepositorySnapshot>>) => boolean | void | Promise<boolean>
  setNotice: (message: string) => void
}

export function useEditorSaveActions({
  api,
  currentRepoPath,
  selectedPath,
  selectedAssistant,
  viewMode,
  fileLoading,
  fileError,
  textUnavailableMessage,
  textSaveBlocked,
  chunkedTextActive,
  chunkedTextPreview,
  setChunkedTextPreview,
  originalText,
  setOriginalText,
  setDraftText,
  hexDirty,
  hexBytes,
  setHexBytes,
  hexStartOffset,
  hexEndOffset,
  hexFullFileLoaded,
  setHexOriginalText,
  setHexDraftText,
  setActiveHexByteIndex,
  hexDraftTextForSave,
  flushActiveEditorDraftText,
  applyEditorTextChange,
  runSnapshotAction,
  setNotice
}: UseEditorSaveActionsParams) {
  const [beautifying, setBeautifying] = useState(false)
  const [aiBeautifying, setAiBeautifying] = useState(false)
  const [saving, setSaving] = useState(false)

  const saveFile = async () => {
    if (!api || !currentRepoPath || !selectedPath || textSaveBlocked || fileError) return
    const currentText = flushActiveEditorDraftText()
    const textDraftDirty = currentText !== originalText
    if (!textDraftDirty && !hexDirty) return

    setSaving(true)
    try {
      if (hexDirty) {
        const parsed = parseHexText(hexDraftTextForSave())
        if (!parsed.bytes || parsed.error) {
          setNotice(parsed.error || 'Hex byte stream is invalid.')
          return
        }
        const bytes = parsed.bytes
        const nextHexText = bytesToHexText(bytes)

        if (hexFullFileLoaded) {
          const result = await runSnapshotAction('File saved.', () => api.writeRepositoryFileBytes({
            repoPath: currentRepoPath,
            filePath: selectedPath,
            base64: base64FromBytes(bytes)
          }))
          if (result !== false) {
            setHexOriginalText(nextHexText)
            setHexDraftText(nextHexText)
            setActiveHexByteIndex((current) => clamp(current, hexStartOffset, Math.max(hexStartOffset, hexStartOffset + bytes.length - 1)))
            setHexBytes((current) => current ? {
              ...current,
              byteSize: bytes.length,
              startOffset: 0,
              endOffset: bytes.length,
              hasMore: false,
              fullFileLoaded: true
            } : current)
          }
          return
        }

        if (!hexBytes) return
        const originalBytes = Math.max(0, hexEndOffset - hexStartOffset)
        if (bytes.length !== originalBytes) {
          setNotice('Hex chunk edits must keep the same byte count.')
          return
        }

        const result = await runSnapshotAction('Hex chunk saved.', () => api.writeRepositoryFileChunk({
          repoPath: currentRepoPath,
          filePath: selectedPath,
          startOffset: hexStartOffset,
          endOffset: hexEndOffset,
          text: '',
          base64: base64FromBytes(bytes)
        }))
        if (result !== false) {
          setHexOriginalText(nextHexText)
          setHexDraftText(nextHexText)
          setActiveHexByteIndex((current) => clamp(current, hexStartOffset, Math.max(hexStartOffset, hexStartOffset + bytes.length - 1)))
          setHexBytes((current) => current ? {
            ...current,
            endOffset: current.startOffset + bytes.length
          } : current)
        }
        return
      }

      if (chunkedTextPreview) {
        const currentChunk = chunkedTextPreview
        const chunkText = currentText
        const replacementBytes = utf8ByteOffset(chunkText, chunkText.length)
        const originalBytes = Math.max(0, currentChunk.endOffset - currentChunk.startOffset)
        const nextByteSize = Math.max(0, currentChunk.byteSize + replacementBytes - originalBytes)
        const result = await runSnapshotAction('File chunk saved.', () => api.writeRepositoryFileChunk({
          repoPath: currentRepoPath,
          filePath: selectedPath,
          startOffset: currentChunk.startOffset,
          endOffset: currentChunk.endOffset,
          text: chunkText
        }))
        if (result !== false) {
          setOriginalText(chunkText)
          setDraftText(chunkText)
          setChunkedTextPreview({
            ...currentChunk,
            text: chunkText,
            byteSize: nextByteSize,
            endOffset: currentChunk.startOffset + replacementBytes,
            hasMore: currentChunk.startOffset + replacementBytes < nextByteSize,
            markers: currentChunk.markers.slice(0, currentChunk.pageIndex + 1)
          })
        }
        return
      }

      const result = await runSnapshotAction('File saved.', () => api.writeRepositoryFile({
        repoPath: currentRepoPath,
        filePath: selectedPath,
        text: currentText
      }))
      if (result !== false) {
        setOriginalText(currentText)
      }
    } finally {
      setSaving(false)
    }
  }

  const resetAfterBeautify = (nextText: string) => {
    applyEditorTextChange(nextText, { viewMode: 'code', resetJsonCollapse: true })
  }

  const beautifyFile = () => {
    if (!selectedPath || chunkedTextActive || fileLoading || fileError || textUnavailableMessage || viewMode === 'image') return
    const currentText = flushActiveEditorDraftText()
    setBeautifying(true)
    try {
      const nextText = beautifyTextLocally(selectedPath, currentText)
      if (!beautifyPreservesTokens(currentText, nextText)) {
        setNotice('Beautify was rejected because it changed code tokens. No changes applied.')
        return
      }

      if (nextText === currentText) {
        setNotice('Beautify made no changes.')
        return
      }

      resetAfterBeautify(nextText)
    } catch (error) {
      setNotice(error instanceof Error ? `Beautify failed: ${error.message}` : 'Beautify failed.')
    } finally {
      setBeautifying(false)
    }
  }

  const beautifyFileWithAi = async () => {
    if (!api || !currentRepoPath || !selectedPath || chunkedTextActive || fileLoading || fileError || textUnavailableMessage || viewMode === 'image') return
    const currentText = flushActiveEditorDraftText()
    setAiBeautifying(true)
    try {
      const result = await api.beautifyFileWithAssistant({
        repoPath: currentRepoPath,
        assistant: selectedAssistant,
        filePath: selectedPath,
        text: currentText
      })

      if (!result.ok) {
        setNotice(friendlyIpcErrorMessage(result.error.message, 'AI beautify failed.'))
        return
      }

      const nextText = normalizeTextForEditor(result.data.content)
      if (!beautifyPreservesTokens(currentText, nextText)) {
        setNotice('AI Beautify was rejected because it changed code tokens. No changes applied.')
        return
      }

      if (nextText === currentText) {
        setNotice('AI Beautify made no changes.')
        return
      }

      resetAfterBeautify(nextText)
    } catch (error) {
      setNotice(friendlyIpcErrorMessage(error instanceof Error ? error.message : '', 'AI beautify failed.'))
    } finally {
      setAiBeautifying(false)
    }
  }

  return {
    saving,
    beautifying,
    aiBeautifying,
    saveFile,
    beautifyFile,
    beautifyFileWithAi
  }
}
