import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode
} from 'react'
import { Copy, FileCode2, Hash } from 'lucide-react'
import type { DiffLine, DiffResult } from '../../shared/branchPilot'
import { buildSplitDiffRows } from '../../shared/diffView'
import { highlight, langFromPath } from '../../lib/highlight'
import { renderSegs, shouldWordDiff, wordDiff } from '../../lib/wordDiff'
import { SignalStatus } from '../SignalStatus'

interface HistoryFileCompareDiffProps {
  diff: DiffResult | null
  loading: boolean
  error: string | null
  filePath: string
  selectedCommitSha: string
  selectedLabel: string
  compareCommitSha: string
  compareLabel: string
  primaryPaneWidth: number
  onCopySelectedContent: () => void
  onCopyCompareContent: () => void
  onCopyPath: () => void
  onCopySelectedSha: () => void
  onCopyCompareSha: () => void
  selectedCopyDisabled?: boolean
  compareCopyDisabled?: boolean
  onResizePointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void
  onResizeKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void
}

function diffPrefix(line?: DiffLine): string {
  if (!line) return ''
  if (line.type === 'add') return '+'
  if (line.type === 'remove') return '-'
  return ' '
}

function lineClass(line?: DiffLine): string {
  return line ? `line-${line.type}` : 'line-empty'
}

function lineNumber(line: DiffLine | undefined, side: 'selected' | 'compare'): number | undefined {
  if (!line) return undefined
  return side === 'selected' ? line.newLineNumber : line.oldLineNumber
}

function formattedLineNumber(line: DiffLine | undefined, side: 'selected' | 'compare'): string {
  const number = lineNumber(line, side)
  return number === undefined ? '' : String(number)
}

function compareCell({
  line,
  content,
  side
}: {
  line?: DiffLine
  content: ReactNode
  side: 'selected' | 'compare'
}) {
  return (
    <code className={`history-compare-diff-cell ${lineClass(line)} side-${side}`}>
      <span className="line-number">{formattedLineNumber(line, side)}</span>
      <span className="line-marker">{diffPrefix(line)}</span>
      <span className="line-content">{content}</span>
    </code>
  )
}

function renderPairContent(oldLine: DiffLine | undefined, newLine: DiffLine | undefined, lang: string) {
  if (
    oldLine?.type === 'remove' &&
    newLine?.type === 'add' &&
    shouldWordDiff(oldLine.content, newLine.content)
  ) {
    const { oldSegs, newSegs } = wordDiff(oldLine.content, newLine.content)
    return {
      selected: renderSegs(newSegs, lang, 'add'),
      compare: renderSegs(oldSegs, lang, 'del')
    }
  }

  return {
    selected: newLine ? highlight(newLine.content, lang) : '',
    compare: oldLine ? highlight(oldLine.content, lang) : ''
  }
}

function CompareTitle({
  filePath,
  label,
  sha,
  side,
  onCopySha,
  onCopyPath,
  onCopyContent,
  copyDisabled
}: {
  filePath: string
  label: string
  sha: string
  side: 'Selected commit' | 'Compare target'
  onCopySha: () => void
  onCopyPath: () => void
  onCopyContent: () => void
  copyDisabled?: boolean
}) {
  return (
    <div className="history-compare-diff-title">
      <FileCode2 size={16} />
      <div>
        <strong title={filePath}>{filePath}</strong>
        <span title={sha}>{label} at {side.toLowerCase()}</span>
      </div>
      <div className="history-file-preview-actions">
        <button type="button" className="secondary icon-button" title="Copy full commit SHA" aria-label="Copy full commit SHA" onClick={onCopySha}>
          <Hash size={15} />
        </button>
        <button type="button" className="secondary icon-button" title="Copy file path" aria-label="Copy file path" onClick={onCopyPath}>
          <Copy size={15} />
        </button>
        <button type="button" className="secondary" onClick={onCopyContent} disabled={copyDisabled}>
          <Copy size={15} />
          Copy content
        </button>
      </div>
    </div>
  )
}

export function HistoryFileCompareDiff({
  diff,
  loading,
  error,
  filePath,
  selectedCommitSha,
  selectedLabel,
  compareCommitSha,
  compareLabel,
  primaryPaneWidth,
  onCopySelectedContent,
  onCopyCompareContent,
  onCopyPath,
  onCopySelectedSha,
  onCopyCompareSha,
  selectedCopyDisabled,
  compareCopyDisabled,
  onResizePointerDown,
  onResizeKeyDown
}: HistoryFileCompareDiffProps) {
  const lang = langFromPath(filePath)

  return (
    <div className="history-compare-diff" style={{ '--history-preview-primary-width': `${primaryPaneWidth}px` } as CSSProperties}>
      <div className="history-compare-diff-toolbar">
        <CompareTitle
          filePath={filePath}
          label={selectedLabel}
          sha={selectedCommitSha}
          side="Selected commit"
          onCopySha={onCopySelectedSha}
          onCopyPath={onCopyPath}
          onCopyContent={onCopySelectedContent}
          copyDisabled={selectedCopyDisabled}
        />
        <div
          className="history-preview-stage-splitter"
          role="separator"
          aria-label="Resize selected and compare file previews"
          aria-orientation="vertical"
          aria-valuenow={primaryPaneWidth}
          tabIndex={0}
          onPointerDown={onResizePointerDown}
          onKeyDown={onResizeKeyDown}
        >
          <span />
        </div>
        <CompareTitle
          filePath={filePath}
          label={compareLabel}
          sha={compareCommitSha}
          side="Compare target"
          onCopySha={onCopyCompareSha}
          onCopyPath={onCopyPath}
          onCopyContent={onCopyCompareContent}
          copyDisabled={compareCopyDisabled}
        />
      </div>

      <div className="history-compare-diff-body diff-preview">
        {loading ? (
          <SignalStatus
            className="history-file-preview-loading"
            label="Loading compare diff"
            detail={compareLabel}
          />
        ) : error ? (
          <div className="quiet-box danger-text">{error}</div>
        ) : diff?.binary ? (
          <div className="quiet-box">This file is binary in one of the compared targets.</div>
        ) : !diff || !diff.text.trim() ? (
          <div className="quiet-box">No text differences between these targets for this file.</div>
        ) : diff.tooLarge || diff.files.length === 0 ? (
          <pre className="history-compare-raw-diff">{diff.text}</pre>
        ) : (
          diff.files.map((file, fileIndex) => (
            <section className="history-compare-diff-file" key={`${file.oldPath ?? 'none'}-${file.newPath}-${fileIndex}`}>
              {file.hunks.map((hunk, hunkIndex) => (
                <article className="history-compare-diff-hunk" key={`${hunk.header}-${hunkIndex}`}>
                  <div className="history-compare-diff-hunk-heading">
                    <code>{hunk.header}</code>
                  </div>
                  <div className="history-compare-diff-lines">
                    {buildSplitDiffRows(hunk.lines).map((row, rowIndex) => {
                      const { oldLine, newLine } = row
                      const content = renderPairContent(oldLine, newLine, lang)

                      return (
                        <div className="history-compare-diff-row" key={`${hunkIndex}-${rowIndex}-${oldLine?.content ?? ''}-${newLine?.content ?? ''}`}>
                          {compareCell({ line: newLine, content: content.selected, side: 'selected' })}
                          <div className="history-compare-diff-gutter" aria-hidden="true" />
                          {compareCell({ line: oldLine, content: content.compare, side: 'compare' })}
                        </div>
                      )
                    })}
                  </div>
                </article>
              ))}
            </section>
          ))
        )}
      </div>
    </div>
  )
}
