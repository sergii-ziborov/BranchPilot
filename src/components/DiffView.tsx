import { FileImage, FileText, Plus, Trash2, X } from 'lucide-react'
import type { DiffHunk, DiffLine, DiffResult, ImagePreview } from '../shared/branchPilot'
import type { ChangeDiffMode } from '../shared/changeStaging'
import { buildSplitDiffRows } from '../shared/diffView'
import { highlight, langFromPath } from '../lib/highlight'

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
  lang,
  onOpenLine
}: {
  line?: DiffLine
  side: 'old' | 'new'
  lang: string
  onOpenLine?: (line?: number) => void
}) {
  const lineNumber = side === 'old' ? line?.oldLineNumber : line?.newLineNumber

  return (
    <code className={`split-diff-cell ${line ? `line-${line.type}` : 'line-empty'}`}>
      <DiffLineNumber lineNumber={lineNumber} openLine={line?.newLineNumber} onOpenLine={onOpenLine} />
      <span className="line-marker">{line ? diffLinePrefix(line) : ''}</span>
      <span className="line-content">{line ? highlight(line.content, lang) : ''}</span>
    </code>
  )
}

function SplitDiffLines({ lines, lang, onOpenLine }: { lines: DiffLine[]; lang: string; onOpenLine?: (line?: number) => void }) {
  return (
    <div className="split-diff-lines">
      {buildSplitDiffRows(lines).map((row, rowIndex) => (
        <div className="split-diff-row" key={`${rowIndex}-${row.oldLine?.content ?? ''}-${row.newLine?.content ?? ''}`}>
          <SplitDiffCell line={row.oldLine} side="old" lang={lang} onOpenLine={onOpenLine} />
          <SplitDiffCell line={row.newLine} side="new" lang={lang} onOpenLine={onOpenLine} />
        </div>
      ))}
    </div>
  )
}

function UnifiedDiffLines({ lines, lang, onOpenLine }: { lines: DiffLine[]; lang: string; onOpenLine?: (line?: number) => void }) {
  return (
    <div className="diff-lines">
      {lines.map((line, lineIndex) => (
        <code className={`diff-line line-${line.type}`} key={`${lineIndex}-${line.type}-${line.content.slice(0, 20)}`}>
          <DiffLineNumber lineNumber={line.oldLineNumber} openLine={line.newLineNumber} onOpenLine={onOpenLine} />
          <DiffLineNumber lineNumber={line.newLineNumber} openLine={line.newLineNumber} onOpenLine={onOpenLine} />
          <span className="line-marker">{diffLinePrefix(line)}</span>
          <span className="line-content">{highlight(line.content, lang)}</span>
        </code>
      ))}
    </div>
  )
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
  onOpenLine?: (line?: number) => void
}) {
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

  return (
    <div className="structured-diff">
      {diff.files.map((file) => (
        <section className="diff-file" key={`${file.oldPath ?? 'none'}-${file.newPath}`}>
          <div className="diff-file-heading">
            <strong>{file.newPath}</strong>
            {file.oldPath && file.oldPath !== file.newPath && <span>from {file.oldPath}</span>}
          </div>
          {file.hunks.map((hunk, index) => (
            <article className="diff-hunk" key={`${hunk.header}-${index}`}>
              <div className="diff-hunk-heading">
                <code>{hunk.header}</code>
                {mode === 'unstaged' && onStageHunk && (
                  <button type="button" onClick={() => onStageHunk(hunk)} disabled={busy}>
                    <Plus size={15} />
                    Stage hunk
                  </button>
                )}
                {mode === 'unstaged' && onDiscardHunk && (
                  <button type="button" className="danger-button" onClick={() => onDiscardHunk(hunk)} disabled={busy}>
                    <Trash2 size={15} />
                    Discard hunk
                  </button>
                )}
                {mode === 'staged' && onUnstageHunk && (
                  <button type="button" onClick={() => onUnstageHunk(hunk)} disabled={busy}>
                    <X size={15} />
                    Unstage hunk
                  </button>
                )}
              </div>
              {displayMode === 'split'
                ? <SplitDiffLines lines={hunk.lines} lang={langFromPath(file.newPath)} onOpenLine={onOpenLine} />
                : <UnifiedDiffLines lines={hunk.lines} lang={langFromPath(file.newPath)} onOpenLine={onOpenLine} />}
            </article>
          ))}
        </section>
      ))}
    </div>
  )
}
