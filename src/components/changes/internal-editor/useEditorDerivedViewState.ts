import { useMemo } from 'react'
import type { FileChange, ImagePreview } from '../../../shared/branchPilot'
import { fileTypeIconForPath } from '../../../lib/fileTypeIcons'
import { langFromPath } from '../../../lib/highlight'
import { findCssColorTokens, isCssColorFile } from '../../diff/CssColorSwatch'
import { clamp } from './editorPrimitives'
import type {
  EditorCssColorToken,
  EditorDiagnostic,
  EditorFileMenu,
  EditorMinimapLine,
  EditorOverviewMarker,
  LiveLineChange
} from './editorTypes'
import {
  buildJsonLineNumberMap,
  collectJsonExpandablePaths,
  flattenJsonTree,
  type JsonTreeNode
} from './jsonTreeUtils'
import { analyzeSvgText, safeSvgDataUrl } from './svgUtils'
import { JSON_RE, parseEditorJsonText } from './editorLintHelpers'
import type { EditorLintSettings } from './lintSettings'
import {
  EDITOR_MINIMAP_LINE_LIMIT,
  PREVIEWABLE_IMAGE_RE,
  SVG_RE
} from './editorViewConstants'
import type { EditorViewMode } from './editorViewHelpers'

interface UseEditorDerivedViewStateParams {
  activeEditorLineBase: number
  draftLines: string[]
  draftText: string
  visibleDraftLines: string[]
  editorLineWindowStart: number
  gitLineChanges: LiveLineChange[]
  liveChanges: LiveLineChange[]
  diagnostics: EditorDiagnostic[]
  fileSearchMatches: Array<{ lineNumber: number }>
  changeKindByLine: Map<number, LiveLineChange['kind']>
  diagnosticByLine: Map<number, EditorDiagnostic>
  fileSearchLineNumbers: Set<number>
  multiEditLineNumbers: Set<number>
  selectedPath: string
  textUnavailableMessage: string | null
  chunkedTextActive: boolean
  imagePreview: ImagePreview | null
  lintSettings: EditorLintSettings
  collapsedJsonPaths: Set<string>
  fileMenu: EditorFileMenu | null
  changeByPath: Map<string, FileChange>
}

export function useEditorDerivedViewState({
  activeEditorLineBase,
  draftLines,
  draftText,
  visibleDraftLines,
  editorLineWindowStart,
  gitLineChanges,
  liveChanges,
  diagnostics,
  fileSearchMatches,
  changeKindByLine,
  diagnosticByLine,
  fileSearchLineNumbers,
  multiEditLineNumbers,
  selectedPath,
  textUnavailableMessage,
  chunkedTextActive,
  imagePreview,
  lintSettings,
  collapsedJsonPaths,
  fileMenu,
  changeByPath
}: UseEditorDerivedViewStateParams) {
  const editorOverviewMarkers = useMemo<EditorOverviewMarker[]>(() => {
    const firstLine = activeEditorLineBase
    const lastLine = activeEditorLineBase + Math.max(0, draftLines.length - 1)
    const markers: EditorOverviewMarker[] = []
    const seen = new Set<string>()
    const addMarker = (marker: EditorOverviewMarker) => {
      if (marker.lineNumber < firstLine || marker.lineNumber > lastLine) return
      const key = `${marker.kind}:${marker.lineNumber}`
      if (seen.has(key)) return
      seen.add(key)
      markers.push(marker)
    }

    for (const change of gitLineChanges) {
      addMarker({ lineNumber: change.lineNumber, kind: change.kind, title: `Git ${change.kind} line ${change.lineNumber}` })
    }
    for (const change of liveChanges) {
      addMarker({ lineNumber: change.lineNumber, kind: change.kind, title: `Unsaved ${change.kind} line ${change.lineNumber}` })
    }
    for (const diagnostic of diagnostics) {
      addMarker({ lineNumber: diagnostic.lineNumber, kind: 'diagnostic', title: `${diagnostic.source}: ${diagnostic.message}` })
    }
    for (const match of fileSearchMatches) {
      addMarker({ lineNumber: match.lineNumber, kind: 'search', title: `Search match on line ${match.lineNumber}` })
    }

    return markers.sort((a, b) => a.lineNumber - b.lineNumber).slice(0, 1200)
  }, [activeEditorLineBase, diagnostics, draftLines.length, fileSearchMatches, gitLineChanges, liveChanges])

  const editorMinimapLines = useMemo<EditorMinimapLine[]>(() => {
    if (draftLines.length === 0) return []

    const step = Math.max(1, Math.ceil(draftLines.length / EDITOR_MINIMAP_LINE_LIMIT))
    const lines: EditorMinimapLine[] = []

    for (let index = 0; index < draftLines.length; index += step) {
      const lineNumber = activeEditorLineBase + index
      const trimmedLength = draftLines[index].trimEnd().length
      const changeKind = changeKindByLine.get(lineNumber)
      const kind: EditorMinimapLine['kind'] = diagnosticByLine.has(lineNumber)
        ? 'diagnostic'
        : fileSearchLineNumbers.has(lineNumber)
          ? 'search'
          : multiEditLineNumbers.has(lineNumber)
            ? 'multi-edit'
            : changeKind ?? 'plain'

      lines.push({
        lineNumber,
        kind,
        widthPercent: clamp(10 + Math.sqrt(Math.max(1, trimmedLength)) * 7, 10, 92)
      })
    }

    return lines
  }, [
    activeEditorLineBase,
    changeKindByLine,
    diagnosticByLine,
    draftLines,
    fileSearchLineNumbers,
    multiEditLineNumbers
  ])

  const editorCssColorTokens = useMemo<EditorCssColorToken[]>(() => {
    if (!isCssColorFile(selectedPath) || textUnavailableMessage) return []
    return visibleDraftLines.flatMap((line, index) => (
      findCssColorTokens(line).map((token) => ({
        ...token,
        lineNumber: activeEditorLineBase + editorLineWindowStart + index,
        renderLineIndex: index
      }))
    ))
  }, [activeEditorLineBase, editorLineWindowStart, selectedPath, textUnavailableMessage, visibleDraftLines])

  const selectedIsImage = PREVIEWABLE_IMAGE_RE.test(selectedPath)
  const selectedIsSvg = SVG_RE.test(selectedPath)
  const selectedIsJson = JSON_RE.test(selectedPath)
  const selectedIsBinaryPreview = selectedIsImage && Boolean(textUnavailableMessage)
  const svgPreviewUrl = selectedIsSvg && !chunkedTextActive && draftText ? safeSvgDataUrl(draftText) : ''
  const activeImagePreviewUrl = selectedIsSvg ? (svgPreviewUrl || imagePreview?.dataUrl || '') : imagePreview?.dataUrl ?? ''
  const svgAnalysis = useMemo(() => (selectedIsSvg && !chunkedTextActive ? analyzeSvgText(draftText) : null), [chunkedTextActive, draftText, selectedIsSvg])
  const jsonParseResult = useMemo(() => {
    if (chunkedTextActive || !selectedIsJson || !draftText.trim()) {
      return { rows: [] as JsonTreeNode[], expandablePaths: [] as string[], error: null as string | null }
    }
    try {
      const parsed = parseEditorJsonText(selectedPath, draftText, lintSettings)
      const lineNumbers = buildJsonLineNumberMap(parsed.preparedText)
      return {
        rows: flattenJsonTree(parsed.value, collapsedJsonPaths, lineNumbers),
        expandablePaths: collectJsonExpandablePaths(parsed.value),
        error: null
      }
    } catch (error) {
      return {
        rows: [] as JsonTreeNode[],
        expandablePaths: [] as string[],
        error: error instanceof Error ? error.message : 'Invalid JSON.'
      }
    }
  }, [chunkedTextActive, collapsedJsonPaths, draftText, lintSettings, selectedIsJson, selectedPath])
  const selectedIcon = fileTypeIconForPath(selectedPath)
  const selectedLang = langFromPath(selectedPath)
  const contextMenuChange = fileMenu ? changeByPath.get(fileMenu.path) : null
  const availableViewModes = useMemo<Array<{ id: EditorViewMode; label: string }>>(() => {
    const modes: Array<{ id: EditorViewMode; label: string }> = []
    if (selectedIsImage) modes.push({ id: 'image', label: 'Preview' })
    if (selectedIsSvg && !selectedIsBinaryPreview && !chunkedTextActive) modes.push({ id: 'svg-editor', label: 'Edit' })
    if (!selectedIsBinaryPreview || selectedIsSvg) modes.push({ id: 'code', label: selectedIsSvg ? 'SVG' : 'Code' })
    if (selectedIsJson && !selectedIsBinaryPreview && !chunkedTextActive) modes.push({ id: 'json', label: 'JSON' })
    if (selectedPath) modes.push({ id: 'hex', label: 'Hex' })
    return modes.length ? modes : [{ id: 'code', label: 'Code' }]
  }, [chunkedTextActive, selectedIsBinaryPreview, selectedIsImage, selectedIsJson, selectedIsSvg, selectedPath])

  return {
    editorOverviewMarkers,
    editorMinimapLines,
    editorCssColorTokens,
    selectedIsImage,
    selectedIsSvg,
    selectedIsJson,
    selectedIsBinaryPreview,
    activeImagePreviewUrl,
    svgAnalysis,
    jsonParseResult,
    selectedIcon,
    selectedLang,
    contextMenuChange,
    availableViewModes
  }
}
