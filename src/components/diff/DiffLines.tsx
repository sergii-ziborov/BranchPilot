import type { ReactNode } from 'react'
import type { DiffLine } from '../../shared/branchPilot'
import { buildSplitDiffRows, type SplitDiffRow } from '../../shared/diffView'
import { highlight } from '../../lib/highlight'
import { renderSegs, shouldWordDiff, wordDiff } from '../../lib/wordDiff'
import { renderCssColorizedContent, type CssColorEditDraft } from './CssColorSwatch'
import {
  browserSelectionForLine,
  buildUnifiedWordDiff,
  diffLinePrefix,
  eventIsInLineSelectGutter,
  formatLineNumber,
  hasActiveTextSelection,
  splitRowSelectKeys,
  targetIsInlineControl
} from './diffLineUtils'
import type { DiffLineContextMenuTarget, DiffLineEditorTarget } from './diffViewTypes'

function DiffLineNumber({
  lineNumber,
  filePath,
  openLine,
  lineText,
  selectable,
  onOpenLine
}: {
  lineNumber?: number
  filePath: string
  // The working-tree line to open in the editor. Old-side numbers refer to the
  // previous revision, so removed lines (no openLine) are not clickable.
  openLine?: number
  lineText?: string
  selectable?: boolean
  onOpenLine?: (target: DiffLineEditorTarget) => void
}) {
  if (selectable || !lineNumber || !openLine || !onOpenLine) {
    return <span className="line-number">{formatLineNumber(lineNumber)}</span>
  }

  return (
    <button
      className="line-number line-number-button"
      type="button"
      title={`Open line ${openLine} in editor`}
      aria-label={`Open line ${openLine} in editor`}
      onClick={(event) => {
        event.stopPropagation()
        onOpenLine({ filePath, line: openLine, lineText })
      }}
    >
      {formatLineNumber(lineNumber)}
    </button>
  )
}

function SplitDiffCell({
  line,
  side,
  content,
  filePath,
  selectKey,
  selected = false,
  selectedLineCount = 0,
  selectedDiscardPatch,
  selectedLineStaged,
  onLineSelect,
  onOpenLine,
  onOpenContextMenu
}: {
  line?: DiffLine
  side: 'old' | 'new'
  content: ReactNode
  filePath: string
  selectKey?: string
  selected?: boolean
  selectedLineCount?: number
  selectedDiscardPatch?: string
  selectedLineStaged?: boolean
  onLineSelect?: (key: string, shift: boolean) => void
  onOpenLine?: (target: DiffLineEditorTarget) => void
  onOpenContextMenu?: (target: DiffLineContextMenuTarget) => void
}) {
  const lineNumber = side === 'old' ? line?.oldLineNumber : line?.newLineNumber
  const canSelect = Boolean(selectKey && onLineSelect)

  return (
    <code
      className={`split-diff-cell ${line ? `line-${line.type}` : 'line-empty'}${canSelect ? ' selectable' : ''}${selected ? ' line-selected' : ''}`}
      onClick={(event) => {
        if (!canSelect || !eventIsInLineSelectGutter(event) || targetIsInlineControl(event.target) || hasActiveTextSelection()) return
        onLineSelect!(selectKey!, event.shiftKey)
      }}
      onContextMenu={(event) => {
        if (!line || !onOpenContextMenu) return
        event.preventDefault()
        event.stopPropagation()
        onOpenContextMenu({
          x: event.clientX,
          y: event.clientY,
          filePath,
          line: line.newLineNumber,
          lineText: line.content,
          ...(selected && selectedDiscardPatch?.trim()
            ? {
                selectedLineCount,
                selectedLinePatch: selectedDiscardPatch,
                selectedLineStaged
              }
            : {}),
          ...browserSelectionForLine(line.content)
        })
      }}
    >
      <DiffLineNumber filePath={filePath} lineNumber={lineNumber} openLine={line?.newLineNumber} lineText={line?.content} selectable={canSelect} onOpenLine={onOpenLine} />
      <span className="line-marker">{line ? diffLinePrefix(line) : ''}</span>
      <span className="line-content">{content}</span>
    </code>
  )
}

/**
 * Shared props for the extracted single-row views. These views hold no list
 * state so they can be rendered both by the eager list components below and by
 * the virtualized body, guaranteeing identical output between the two paths.
 */
interface DiffRowViewCommon {
  lang: string
  filePath: string
  canEditCssColors?: boolean
  onUpdateCssColor?: (request: CssColorEditDraft) => Promise<void> | void
  onOpenLine?: (target: DiffLineEditorTarget) => void
  selectable?: boolean
  selected?: Set<string>
  selectedDiscardPatch?: string
  selectedLineStaged?: boolean
  onLineSelect?: (key: string, shift: boolean) => void
  onOpenContextMenu?: (target: DiffLineContextMenuTarget) => void
}

/** Renders a single side-by-side row (old/new pair) of the split diff view. */
export function SplitDiffRowView({
  row,
  oldKey,
  newKey,
  lang,
  filePath,
  canEditCssColors,
  onUpdateCssColor,
  onOpenLine,
  selected,
  selectedDiscardPatch,
  selectedLineStaged,
  onLineSelect,
  onOpenContextMenu
}: DiffRowViewCommon & {
  row: SplitDiffRow
  oldKey?: string
  newKey?: string
}) {
  const { oldLine, newLine } = row
  let oldContent: ReactNode = oldLine ? highlight(oldLine.content, lang) : ''
  let newContent: ReactNode = newLine
    ? renderCssColorizedContent({
        content: newLine.content,
        lang,
        filePath,
        lineNumber: newLine.newLineNumber,
        canEditCssColors,
        onUpdateCssColor
      })
    : ''
  if (
    !canEditCssColors &&
    oldLine?.type === 'remove' &&
    newLine?.type === 'add' &&
    shouldWordDiff(oldLine.content, newLine.content)
  ) {
    const { oldSegs, newSegs } = wordDiff(oldLine.content, newLine.content)
    oldContent = renderSegs(oldSegs, lang, 'del')
    newContent = renderSegs(newSegs, lang, 'add')
  }

  return (
    <div className="split-diff-row">
      <SplitDiffCell
        line={oldLine}
        side="old"
        content={oldContent}
        filePath={filePath}
        selectKey={oldKey}
        selected={Boolean(oldKey && selected?.has(oldKey))}
        selectedLineCount={selected?.size ?? 0}
        selectedDiscardPatch={selectedDiscardPatch}
        selectedLineStaged={selectedLineStaged}
        onLineSelect={onLineSelect}
        onOpenLine={onOpenLine}
        onOpenContextMenu={onOpenContextMenu}
      />
      <SplitDiffCell
        line={newLine}
        side="new"
        content={newContent}
        filePath={filePath}
        selectKey={newKey}
        selected={Boolean(newKey && selected?.has(newKey))}
        selectedLineCount={selected?.size ?? 0}
        selectedDiscardPatch={selectedDiscardPatch}
        selectedLineStaged={selectedLineStaged}
        onLineSelect={onLineSelect}
        onOpenLine={onOpenLine}
        onOpenContextMenu={onOpenContextMenu}
      />
    </div>
  )
}

export function SplitDiffLines({
  lines,
  lang,
  filePath,
  canEditCssColors,
  onUpdateCssColor,
  onOpenLine,
  keyPrefix,
  selectable,
  selected,
  selectedDiscardPatch,
  selectedLineStaged,
  onLineSelect,
  onOpenContextMenu
}: DiffRowViewCommon & {
  lines: DiffLine[]
  keyPrefix?: string
}) {
  const rows = buildSplitDiffRows(lines)
  const keys = splitRowSelectKeys(lines, rows, keyPrefix, selectable)

  return (
    <div className="split-diff-lines">
      {rows.map((row, rowIndex) => (
        <SplitDiffRowView
          key={`${rowIndex}-${row.oldLine?.content ?? ''}-${row.newLine?.content ?? ''}`}
          row={row}
          oldKey={keys[rowIndex].oldKey}
          newKey={keys[rowIndex].newKey}
          lang={lang}
          filePath={filePath}
          canEditCssColors={canEditCssColors}
          onUpdateCssColor={onUpdateCssColor}
          onOpenLine={onOpenLine}
          selected={selected}
          selectedDiscardPatch={selectedDiscardPatch}
          selectedLineStaged={selectedLineStaged}
          onLineSelect={onLineSelect}
          onOpenContextMenu={onOpenContextMenu}
        />
      ))}
    </div>
  )
}

/** Renders a single line of the unified diff view. */
export function UnifiedDiffLineView({
  line,
  selectKey,
  wordContent,
  lang,
  filePath,
  canEditCssColors,
  onUpdateCssColor,
  onOpenLine,
  selectable,
  selected,
  selectedDiscardPatch,
  selectedLineStaged,
  onLineSelect,
  onOpenContextMenu
}: DiffRowViewCommon & {
  line: DiffLine
  selectKey: string
  wordContent?: ReactNode
}) {
  const changeLine = line.type === 'add' || line.type === 'remove'
  const canSelect = Boolean(selectable && changeLine && onLineSelect)
  const isSelected = Boolean(selected?.has(selectKey))

  return (
    <code
      className={`diff-line line-${line.type}${canSelect ? ' selectable' : ''}${isSelected ? ' line-selected' : ''}`}
      onClick={(event) => {
        if (!canSelect || !eventIsInLineSelectGutter(event) || targetIsInlineControl(event.target) || hasActiveTextSelection()) return
        onLineSelect!(selectKey, event.shiftKey)
      }}
      onContextMenu={(event) => {
        if (!onOpenContextMenu) return
        event.preventDefault()
        event.stopPropagation()
        onOpenContextMenu({
          x: event.clientX,
          y: event.clientY,
          filePath,
          line: line.newLineNumber,
          lineText: line.content,
          ...(isSelected && selectedDiscardPatch?.trim()
            ? {
                selectedLineCount: selected?.size ?? 0,
                selectedLinePatch: selectedDiscardPatch,
                selectedLineStaged
              }
            : {}),
          ...browserSelectionForLine(line.content)
        })
      }}
    >
      <DiffLineNumber filePath={filePath} lineNumber={line.oldLineNumber} openLine={line.newLineNumber} lineText={line.content} selectable={canSelect} onOpenLine={onOpenLine} />
      <DiffLineNumber filePath={filePath} lineNumber={line.newLineNumber} openLine={line.newLineNumber} lineText={line.content} selectable={canSelect} onOpenLine={onOpenLine} />
      <span className="line-marker">{diffLinePrefix(line)}</span>
      <span className="line-content">
        {canEditCssColors
          ? renderCssColorizedContent({
              content: line.content,
              lang,
              filePath,
              lineNumber: line.newLineNumber,
              canEditCssColors,
              onUpdateCssColor
            })
          : wordContent ?? highlight(line.content, lang)}
      </span>
    </code>
  )
}

export function UnifiedDiffLines({
  lines,
  lang,
  filePath,
  canEditCssColors,
  onUpdateCssColor,
  onOpenLine,
  keyPrefix,
  selectable,
  selected,
  selectedDiscardPatch,
  selectedLineStaged,
  onLineSelect,
  onOpenContextMenu
}: DiffRowViewCommon & {
  lines: DiffLine[]
  keyPrefix?: string
}) {
  const wordContent = buildUnifiedWordDiff(lines, lang)
  return (
    <div className="diff-lines">
      {lines.map((line, lineIndex) => (
        <UnifiedDiffLineView
          key={`${lineIndex}-${line.type}-${line.content.slice(0, 20)}`}
          line={line}
          selectKey={`${keyPrefix}:${lineIndex}`}
          wordContent={wordContent.get(lineIndex)}
          lang={lang}
          filePath={filePath}
          canEditCssColors={canEditCssColors}
          onUpdateCssColor={onUpdateCssColor}
          onOpenLine={onOpenLine}
          selectable={selectable}
          selected={selected}
          selectedDiscardPatch={selectedDiscardPatch}
          selectedLineStaged={selectedLineStaged}
          onLineSelect={onLineSelect}
          onOpenContextMenu={onOpenContextMenu}
        />
      ))}
    </div>
  )
}
