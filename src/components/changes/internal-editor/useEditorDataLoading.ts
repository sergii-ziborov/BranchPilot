import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react'
import type {
  ApiResult,
  BranchPilotApi,
  DiffResult,
  FileChange,
  ImagePreview,
  RepositoryFileEntry
} from '../../../shared/branchPilot'
import { friendlyIpcErrorMessage } from '../../../lib/ipcErrorMessage'
import type { ChunkedTextPreview, LiveLineChange } from './editorTypes'
import type { RepositoryContentSearchMatch, RepositoryContentSearchState } from './editorStateTypes'
import { buildGitLineChanges } from './liveLineChanges'
import {
  EDITOR_FILE_CHUNK_BYTES,
  EDITOR_FILE_CONTENT_SEARCH_DEBOUNCE_MS,
  EDITOR_FILE_CONTENT_SEARCH_MIN_LENGTH,
  EDITOR_FILE_CONTENT_SEARCH_RESULT_LIMIT,
  PREVIEWABLE_IMAGE_RE
} from './editorViewConstants'
import { chunkedTextPreviewFromResult, type EditorViewMode } from './editorViewHelpers'

interface UseEditorDataLoadingParams {
  api: BranchPilotApi | undefined
  currentRepoPath: string | undefined
  selectedPath: string
  selectedChange: FileChange | null
  headOid: string | undefined
  fileQuery: string
  files: RepositoryFileEntry[]
  fileLoading: boolean
  fileError: string | null
  textUnavailableMessage: string | null
  chunkedTextPreview: ChunkedTextPreview | null
  activeEditorLineBase: number
  draftLineCount: number
  pendingEditorFocusRef: { current: { filePath: string; lineNumber: number; column: number; length: number; byteOffset?: number } | null }
  lastEditorScrollTopRef: { current: number }
  setFileContentMatches: Dispatch<SetStateAction<Record<string, RepositoryContentSearchMatch>>>
  setFileContentSearchState: Dispatch<SetStateAction<RepositoryContentSearchState>>
  setGitLineChanges: Dispatch<SetStateAction<LiveLineChange[]>>
  setGitDiffLoading: Dispatch<SetStateAction<boolean>>
  setImagePreview: Dispatch<SetStateAction<ImagePreview | null>>
  setImagePreviewLoading: Dispatch<SetStateAction<boolean>>
  setImagePreviewError: Dispatch<SetStateAction<string | null>>
  setFiles: Dispatch<SetStateAction<RepositoryFileEntry[]>>
  setFilesLoading: Dispatch<SetStateAction<boolean>>
  setFilesError: Dispatch<SetStateAction<string | null>>
  setSelectedPath: Dispatch<SetStateAction<string>>
  setFileLoading: Dispatch<SetStateAction<boolean>>
  setFileError: Dispatch<SetStateAction<string | null>>
  setTextUnavailableMessage: Dispatch<SetStateAction<string | null>>
  setChunkedTextPreview: Dispatch<SetStateAction<ChunkedTextPreview | null>>
  setOriginalText: Dispatch<SetStateAction<string>>
  setDraftText: Dispatch<SetStateAction<string>>
  setViewMode: Dispatch<SetStateAction<EditorViewMode>>
  focusCodePosition: (lineNumber: number, column?: number, length?: number) => void
  setNotice: (message: string) => void
}

export function useEditorDataLoading({
  api,
  currentRepoPath,
  selectedPath,
  selectedChange,
  headOid,
  fileQuery,
  files,
  fileLoading,
  fileError,
  textUnavailableMessage,
  chunkedTextPreview,
  activeEditorLineBase,
  draftLineCount,
  pendingEditorFocusRef,
  lastEditorScrollTopRef,
  setFileContentMatches,
  setFileContentSearchState,
  setGitLineChanges,
  setGitDiffLoading,
  setImagePreview,
  setImagePreviewLoading,
  setImagePreviewError,
  setFiles,
  setFilesLoading,
  setFilesError,
  setSelectedPath,
  setFileLoading,
  setFileError,
  setTextUnavailableMessage,
  setChunkedTextPreview,
  setOriginalText,
  setDraftText,
  setViewMode,
  focusCodePosition,
  setNotice
}: UseEditorDataLoadingParams) {
  const fileContentSearchRequestRef = useRef(0)

  useEffect(() => {
    const searchText = fileQuery.trim()
    const requestId = fileContentSearchRequestRef.current + 1
    fileContentSearchRequestRef.current = requestId

    if (!api || !currentRepoPath || searchText.length < EDITOR_FILE_CONTENT_SEARCH_MIN_LENGTH || files.length === 0) {
      setFileContentMatches({})
      setFileContentSearchState({ status: 'idle', scanned: 0, truncated: false, error: null })
      return
    }

    let cancelled = false
    const handle = window.setTimeout(() => {
      setFileContentMatches({})
      setFileContentSearchState({ status: 'searching', scanned: 0, truncated: false, error: null })

      void api.searchRepositoryContent({
        repoPath: currentRepoPath,
        query: searchText,
        maxResults: EDITOR_FILE_CONTENT_SEARCH_RESULT_LIMIT
      })
        .then((result) => {
          if (cancelled || fileContentSearchRequestRef.current !== requestId) return
          if (!result.ok) {
            setFileContentSearchState({
              status: 'done',
              scanned: 0,
              truncated: false,
              error: friendlyIpcErrorMessage(result.error.message, 'Content search failed.')
            })
            return
          }

          const matches: Record<string, RepositoryContentSearchMatch> = {}
          for (const match of result.data.matches) {
            matches[match.filePath] = match
          }

          setFileContentMatches(matches)
          setFileContentSearchState({
            status: 'done',
            scanned: result.data.matches.length,
            truncated: result.data.truncated,
            error: null
          })
        })
        .catch((error) => {
          if (cancelled || fileContentSearchRequestRef.current !== requestId) return
          setFileContentSearchState({
            status: 'done',
            scanned: 0,
            truncated: false,
            error: friendlyIpcErrorMessage(error instanceof Error ? error.message : '', 'Content search failed.')
          })
        })
    }, EDITOR_FILE_CONTENT_SEARCH_DEBOUNCE_MS)

    return () => {
      cancelled = true
      window.clearTimeout(handle)
    }
  }, [api, currentRepoPath, fileQuery, files])

  useEffect(() => {
    if (!api || !currentRepoPath || !selectedPath || !selectedChange) {
      setGitLineChanges([])
      setGitDiffLoading(false)
      return
    }

    let cancelled = false
    setGitDiffLoading(true)

    const requests: Array<Promise<ApiResult<DiffResult>>> = []
    if (selectedChange.staged) {
      requests.push(api.getDiff({ repoPath: currentRepoPath, filePath: selectedPath, staged: true, contextLines: 0 }))
    }
    if (selectedChange.unstaged || selectedChange.untracked || !selectedChange.staged) {
      requests.push(api.getDiff({ repoPath: currentRepoPath, filePath: selectedPath, staged: false, contextLines: 0 }))
    }

    void Promise.all(requests)
      .then((results) => {
        if (cancelled) return
        const diffs = results.flatMap((result) => (
          result.ok && !result.data.binary && !result.data.tooLarge ? [result.data] : []
        ))
        setGitLineChanges(buildGitLineChanges(diffs, selectedPath))
        setGitDiffLoading(false)
      })
      .catch(() => {
        if (cancelled) return
        setGitLineChanges([])
        setGitDiffLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [
    api,
    currentRepoPath,
    selectedPath,
    selectedChange?.additions,
    selectedChange?.deletions,
    selectedChange?.stagedStatus,
    selectedChange?.staged,
    selectedChange?.status,
    selectedChange?.unstagedStatus,
    selectedChange?.unstaged,
    selectedChange?.untracked,
    headOid
  ])

  useEffect(() => {
    if (!api || !currentRepoPath || !selectedPath || !PREVIEWABLE_IMAGE_RE.test(selectedPath)) return
    let cancelled = false
    setImagePreviewLoading(true)
    setImagePreviewError(null)
    void api.getImagePreview({ repoPath: currentRepoPath, filePath: selectedPath })
      .then((result) => {
        if (cancelled) return
        setImagePreviewLoading(false)
        if (result.ok) {
          setImagePreview(result.data)
          return
        }
        setImagePreview(null)
        setImagePreviewError(friendlyIpcErrorMessage(result.error.message, 'Failed to load image preview.'))
      })
      .catch((error) => {
        if (cancelled) return
        setImagePreviewLoading(false)
        setImagePreview(null)
        setImagePreviewError(friendlyIpcErrorMessage(error instanceof Error ? error.message : '', 'Failed to load image preview.'))
      })

    return () => {
      cancelled = true
    }
  }, [api, currentRepoPath, selectedPath])

  useEffect(() => {
    if (!api || !currentRepoPath) return
    let cancelled = false
    setFilesLoading(true)
    setFilesError(null)
    void api.listRepositoryFiles(currentRepoPath)
      .then((result) => {
        if (cancelled) return
        setFilesLoading(false)
        if (result.ok) {
          setFiles(result.data)
          setSelectedPath((current) => current || result.data[0]?.path || '')
          return
        }

        const message = friendlyIpcErrorMessage(result.error.message, 'Failed to load repository files.')
        setFilesError(message)
        setNotice(message)
      })
      .catch((error) => {
        if (cancelled) return
        setFilesLoading(false)
        const message = friendlyIpcErrorMessage(error instanceof Error ? error.message : '', 'Failed to load repository files.')
        setFilesError(message)
        setNotice(message)
      })

    return () => {
      cancelled = true
    }
  }, [api, currentRepoPath, setNotice])

  useEffect(() => {
    if (!api || !currentRepoPath || !selectedPath) return
    let cancelled = false
    setFileLoading(true)
    setFileError(null)
    setTextUnavailableMessage(null)
    void api.getRepositoryFileChunk({
      repoPath: currentRepoPath,
      filePath: selectedPath,
      offset: 0,
      maxBytes: EDITOR_FILE_CHUNK_BYTES
    })
      .then((result) => {
        if (cancelled) return
        setFileLoading(false)
        if (!result.ok) {
          setFileError(friendlyIpcErrorMessage(result.error.message, 'Failed to load file.'))
          setOriginalText('')
          setDraftText('')
          return
        }
        if (result.data.binary) {
          if (PREVIEWABLE_IMAGE_RE.test(selectedPath)) {
            setTextUnavailableMessage('Binary image preview only.')
            setOriginalText('')
            setDraftText('')
            return
          }
          setTextUnavailableMessage('Binary file - Hex editor available.')
          setViewMode('hex')
          setOriginalText('')
          setDraftText('')
          return
        }
        if (result.data.hasMore) {
          const preview = chunkedTextPreviewFromResult(result.data, {
            startLine: 1,
            markers: [{ offset: result.data.startOffset, lineNumber: 1 }],
            pageIndex: 0
          })
          setChunkedTextPreview(preview)
          setOriginalText(result.data.text)
          setDraftText(result.data.text)
          setViewMode('code')
          lastEditorScrollTopRef.current = 0
          return
        }
        setChunkedTextPreview(null)
        setOriginalText(result.data.text)
        setDraftText(result.data.text)
      })
      .catch((error) => {
        if (cancelled) return
        setFileLoading(false)
        setFileError(friendlyIpcErrorMessage(error instanceof Error ? error.message : '', 'Failed to load file.'))
        setOriginalText('')
        setDraftText('')
      })

    return () => {
      cancelled = true
    }
  }, [api, currentRepoPath, selectedPath])

  useEffect(() => {
    const target = pendingEditorFocusRef.current
    if (!target || target.filePath !== selectedPath || fileLoading) return
    if (fileError || textUnavailableMessage) {
      pendingEditorFocusRef.current = null
      return
    }

    const firstLineNumber = activeEditorLineBase
    const lastLineNumber = activeEditorLineBase + Math.max(0, draftLineCount - 1)
    const lineIsLoaded = target.lineNumber >= firstLineNumber && target.lineNumber <= lastLineNumber

    if (lineIsLoaded || !chunkedTextPreview || target.byteOffset === undefined || !api || !currentRepoPath) {
      pendingEditorFocusRef.current = null
      focusCodePosition(target.lineNumber, target.column, target.length)
      return
    }

    pendingEditorFocusRef.current = null
    let cancelled = false
    setFileLoading(true)
    setChunkedTextPreview({ ...chunkedTextPreview, loading: true, error: null })
    void api.getRepositoryFileChunk({
      repoPath: currentRepoPath,
      filePath: selectedPath,
      offset: target.byteOffset,
      maxBytes: EDITOR_FILE_CHUNK_BYTES
    })
      .then((result) => {
        if (cancelled) return
        setFileLoading(false)
        if (!result.ok) {
          const message = friendlyIpcErrorMessage(result.error.message, 'Failed to load search result chunk.')
          setChunkedTextPreview((current) => current ? { ...current, loading: false, error: message } : current)
          setNotice(message)
          return
        }
        if (result.data.binary) {
          setNotice('Search result is in a binary chunk.')
          return
        }

        const markers = result.data.startOffset > 0
          ? [
              { offset: 0, lineNumber: 1 },
              { offset: result.data.startOffset, lineNumber: target.lineNumber }
            ]
          : [{ offset: result.data.startOffset, lineNumber: target.lineNumber }]
        setChunkedTextPreview(chunkedTextPreviewFromResult(result.data, {
          startLine: target.lineNumber,
          markers,
          pageIndex: markers.length - 1
        }))
        setOriginalText(result.data.text)
        setDraftText(result.data.text)
        focusCodePosition(target.lineNumber, target.column, target.length)
      })
      .catch((error) => {
        if (cancelled) return
        setFileLoading(false)
        const message = friendlyIpcErrorMessage(error instanceof Error ? error.message : '', 'Failed to load search result chunk.')
        setChunkedTextPreview((current) => current ? { ...current, loading: false, error: message } : current)
        setNotice(message)
      })

    return () => {
      cancelled = true
    }
  }, [
    activeEditorLineBase,
    api,
    chunkedTextPreview,
    currentRepoPath,
    draftLineCount,
    fileError,
    fileLoading,
    selectedPath,
    setNotice,
    textUnavailableMessage
  ])
}
