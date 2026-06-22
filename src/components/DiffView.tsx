import { useEffect, useRef, useState, type ReactNode } from 'react'
import { CheckSquare, FileImage, FileText, Plus, Trash2, X } from 'lucide-react'
import type { DiffFile, DiffHunk, DiffLine, DiffResult, ImagePreview } from '../shared/branchPilot'
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
            onMouseDown={canSelect ? (event) => {
              if (event.button !== 0) return
              // Avoid hijacking the line-number "open in editor" button.
              if ((event.target as HTMLElement).closest('.line-number-button')) return
              event.preventDefault()
              onLineSelect!(key, event.shiftKey)
            } : undefined}
          >
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

export function DiffPreview({
  diff,
  imagePreview = null,
  mode,
  displayMode = 'unified',
  busy = false,
  onStageHunk,
  onUnstageHunk,
  onDiscardHunk,
  onStageLines,
  onUnstageLines,
  onDiscardLines,
  onOpenLine
}: {
  diff: DiffResult | null
  imagePreview?: ImagePreview | null
  mode?: DiffMode
  displayMode?: DiffDisplayMode
  busy?: boolean
  onStageHunk?: (hunk: DiffHunk) => void
  onUnstageHunk?: (hunk: DiffHunk) => void
  onDiscardHunk?: (hunk: DiffHunk) => void
  onStageLines?: (patch: string) => void
  onUnstageLines?: (patch: string) => void
  onDiscardLines?: (patch: string) => void
  onOpenLine?: (line?: number) => void
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const anchorRef = useRef<string | null>(null)
  // Selection is per-file; clear it when the viewed file (or staged side) changes.
  useEffect(() => {
    setSelected(new Set())
    anchorRef.current = null
  }, [diff?.filePath, diff?.staged])

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
          {file.hunks.map((hunk, index) => (
            <article className="diff-hunk" key={`${hunk.header}-${index}`}>
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
              {displayMode === 'split'
                ? <SplitDiffLines lines={hunk.lines} lang={langFromPath(file.newPath)} onOpenLine={onOpenLine} />
                : <UnifiedDiffLines
                    lines={hunk.lines}
                    lang={langFromPath(file.newPath)}
                    onOpenLine={onOpenLine}
                    keyPrefix={`${fileIndex}:${index}`}
                    selectable={canSelectLines}
                    selected={selected}
                    onLineSelect={selectLine}
                  />}
            </article>
          ))}
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
