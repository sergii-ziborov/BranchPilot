import { useEffect, useRef, useState, type ReactNode } from 'react'
import { CheckSquare, ChevronDown, ChevronUp, FileImage, FileText, Plus, Trash2, X } from 'lucide-react'
import type { DiffContextResult, DiffFile, DiffHunk, DiffLine, DiffResult, ImagePreview } from '../shared/branchPilot'
import type { ChangeDiffMode } from '../shared/changeStaging'
import { buildSplitDiffRows } from '../shared/diffView'
import { highlight, langFromPath } from '../lib/highlight'
import { renderSegs, shouldWordDiff, wordDiff } from '../lib/wordDiff'

/** Word-level highlight map for the unified view: line index → highlighted content. */
function buildUnifiedWordDiff(lines: DiffLine[], lang: string): Map<number, ReactNode> {
  const map = new Map<number, ReactNode>()
  let i = 0
  while (i < lines.length) {
    if (lines[i].type !== 'remove') {
      i += 1
      continue
    }
    const removeStart = i
    while (i < lines.length && lines[i].type === 'remove') i += 1
    const addStart = i
    while (i < lines.length && lines[i].type === 'add') i += 1
    const pairs = Math.min(addStart - removeStart, i - addStart)
    for (let k = 0; k < pairs; k++) {
      const oldLine = lines[removeStart + k]
      const newLine = lines[addStart + k]
      if (!shouldWordDiff(oldLine.content, newLine.content)) continue
      const { oldSegs, newSegs } = wordDiff(oldLine.content, newLine.content)
      map.set(removeStart + k, renderSegs(oldSegs, lang, 'del'))
      map.set(addStart + k, renderSegs(newSegs, lang, 'add'))
    }
  }
  return map
}

type DiffMode = ChangeDiffMode
type DiffDisplayMode = 'unified' | 'split'
type DiffContextDirection = 'up' | 'down'

interface DiffContextLoadRequest {
  filePath: string
  staged: boolean
  lineStart: number
  maxLines: number
}

interface ExtraContextEntry {
  above: DiffLine[]
  below: DiffLine[]
  totalLines?: number
}

function lineClass(line: string): string {
  if (line.startsWith('+') && !line.startsWith('+++')) return 'marker-add'
  if (line.startsWith('-') && !line.startsWith('---')) return 'marker-remove'
  return 'marker-base'
}

function linePrefix(line: string): string {
  if (line.startsWith('+') && !line.startsWith('+++')) return '+'
  if (line.startsWith('-') && !line.startsWith('---')) return '-'
  return ' '
}

function diffLinePrefix(line: DiffLine): string {
  if (line.type === 'add') return '+'
  if (line.type === 'remove') return '-'
  if (line.type === 'meta') return '\\'
  return ' '
}

function formatLineNumber(lineNumber?: number): string {
  return lineNumber ? String(lineNumber) : ''
}

function RawDiffPreview({ diff }: { diff: DiffResult }) {
  return (
    <pre className="diff-preview">
      {diff.tooLarge && (
        <code className="line marker-base">
          <span> </span>
          Diff truncated for performance.
        </code>
      )}
      {diff.text.split('\n').map((line, index) => (
        <code className={`line ${lineClass(line)}`} key={`${index}-${line.slice(0, 20)}`}>
          <span>{linePrefix(line)}</span>
          {line}
        </code>
      ))}
    </pre>
  )
}

function DiffLineNumber({
  lineNumber,
  openLine,
  onOpenLine
}: {
  lineNumber?: number
  // The working-tree line to open in the editor. Old-side numbers refer to the
  // previous revision, so removed lines (no openLine) are not clickable.
  openLine?: number
  onOpenLine?: (line?: number) => void
}) {
  if (!lineNumber || !openLine || !onOpenLine) {
    return <span className="line-number">{formatLineNumber(lineNumber)}</span>
  }

  return (
    <button
      className="line-number line-number-button"
      type="button"
      title={`Open line ${openLine} in editor`}
      aria-label={`Open line ${openLine} in editor`}
      onClick={() => onOpenLine(openLine)}
    >
      {formatLineNumber(lineNumber)}
    </button>
  )
}

function SplitDiffCell({
  line,
  side,
  content,
  onOpenLine
}: {
  line?: DiffLine
  side: 'old' | 'new'
  content: ReactNode
  onOpenLine?: (line?: number) => void
}) {
  const lineNumber = side === 'old' ? line?.oldLineNumber : line?.newLineNumber

  return (
    <code className={`split-diff-cell ${line ? `line-${line.type}` : 'line-empty'}`}>
      <DiffLineNumber lineNumber={lineNumber} openLine={line?.newLineNumber} onOpenLine={onOpenLine} />
      <span className="line-marker">{line ? diffLinePrefix(line) : ''}</span>
      <span className="line-content">{content}</span>
    </code>
  )
}

function SplitDiffLines({ lines, lang, onOpenLine }: { lines: DiffLine[]; lang: string; onOpenLine?: (line?: number) => void }) {
  return (
    <div className="split-diff-lines">
      {buildSplitDiffRows(lines).map((row, rowIndex) => {
        const { oldLine, newLine } = row
        let oldContent: ReactNode = oldLine ? highlight(oldLine.content, lang) : ''
        let newContent: ReactNode = newLine ? highlight(newLine.content, lang) : ''
        if (
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
            <SplitDiffCell line={oldLine} side="old" content={oldContent} onOpenLine={onOpenLine} />
            <SplitDiffCell line={newLine} side="new" content={newContent} onOpenLine={onOpenLine} />
          </div>
        )
      })}
    </div>
  )
}

function UnifiedDiffLines({
  lines,
  lang,
  onOpenLine,
  keyPrefix,
  selectable,
  selected,
  onLineSelect
}: {
  lines: DiffLine[]
  lang: string
  onOpenLine?: (line?: number) => void
  keyPrefix?: string
  selectable?: boolean
  selected?: Set<string>
  onLineSelect?: (key: string, shift: boolean) => void
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
          >
            {canSelect ? (
              <button
                type="button"
                className={isSelected ? 'line-select-control selected' : 'line-select-control'}
                title={isSelected ? 'Deselect this line' : 'Select this line for staging'}
                aria-label={isSelected ? 'Deselect this line' : 'Select this line for staging'}
                aria-pressed={isSelected}
                onClick={(event) => onLineSelect!(key, event.shiftKey)}
              />
            ) : (
              <span className="line-select-spacer" />
            )}
            <DiffLineNumber lineNumber={line.oldLineNumber} openLine={line.newLineNumber} onOpenLine={onOpenLine} />
            <DiffLineNumber lineNumber={line.newLineNumber} openLine={line.newLineNumber} onOpenLine={onOpenLine} />
            <span className="line-marker">{diffLinePrefix(line)}</span>
            <span className="line-content">{wordContent.get(lineIndex) ?? highlight(line.content, lang)}</span>
          </code>
        )
      })}
    </div>
  )
}

/** Build a `git apply --cached` patch that stages only the selected +/- lines. */
function buildStagePatch(files: DiffFile[], selected: Set<string>): string {
  let out = ''
  files.forEach((file, fi) => {
    const hunkPatches: string[] = []
    file.hunks.forEach((hunk, hi) => {
      const body: string[] = []
      let oldCount = 0
      let newCount = 0
      let hasSelected = false
      hunk.lines.forEach((line, li) => {
        const sel = selected.has(`${fi}:${hi}:${li}`)
        if (line.type === 'context') {
          body.push(` ${line.content}`)
          oldCount += 1
          newCount += 1
        } else if (line.type === 'add') {
          if (sel) {
            body.push(`+${line.content}`)
            newCount += 1
            hasSelected = true
          }
        } else if (line.type === 'remove') {
          if (sel) {
            body.push(`-${line.content}`)
            oldCount += 1
            hasSelected = true
          } else {
            body.push(` ${line.content}`)
            oldCount += 1
            newCount += 1
          }
        }
      })
      if (!hasSelected) return
      hunkPatches.push(`@@ -${hunk.oldStart},${oldCount} +${hunk.newStart},${newCount} @@\n${body.join('\n')}`)
    })
    if (hunkPatches.length === 0) return
    const a = file.oldPath ?? file.newPath
    const b = file.newPath
    out += `diff --git a/${a} b/${b}\n--- a/${a}\n+++ b/${b}\n${hunkPatches.join('\n')}\n`
  })
  return out
}

/** Build a patch that can be reverse-applied to the index to exclude selected staged lines. */
function buildUnstagePatch(files: DiffFile[], selected: Set<string>): string {
  let out = ''
  files.forEach((file, fi) => {
    const hunkPatches: string[] = []
    file.hunks.forEach((hunk, hi) => {
      const body: string[] = []
      let oldCount = 0
      let newCount = 0
      let hasSelected = false
      hunk.lines.forEach((line, li) => {
        const sel = selected.has(`${fi}:${hi}:${li}`)
        if (line.type === 'context') {
          body.push(` ${line.content}`)
          oldCount += 1
          newCount += 1
        } else if (line.type === 'add') {
          if (sel) {
            body.push(`+${line.content}`)
            newCount += 1
            hasSelected = true
          } else {
            body.push(` ${line.content}`)
            oldCount += 1
            newCount += 1
          }
        } else if (line.type === 'remove' && sel) {
          body.push(`-${line.content}`)
          oldCount += 1
          hasSelected = true
        }
      })
      if (!hasSelected) return
      hunkPatches.push(`@@ -${hunk.oldStart},${oldCount} +${hunk.newStart},${newCount} @@\n${body.join('\n')}`)
    })
    if (hunkPatches.length === 0) return
    const a = file.oldPath ?? file.newPath
    const b = file.newPath
    out += `diff --git a/${a} b/${b}\n--- a/${a}\n+++ b/${b}\n${hunkPatches.join('\n')}\n`
  })
  return out
}

function hunkHasHiddenContextBefore(file: DiffFile, index: number): boolean {
  if (index > 0) return true

  const hunk = file.hunks[index]
  if (!hunk) return false

  return hunk.oldStart > 1 || hunk.newStart > 1
}

function hunkHasHiddenContextAfter(file: DiffFile, index: number): boolean {
  return index < file.hunks.length - 1
}

function contextLineNumber(line: DiffLine): number | undefined {
  return line.newLineNumber ?? line.oldLineNumber
}

function firstContextLineNumber(lines: DiffLine[]): number | undefined {
  for (const line of lines) {
    const lineNumber = contextLineNumber(line)
    if (lineNumber) return lineNumber
  }

  return undefined
}

function lastContextLineNumber(lines: DiffLine[]): number | undefined {
  for (let index = lines.length - 1; index >= 0; index--) {
    const lineNumber = contextLineNumber(lines[index])
    if (lineNumber) return lineNumber
  }

  return undefined
}

function hunkContextKey(file: DiffFile, hunk: DiffHunk): string {
  return `${file.newPath}:${hunk.oldStart}:${hunk.newStart}:${hunk.header}`
}

function mergeContextLines(existing: DiffLine[], incoming: DiffLine[], direction: DiffContextDirection): DiffLine[] {
  const byLine = new Map<number, DiffLine>()
  const ordered = direction === 'up' ? [...incoming, ...existing] : [...existing, ...incoming]

  for (const line of ordered) {
    const lineNumber = contextLineNumber(line)
    if (!lineNumber || byLine.has(lineNumber)) continue
    byLine.set(lineNumber, line)
  }

  return [...byLine.values()].sort((a, b) => (contextLineNumber(a) ?? 0) - (contextLineNumber(b) ?? 0))
}

function contextBoundaryBefore(file: DiffFile, hunkIndex: number): number {
  const previous = file.hunks[hunkIndex - 1]
  const previousLast = previous ? lastContextLineNumber(previous.lines) : undefined
  return previousLast ? previousLast + 1 : 1
}

function contextBoundaryAfter(file: DiffFile, hunkIndex: number, totalLines?: number): number | undefined {
  const next = file.hunks[hunkIndex + 1]
  const nextFirst = next ? firstContextLineNumber(next.lines) : undefined
  if (nextFirst) return nextFirst - 1
  return totalLines
}

function canExpandContext(
  file: DiffFile,
  hunk: DiffHunk,
  hunkIndex: number,
  entry: ExtraContextEntry | undefined,
  direction: DiffContextDirection
): boolean {
  if (direction === 'up') {
    const firstVisible = firstContextLineNumber(entry?.above.length ? entry.above : hunk.lines)
    return Boolean(firstVisible && firstVisible > contextBoundaryBefore(file, hunkIndex))
  }

  const lastVisible = lastContextLineNumber(entry?.below.length ? entry.below : hunk.lines)
  const upperBoundary = contextBoundaryAfter(file, hunkIndex, entry?.totalLines)
  if (upperBoundary === undefined) return hunkHasHiddenContextAfter(file, hunkIndex)

  return Boolean(lastVisible && lastVisible < upperBoundary)
}

function DiffContextExpander({
  direction,
  onExpandContext
}: {
  direction: DiffContextDirection
  onExpandContext?: () => void
}) {
  if (!onExpandContext) return null

  const label = direction === 'up' ? 'Show more lines above' : 'Show more lines below'

  return (
    <button type="button" className="diff-context-expander" onClick={onExpandContext} title={label} aria-label={label}>
      {direction === 'up' ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      <span>{label}</span>
    </button>
  )
}

export function DiffPreview({
  diff,
  imagePreview = null,
  mode,
  displayMode = 'unified',
  expanded = false,
  busy = false,
  onStageHunk,
  onUnstageHunk,
  onDiscardHunk,
  onStageLines,
  onUnstageLines,
  onDiscardLines,
  onOpenLine,
  onLoadContext,
  onExpandContext
}: {
  diff: DiffResult | null
  imagePreview?: ImagePreview | null
  mode?: DiffMode
  displayMode?: DiffDisplayMode
  expanded?: boolean
  busy?: boolean
  onStageHunk?: (hunk: DiffHunk) => void
  onUnstageHunk?: (hunk: DiffHunk) => void
  onDiscardHunk?: (hunk: DiffHunk) => void
  onStageLines?: (patch: string) => void
  onUnstageLines?: (patch: string) => void
  onDiscardLines?: (patch: string) => void
  onOpenLine?: (line?: number) => void
  onLoadContext?: (request: DiffContextLoadRequest) => Promise<DiffContextResult | null>
  onExpandContext?: () => void
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [extraContext, setExtraContext] = useState<Record<string, ExtraContextEntry>>({})
  const anchorRef = useRef<string | null>(null)
  // Selection is per-file; clear it when the viewed file (or staged side) changes.
  useEffect(() => {
    setSelected(new Set())
    setExtraContext({})
    anchorRef.current = null
  }, [diff?.filePath, diff?.staged, diff?.text])

  const selectLine = (key: string, shift: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev)
      const anchor = anchorRef.current
      const kPrefix = key.slice(0, key.lastIndexOf(':'))
      const kIdx = Number(key.slice(key.lastIndexOf(':') + 1))
      if (shift && anchor) {
        const aPrefix = anchor.slice(0, anchor.lastIndexOf(':'))
        const aIdx = Number(anchor.slice(anchor.lastIndexOf(':') + 1))
        if (aPrefix === kPrefix) {
          for (let i = Math.min(aIdx, kIdx); i <= Math.max(aIdx, kIdx); i++) next.add(`${kPrefix}:${i}`)
          return next
        }
      }
      if (next.has(key)) next.delete(key)
      else next.add(key)
      anchorRef.current = key
      return next
    })
  }

  const stageSelected = () => {
    if (!diff || selected.size === 0 || !onStageLines) return
    const patch = buildStagePatch(diff.files, selected)
    if (patch.trim()) onStageLines(patch)
    setSelected(new Set())
    anchorRef.current = null
  }

  const discardSelected = () => {
    if (!diff || selected.size === 0 || !onDiscardLines) return
    const patch = buildStagePatch(diff.files, selected)
    if (patch.trim()) onDiscardLines(patch)
    setSelected(new Set())
    anchorRef.current = null
  }

  const unstageSelected = () => {
    if (!diff || selected.size === 0 || !onUnstageLines) return
    const patch = buildUnstagePatch(diff.files, selected)
    if (patch.trim()) onUnstageLines(patch)
    setSelected(new Set())
    anchorRef.current = null
  }

  const loadAdditionalContext = async (
    file: DiffFile,
    hunk: DiffHunk,
    hunkIndex: number,
    direction: DiffContextDirection
  ) => {
    if (!diff || !onLoadContext) {
      if (onExpandContext) onExpandContext()
      return
    }

    const key = hunkContextKey(file, hunk)
    const entry = extraContext[key]
    const firstVisible = firstContextLineNumber(entry?.above.length ? entry.above : hunk.lines)
    const lastVisible = lastContextLineNumber(entry?.below.length ? entry.below : hunk.lines)
    let lineStart = 1
    let maxLines = 0

    if (direction === 'up' && firstVisible) {
      const lowerBoundary = contextBoundaryBefore(file, hunkIndex)
      lineStart = Math.max(lowerBoundary, firstVisible - 20)
      maxLines = firstVisible - lineStart
    } else if (direction === 'down' && lastVisible) {
      const upperBoundary = contextBoundaryAfter(file, hunkIndex, entry?.totalLines)
      const cappedEnd = upperBoundary ? Math.min(upperBoundary, lastVisible + 20) : lastVisible + 20
      lineStart = lastVisible + 1
      maxLines = cappedEnd - lastVisible
    }

    if (maxLines <= 0) return

    const result = await onLoadContext({
      filePath: file.newPath,
      staged: diff.staged,
      lineStart,
      maxLines: Math.min(20, maxLines)
    })

    if (!result || result.lines.length === 0) return

    setExtraContext((current) => {
      const currentEntry = current[key] ?? { above: [], below: [] }
      const nextEntry: ExtraContextEntry = {
        above: direction === 'up' ? mergeContextLines(currentEntry.above, result.lines, direction) : currentEntry.above,
        below: direction === 'down' ? mergeContextLines(currentEntry.below, result.lines, direction) : currentEntry.below,
        totalLines: result.totalLines
      }

      return { ...current, [key]: nextEntry }
    })
  }

  if (!diff) {
    return (
      <div className="diff-empty">
        <FileText size={28} />
        <strong>Select a file to view its diff</strong>
        <span>Pick a changed file from the list on the left.</span>
      </div>
    )
  }

  if (diff.binary) {
    if (imagePreview) {
      return (
        <div className="diff-image">
          <img src={imagePreview.dataUrl} alt={diff.filePath} />
          <span className="diff-image-meta">{Math.round(imagePreview.byteSize / 1024)} KB · {imagePreview.mimeType}</span>
        </div>
      )
    }

    return (
      <div className="diff-empty">
        <FileImage size={28} />
        <strong>Binary file</strong>
        <span>No text diff is available for this file type.</span>
      </div>
    )
  }

  if (!diff.text.trim()) {
    return (
      <div className="diff-empty">
        <FileText size={28} />
        <strong>No changes to show</strong>
        <span>This selection has no textual diff.</span>
      </div>
    )
  }

  if (diff.tooLarge || diff.files.length === 0) {
    return <RawDiffPreview diff={diff} />
  }

  const canSelectLines = displayMode === 'unified'

  return (
    <div className="structured-diff">
      {diff.files.map((file, fileIndex) => (
        <section className="diff-file" key={`${file.oldPath ?? 'none'}-${file.newPath}`}>
          <div className="diff-file-heading">
            <strong>{file.newPath}</strong>
            {file.oldPath && file.oldPath !== file.newPath && <span>from {file.oldPath}</span>}
          </div>
          {file.hunks.map((hunk, index) => {
            const lang = langFromPath(file.newPath)
            const contextKey = hunkContextKey(file, hunk)
            const contextEntry = extraContext[contextKey]
            const canExpandBefore = !expanded && canExpandContext(file, hunk, index, contextEntry, 'up')
            const canExpandAfter = !expanded && canExpandContext(file, hunk, index, contextEntry, 'down')

            return (
              <article className="diff-hunk" key={`${hunk.header}-${index}`}>
                {canExpandBefore && (
                  <DiffContextExpander direction="up" onExpandContext={() => { void loadAdditionalContext(file, hunk, index, 'up') }} />
                )}
                <div className="diff-hunk-heading">
                  <code>{hunk.header}</code>
                  <div className="diff-hunk-actions">
                    {mode === 'unstaged' && onStageHunk && (
                      <button type="button" className="hunk-icon-btn" title="Stage hunk" aria-label="Stage hunk" onClick={() => onStageHunk(hunk)} disabled={busy}>
                        <Plus size={15} />
                      </button>
                    )}
                    {mode === 'unstaged' && onDiscardHunk && (
                      <button type="button" className="hunk-icon-btn danger" title="Discard hunk" aria-label="Discard hunk" onClick={() => onDiscardHunk(hunk)} disabled={busy}>
                        <Trash2 size={15} />
                      </button>
                    )}
                    {mode === 'staged' && onUnstageHunk && (
                      <button type="button" className="hunk-icon-btn" title="Unstage hunk" aria-label="Unstage hunk" onClick={() => onUnstageHunk(hunk)} disabled={busy}>
                        <X size={15} />
                      </button>
                    )}
                  </div>
                </div>
                {contextEntry?.above.length ? (
                  displayMode === 'split'
                    ? <SplitDiffLines lines={contextEntry.above} lang={lang} onOpenLine={onOpenLine} />
                    : <UnifiedDiffLines lines={contextEntry.above} lang={lang} onOpenLine={onOpenLine} />
                ) : null}
                {displayMode === 'split'
                  ? <SplitDiffLines lines={hunk.lines} lang={lang} onOpenLine={onOpenLine} />
                  : <UnifiedDiffLines
                      lines={hunk.lines}
                      lang={lang}
                      onOpenLine={onOpenLine}
                      keyPrefix={`${fileIndex}:${index}`}
                      selectable={canSelectLines}
                      selected={selected}
                      onLineSelect={selectLine}
                    />}
                {contextEntry?.below.length ? (
                  displayMode === 'split'
                    ? <SplitDiffLines lines={contextEntry.below} lang={lang} onOpenLine={onOpenLine} />
                    : <UnifiedDiffLines lines={contextEntry.below} lang={lang} onOpenLine={onOpenLine} />
                ) : null}
                {canExpandAfter && (
                  <DiffContextExpander direction="down" onExpandContext={() => { void loadAdditionalContext(file, hunk, index, 'down') }} />
                )}
              </article>
            )
          })}
        </section>
      ))}

      {selected.size > 0 && (
        <div className="diff-selection-bar">
          <span><CheckSquare size={15} /> {selected.size} line{selected.size === 1 ? '' : 's'} selected</span>
          <div className="diff-selection-actions">
            {mode === 'unstaged' && onStageLines && (
              <button type="button" onClick={stageSelected} disabled={busy}>
                <Plus size={15} />
                Stage selected
              </button>
            )}
            {mode === 'unstaged' && onDiscardLines && (
              <button type="button" className="danger" onClick={discardSelected} disabled={busy}>
                <Trash2 size={15} />
                Discard selected
              </button>
            )}
            {mode === 'staged' && onUnstageLines && (
              <button type="button" onClick={unstageSelected} disabled={busy} title="Exclude selected lines from the commit">
                <X size={15} />
                Unstage selected
              </button>
            )}
            <button type="button" className="secondary" onClick={() => { setSelected(new Set()); anchorRef.current = null }}>
              Clear
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
