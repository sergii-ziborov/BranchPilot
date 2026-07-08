import { useMemo } from 'react'
import type { RepositoryFileEntry, RepositorySnapshot } from '../../../shared/branchPilot'
import { clamp } from './editorPrimitives'
import type {
  ChunkedTextPreview,
  EditorDiagnostic,
  LiveLineChange
} from './editorTypes'
import type { RepositoryContentSearchMatch } from './editorStateTypes'
import { buildRepositoryFileTree } from './fileTree'
import { buildLiveLineChanges, textLines } from './liveLineChanges'
import {
  buildLineOffsets,
  detectEditorIndent,
  detectEditorLineEnding,
  editorTextSourceKey,
  findFileSearchMatches,
  parseFileLineSearchQuery,
  rangesOverlap,
  type EditorTextRange,
  type EditorViewMode
} from './editorViewHelpers'
import { EDITOR_SEARCH_MATCH_LIMIT } from './editorViewConstants'

interface UseEditorLiveDerivedStateParams {
  snapshot: RepositorySnapshot | null
  fileQuery: string
  files: RepositoryFileEntry[]
  fileContentMatches: Record<string, RepositoryContentSearchMatch>
  chunkedTextPreview: ChunkedTextPreview | null
  draftText: string
  originalText: string
  liveChangesText: string | null
  gitLineChanges: LiveLineChange[]
  multiEditRanges: EditorTextRange[]
  fileSearchQuery: string
  activeSearchIndex: number
  selectedPath: string
  hexDirty: boolean
  diagnostics: EditorDiagnostic[]
  fileLoading: boolean
  liveChangesOpen: boolean
  viewMode: EditorViewMode
  textUnavailableMessage: string | null
}

export function useEditorLiveDerivedState({
  snapshot,
  fileQuery,
  files,
  fileContentMatches,
  chunkedTextPreview,
  draftText,
  originalText,
  liveChangesText,
  gitLineChanges,
  multiEditRanges,
  fileSearchQuery,
  activeSearchIndex,
  selectedPath,
  hexDirty,
  diagnostics,
  fileLoading,
  liveChangesOpen,
  viewMode,
  textUnavailableMessage
}: UseEditorLiveDerivedStateParams) {
  const changeByPath = useMemo(() => new Map((snapshot?.status.changes ?? []).map((change) => [change.path, change])), [snapshot])
  const selectedChange = selectedPath ? changeByPath.get(selectedPath) ?? null : null
  const query = fileQuery.trim().toLowerCase()
  const contentMatchedPaths = useMemo(() => new Set(Object.keys(fileContentMatches)), [fileContentMatches])
  const fileContentMatchCount = contentMatchedPaths.size
  const visibleFiles = useMemo(() => (
    query ? files.filter((file) => file.path.toLowerCase().includes(query) || contentMatchedPaths.has(file.path)) : files
  ), [contentMatchedPaths, files, query])
  const visibleFileTree = useMemo(() => buildRepositoryFileTree(visibleFiles), [visibleFiles])
  const chunkedTextActive = Boolean(chunkedTextPreview)
  const activeEditorText = chunkedTextPreview?.text ?? draftText
  const activeEditorLineBase = chunkedTextPreview?.startLine ?? 1
  const editorSourceKey = useMemo(() => editorTextSourceKey(originalText), [originalText])
  const textDirty = activeEditorText !== originalText
  const liveChangesSourceText = liveChangesText ?? activeEditorText
  const liveChanges = useMemo(() => {
    if (!textDirty) return []
    const changes = buildLiveLineChanges(originalText, liveChangesSourceText)
    return chunkedTextActive
      ? changes.map((change) => ({ ...change, lineNumber: activeEditorLineBase + change.lineNumber - 1 }))
      : changes
  }, [activeEditorLineBase, chunkedTextActive, liveChangesSourceText, originalText, textDirty])
  const liveChangesStale = textDirty && liveChangesSourceText !== activeEditorText
  const editedLines = liveChanges.length
  const changeKindByLine = useMemo(() => {
    const next = new Map<number, LiveLineChange['kind']>()
    for (const change of gitLineChanges) {
      if (change.kind !== 'removed') next.set(change.lineNumber, change.kind)
    }
    for (const change of liveChanges) {
      if (change.kind !== 'removed') next.set(change.lineNumber, change.kind)
    }
    return next
  }, [gitLineChanges, liveChanges])
  const gitChangedLines = gitLineChanges.length
  const draftLines = useMemo(() => textLines(activeEditorText), [activeEditorText])
  const lineOffsets = useMemo(() => buildLineOffsets(draftLines), [draftLines])
  const multiEditLineNumbers = useMemo(() => {
    const lines = new Set<number>()
    if (multiEditRanges.length === 0) return lines

    for (let index = 0; index < draftLines.length; index += 1) {
      const lineStart = lineOffsets[index] ?? 0
      const lineEnd = lineStart + draftLines[index].length
      if (multiEditRanges.some((range) => (
        range.start === range.end
          ? range.start >= lineStart && range.start <= lineEnd
          : rangesOverlap(range, { start: lineStart, end: Math.max(lineStart + 1, lineEnd) })
      ))) {
        lines.add(activeEditorLineBase + index)
      }
    }

    return lines
  }, [activeEditorLineBase, draftLines, lineOffsets, multiEditRanges])
  const fileLineSearchTarget = useMemo(() => parseFileLineSearchQuery(fileSearchQuery), [fileSearchQuery])
  const effectiveFileSearchQuery = fileLineSearchTarget ? '' : fileSearchQuery
  const fileSearchMatches = useMemo(() => (
    fileLineSearchTarget ? [] : findFileSearchMatches(draftLines, fileSearchQuery).map((match) => ({
      ...match,
      lineNumber: activeEditorLineBase + match.lineNumber - 1
    }))
  ), [activeEditorLineBase, draftLines, fileLineSearchTarget, fileSearchQuery])
  const dirty = textDirty || hexDirty
  const showLiveChangesPanel = textDirty && liveChangesOpen && !fileLoading && viewMode === 'code' && !textUnavailableMessage
  const editorLineEnding = useMemo(() => detectEditorLineEnding(activeEditorText), [activeEditorText])
  const editorIndent = useMemo(() => detectEditorIndent(activeEditorText), [activeEditorText])
  const editorIndentSelectValue = editorIndent.kind === 'tabs'
    ? 'tabs'
    : editorIndent.kind === 'spaces'
      ? `spaces-${clamp(editorIndent.size, 1, 8)}`
      : editorIndent.kind
  const diagnosticByLine = useMemo(() => new Map(diagnostics.map((diagnostic) => [diagnostic.lineNumber, diagnostic])), [diagnostics])
  const fileSearchOverflow = fileSearchMatches.length >= EDITOR_SEARCH_MATCH_LIMIT
  const activeSearchMatch = activeSearchIndex >= 0 ? fileSearchMatches[activeSearchIndex] ?? null : null
  const fileSearchLineNumbers = useMemo(
    () => new Set(fileSearchMatches.map((match) => match.lineNumber)),
    [fileSearchMatches]
  )

  return {
    changeByPath,
    selectedChange,
    query,
    contentMatchedPaths,
    fileContentMatchCount,
    visibleFiles,
    visibleFileTree,
    chunkedTextActive,
    activeEditorText,
    activeEditorLineBase,
    editorSourceKey,
    textDirty,
    liveChangesSourceText,
    liveChanges,
    liveChangesStale,
    editedLines,
    changeKindByLine,
    gitChangedLines,
    draftLines,
    lineOffsets,
    multiEditLineNumbers,
    fileLineSearchTarget,
    effectiveFileSearchQuery,
    fileSearchMatches,
    dirty,
    showLiveChangesPanel,
    editorLineEnding,
    editorIndent,
    editorIndentSelectValue,
    diagnosticByLine,
    fileSearchOverflow,
    activeSearchMatch,
    fileSearchLineNumbers
  }
}
