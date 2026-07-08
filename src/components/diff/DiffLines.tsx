import type { ReactNode } from 'react'
import type { DiffLine } from '../../shared/branchPilot'
import { buildSplitDiffRows } from '../../shared/diffView'
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
}: {
  lines: DiffLine[]
  lang: string
  filePath: string
  canEditCssColors?: boolean
  onUpdateCssColor?: (request: CssColorEditDraft) => Promise<void> | void
  onOpenLine?: (target: DiffLineEditorTarget) => void
  keyPrefix?: string
  selectable?: boolean
  selected?: Set<string>
  selectedDiscardPatch?: string
  selectedLineStaged?: boolean
  onLineSelect?: (key: string, shift: boolean) => void
  onOpenContextMenu?: (target: DiffLineContextMenuTarget) => void
}) {
  const lineIndexes = new Map<DiffLine, number>()
  lines.forEach((line, lineIndex) => lineIndexes.set(line, lineIndex))

  const selectableKey = (line?: DiffLine): string | undefined => {
    if (!selectable || !keyPrefix || !line || (line.type !== 'add' && line.type !== 'remove')) return undefined
    const lineIndex = lineIndexes.get(line)
    return lineIndex === undefined ? undefined : `${keyPrefix}:${lineIndex}`
  }

  return (
    <div className="split-diff-lines">
      {buildSplitDiffRows(lines).map((row, rowIndex) => {
        const { oldLine, newLine } = row
        const oldKey = selectableKey(oldLine)
        const newKey = selectableKey(newLine)
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
          <div className="split-diff-row" key={`${rowIndex}-${oldLine?.content ?? ''}-${newLine?.content ?? ''}`}>
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
      })}
    </div>
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
}: {
  lines: DiffLine[]
  lang: string
  filePath: string
  canEditCssColors?: boolean
  onUpdateCssColor?: (request: CssColorEditDraft) => Promise<void> | void
  onOpenLine?: (target: DiffLineEditorTarget) => void
  keyPrefix?: string
  selectable?: boolean
  selected?: Set<string>
  selectedDiscardPatch?: string
  selectedLineStaged?: boolean
  onLineSelect?: (key: string, shift: boolean) => void
  onOpenContextMenu?: (target: DiffLineContextMenuTarget) => void
}) {
  const wordContent = buildUnifiedWordDiff(lines, lang)
  return (
    <div className="diff-lines">
      {lines.map((line, lineIndex) => {
        const changeLine = line.type === 'add' || line.type === 'remove'
        const key = `${keyPrefix}:${lineIndex}`
        const canSelect = Boolean(selectable && changeLine && onLineSelect)
        const isSelected = Boolean(selected?.has(key))
        return (
          <code
            className={`diff-line line-${line.type}${canSelect ? ' selectable' : ''}${isSelected ? ' line-selected' : ''}`}
            key={`${lineIndex}-${line.type}-${line.content.slice(0, 20)}`}
            onClick={(event) => {
              if (!canSelect || !eventIsInLineSelectGutter(event) || targetIsInlineControl(event.target) || hasActiveTextSelection()) return
              onLineSelect!(key, event.shiftKey)
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
                : wordContent.get(lineIndex) ?? highlight(line.content, lang)}
            </span>
          </code>
        )
      })}
    </div>
  )
}
