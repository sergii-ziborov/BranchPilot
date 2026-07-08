import type {
  ChangeEvent as ReactChangeEvent,
  ClipboardEvent as ReactClipboardEvent,
  Dispatch,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  SetStateAction,
  UIEvent as ReactUIEvent
} from 'react'
import { FileImage } from 'lucide-react'
import type { CssColorEditDraft } from '../../diff/CssColorSwatch'
import { formatBytes } from './editorPrimitives'
import type {
  ChunkedTextPreview,
  EditorCssColorToken,
  EditorDiagnostic,
  EditorMinimapLine,
  EditorOverviewMarker,
  LiveLineChange
} from './editorTypes'
import { decoratedHighlightedLineContent } from './editorLineDecorations'
import { textRangesForLine, type EditorTextRange, type FileSearchMatch } from './editorViewHelpers'
import { EditorCssColorSwatch } from './EditorCssColorSwatch'
import { EditorOverviewMap } from './EditorOverviewMap'

export interface CodeEditorViewProps {
  textUnavailableMessage: string | null
  dirty: boolean
  chunkedTextActive: boolean
  chunkedTextPreview: ChunkedTextPreview | null
  loadChunkedTextPage: (direction: 'next' | 'previous', scrollPlacement?: 'start' | 'end') => Promise<void>
  lineNumbersInnerRef: { current: HTMLDivElement | null }
  highlightInnerRef: { current: HTMLDivElement | null }
  colorSwatchesInnerRef: { current: HTMLDivElement | null }
  overviewViewportRef: { current: HTMLDivElement | null }
  textareaRef: { current: HTMLTextAreaElement | null }
  visibleDraftLines: string[]
  draftLineCount: number
  activeEditorLineBase: number
  editorLineWindowStart: number
  diagnosticByLine: Map<number, EditorDiagnostic>
  changeKindByLine: Map<number, LiveLineChange['kind']>
  multiEditLineNumbers: Set<number>
  lineOffsets: number[]
  multiEditRanges: EditorTextRange[]
  setMultiEditRanges: Dispatch<SetStateAction<EditorTextRange[]>>
  selectedLang: string
  effectiveFileSearchQuery: string
  activeSearchMatch: FileSearchMatch | null
  currentRepoPath: string | undefined
  selectedPath: string
  editorSourceKey: string
  activeEditorText: string
  fileLoading: boolean
  capturePendingEditorHistory: () => void
  handleEditorTextChange: (event: ReactChangeEvent<HTMLTextAreaElement>) => void
  handleEditorTextKeyDown: (event: ReactKeyboardEvent<HTMLTextAreaElement>) => void
  handleEditorPaste: (event: ReactClipboardEvent<HTMLTextAreaElement>) => void
  syncHighlightScroll: (event: ReactUIEvent<HTMLTextAreaElement>) => void
  updateEditorSelectionStatus: () => void
  editorOverviewViewport: { top: number; height: number }
  editorMinimapLines: EditorMinimapLine[]
  editorOverviewMarkers: EditorOverviewMarker[]
  beginEditorOverviewDrag: (event: ReactPointerEvent<HTMLDivElement>) => void
  dragEditorOverview: (event: ReactPointerEvent<HTMLDivElement>) => void
  endEditorOverviewDrag: (event: ReactPointerEvent<HTMLDivElement>) => void
  focusEditorPosition: (lineNumber: number) => void
  editorCssColorTokens: EditorCssColorToken[]
  updateEditorCssColor: (request: CssColorEditDraft) => void
  diagnostics: EditorDiagnostic[]
  goToDiagnostic: (diagnostic: EditorDiagnostic) => void
}

export function CodeEditorView({
  textUnavailableMessage,
  dirty,
  chunkedTextActive,
  chunkedTextPreview,
  loadChunkedTextPage,
  lineNumbersInnerRef,
  highlightInnerRef,
  colorSwatchesInnerRef,
  overviewViewportRef,
  textareaRef,
  visibleDraftLines,
  draftLineCount,
  activeEditorLineBase,
  editorLineWindowStart,
  diagnosticByLine,
  changeKindByLine,
  multiEditLineNumbers,
  lineOffsets,
  multiEditRanges,
  setMultiEditRanges,
  selectedLang,
  effectiveFileSearchQuery,
  activeSearchMatch,
  currentRepoPath,
  selectedPath,
  editorSourceKey,
  activeEditorText,
  fileLoading,
  capturePendingEditorHistory,
  handleEditorTextChange,
  handleEditorTextKeyDown,
  handleEditorPaste,
  syncHighlightScroll,
  updateEditorSelectionStatus,
  editorOverviewViewport,
  editorMinimapLines,
  editorOverviewMarkers,
  beginEditorOverviewDrag,
  dragEditorOverview,
  endEditorOverviewDrag,
  focusEditorPosition,
  editorCssColorTokens,
  updateEditorCssColor,
  diagnostics,
  goToDiagnostic
}: CodeEditorViewProps) {
  if (textUnavailableMessage) {
    return (
      <div className="changes-editor-mode-message">
        <FileImage size={28} />
        <strong>{textUnavailableMessage}</strong>
        <span>Use Preview for this file.</span>
      </div>
    )
  }

  return (
    <div className={[dirty ? 'changes-editor-code-shell is-dirty' : 'changes-editor-code-shell', chunkedTextActive ? 'is-chunked' : ''].filter(Boolean).join(' ')}>
      {chunkedTextPreview && (
        <div className="changes-editor-chunk-banner">
          <strong>Chunk editor</strong>
          <span>
            {formatBytes(chunkedTextPreview.startOffset)}-{formatBytes(chunkedTextPreview.endOffset)} of {formatBytes(chunkedTextPreview.byteSize)}
          </span>
          {chunkedTextPreview.error && <em>{chunkedTextPreview.error}</em>}
          <button type="button" onClick={() => void loadChunkedTextPage('previous')} disabled={chunkedTextPreview.loading || chunkedTextPreview.pageIndex === 0}>
            Previous chunk
          </button>
          <button
            type="button"
            onClick={() => void loadChunkedTextPage('next')}
            disabled={chunkedTextPreview.loading || (!chunkedTextPreview.hasMore && chunkedTextPreview.pageIndex >= chunkedTextPreview.markers.length - 1)}
          >
            {chunkedTextPreview.loading ? 'Loading...' : 'Next chunk'}
          </button>
        </div>
      )}
      <pre className="changes-editor-line-numbers" aria-hidden="true">
        <div className="changes-editor-line-numbers-inner" ref={lineNumbersInnerRef}>
          {visibleDraftLines.map((_, index) => {
            const lineNumber = activeEditorLineBase + editorLineWindowStart + index
            const diagnostic = diagnosticByLine.get(lineNumber)
            const changeKind = changeKindByLine.get(lineNumber)

            return (
              <span
                className={[
                  diagnostic ? 'line-diagnostic-error' : '',
                  changeKind ? `line-${changeKind}` : '',
                  multiEditLineNumbers.has(lineNumber) ? 'line-multi-edit' : ''
                ].filter(Boolean).join(' ') || undefined}
                key={lineNumber}
                title={diagnostic ? `${diagnostic.source}: ${diagnostic.message}` : undefined}
              >
                {lineNumber}
              </span>
            )
          })}
        </div>
      </pre>
      <pre className="changes-editor-highlight" aria-hidden="true">
        <div className="changes-editor-highlight-inner" ref={highlightInnerRef}>
          {visibleDraftLines.map((line, index) => {
            const lineNumber = activeEditorLineBase + editorLineWindowStart + index
            const lineStartOffset = lineOffsets[lineNumber - activeEditorLineBase] ?? 0
            const changeKind = changeKindByLine.get(lineNumber)
            const diagnostic = diagnosticByLine.get(lineNumber)
            const multiEditSelections = textRangesForLine(lineStartOffset, line, multiEditRanges)

            return (
              <code
                className={[
                  'changes-editor-highlight-line',
                  changeKind ? `line-${changeKind}` : '',
                  diagnostic ? 'line-diagnostic-error' : ''
                ].filter(Boolean).join(' ')}
                key={`${lineNumber}-${line.slice(0, 20)}`}
                title={diagnostic ? `${diagnostic.source}: ${diagnostic.message}` : undefined}
              >
                {decoratedHighlightedLineContent(line || ' ', selectedLang, effectiveFileSearchQuery, activeSearchMatch, lineNumber, multiEditSelections)}
              </code>
            )
          })}
        </div>
      </pre>
      <textarea
        ref={textareaRef}
        key={`${currentRepoPath}:${selectedPath}:${chunkedTextPreview?.startOffset ?? 0}:${chunkedTextPreview?.endOffset ?? 0}:${editorSourceKey}`}
        className={dirty ? 'changes-editor-textarea is-dirty' : 'changes-editor-textarea'}
        spellCheck={false}
        wrap="off"
        defaultValue={activeEditorText}
        onBeforeInput={capturePendingEditorHistory}
        onChange={handleEditorTextChange}
        onKeyDown={handleEditorTextKeyDown}
        onKeyUp={() => updateEditorSelectionStatus()}
        onPaste={handleEditorPaste}
        onScroll={syncHighlightScroll}
        onSelect={() => updateEditorSelectionStatus()}
        onFocus={() => updateEditorSelectionStatus()}
        onMouseUp={() => updateEditorSelectionStatus()}
        onMouseDown={() => {
          if (multiEditRanges.length > 0) setMultiEditRanges([])
        }}
        readOnly={false}
        disabled={fileLoading}
      />
      {draftLineCount > 0 && !fileLoading && (
        <EditorOverviewMap
          overviewViewportRef={overviewViewportRef}
          editorOverviewViewport={editorOverviewViewport}
          editorMinimapLines={editorMinimapLines}
          editorOverviewMarkers={editorOverviewMarkers}
          draftLineCount={draftLineCount}
          activeEditorLineBase={activeEditorLineBase}
          activeSearchLineNumber={activeSearchMatch?.lineNumber ?? null}
          beginEditorOverviewDrag={beginEditorOverviewDrag}
          dragEditorOverview={dragEditorOverview}
          endEditorOverviewDrag={endEditorOverviewDrag}
          focusEditorPosition={focusEditorPosition}
        />
      )}
      {editorCssColorTokens.length > 0 && (
        <div className="changes-editor-color-layer" aria-label="CSS color controls">
          <div className="changes-editor-color-layer-inner" ref={colorSwatchesInnerRef}>
            {editorCssColorTokens.map((token) => (
              <EditorCssColorSwatch
                key={`${token.lineNumber}-${token.columnStart}-${token.value}`}
                filePath={selectedPath}
                token={token}
                onUpdateCssColor={updateEditorCssColor}
              />
            ))}
          </div>
        </div>
      )}
      {diagnostics.length > 0 && !fileLoading && (
        <div className="changes-editor-diagnostics" aria-live="polite">
          <header>
            <strong>{diagnostics.length} lint issue{diagnostics.length === 1 ? '' : 's'}</strong>
            <span>{selectedPath}</span>
          </header>
          {diagnostics.slice(0, 4).map((diagnostic, index) => (
            <button
              type="button"
              key={`${diagnostic.lineNumber}-${diagnostic.column}-${index}`}
              onClick={() => goToDiagnostic(diagnostic)}
            >
              <span>{diagnostic.source}</span>
              <code>{diagnostic.lineNumber}:{diagnostic.column}</code>
              <strong>{diagnostic.message}</strong>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
