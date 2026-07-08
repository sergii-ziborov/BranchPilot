import { useEffect, useRef, useState } from 'react'
import { CheckSquare, FileImage, FileText, Plus, Trash2, X } from 'lucide-react'
import type { DiffContextResult, DiffFile, DiffHunk, DiffResult, ImagePreview } from '../shared/branchPilot'
import { langFromPath } from '../lib/highlight'
import { buildStagePatch, buildUnstagePatch } from '../lib/diffPatches'
import { RawDiffPreview } from './diff/RawDiffPreview'
import { isCssColorFile, type CssColorEditDraft } from './diff/CssColorSwatch'
import { DiffStatBadges } from './DiffStatBadges'
import { SplitDiffLines, UnifiedDiffLines } from './diff/DiffLines'
import { DiffContextExpander } from './diff/DiffContextExpander'
import {
  alignLoadedContextLineNumbers,
  canExpandContext,
  contextBoundaryAfter,
  contextBoundaryBefore,
  firstVisibleLineNumber,
  hunkContextKey,
  lastVisibleLineNumber,
  mergeContextLines,
  trimIncomingContextLines
} from './diff/diffContextExpansion'
import type {
  DiffContextDirection,
  DiffContextLoadRequest,
  DiffDisplayMode,
  DiffLineContextMenuTarget,
  DiffLineEditorTarget,
  DiffMode,
  ExtraContextEntry
} from './diff/diffViewTypes'

export type { DiffLineEditorTarget, DiffLineContextMenuTarget } from './diff/diffViewTypes'

export function DiffPreview({
  diff,
  imagePreview = null,
  mode,
  displayMode = 'unified',
  expanded = false,
  busy = false,
  hideFileHeading = false,
  sectionLabel,
  sectionDescription,
  sectionStats,
  sectionTone,
  onStageHunk,
  onUnstageHunk,
  onDiscardHunk,
  onStageLines,
  onUnstageLines,
  onDiscardLines,
  onOpenLine,
  onLoadContext,
  onExpandContext,
  onUpdateCssColor,
  onOpenContextMenu
}: {
  diff: DiffResult | null
  imagePreview?: ImagePreview | null
  mode?: DiffMode
  displayMode?: DiffDisplayMode
  expanded?: boolean
  busy?: boolean
  hideFileHeading?: boolean
  sectionLabel?: string
  sectionDescription?: string
  sectionStats?: { additions: number; deletions: number } | null
  sectionTone?: DiffMode
  onStageHunk?: (hunk: DiffHunk) => void
  onUnstageHunk?: (hunk: DiffHunk) => void
  onDiscardHunk?: (hunk: DiffHunk) => void
  onStageLines?: (patch: string) => void
  onUnstageLines?: (patch: string) => void
  onDiscardLines?: (patch: string) => void
  onOpenLine?: (target: DiffLineEditorTarget) => void
  onLoadContext?: (request: DiffContextLoadRequest) => Promise<DiffContextResult | null>
  onExpandContext?: () => void
  onUpdateCssColor?: (request: CssColorEditDraft) => Promise<void> | void
  onOpenContextMenu?: (target: DiffLineContextMenuTarget) => void
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [extraContext, setExtraContext] = useState<Record<string, ExtraContextEntry>>({})
  const anchorRef = useRef<string | null>(null)
  const selectedDiscardPatch = diff && selected.size > 0 ? buildStagePatch(diff.files, selected) : ''
  const selectedLineStaged = mode === 'staged'
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
    const firstVisible = firstVisibleLineNumber(hunk, entry)
    const lastVisible = lastVisibleLineNumber(hunk, entry)
    let lineStart = 1
    let maxLines = 0

    if (direction === 'up' && firstVisible) {
      const lowerBoundary = contextBoundaryBefore(file, hunkIndex, extraContext)
      lineStart = Math.max(lowerBoundary, firstVisible - 20)
      maxLines = firstVisible - lineStart
    } else if (direction === 'down' && lastVisible) {
      const upperBoundary = contextBoundaryAfter(file, hunkIndex, entry?.totalLines, extraContext)
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
      const incomingLines = trimIncomingContextLines(
        result.lines,
        file,
        hunk,
        hunkIndex,
        direction,
        currentEntry,
        current,
        result.totalLines
      )
      if (incomingLines.length === 0) {
        return { ...current, [key]: { ...currentEntry, totalLines: result.totalLines } }
      }
      const alignedIncomingLines = alignLoadedContextLineNumbers(incomingLines, hunk, direction)
      const nextEntry: ExtraContextEntry = {
        above:
          direction === 'up' ? mergeContextLines(currentEntry.above, alignedIncomingLines, direction) : currentEntry.above,
        below:
          direction === 'down' ? mergeContextLines(currentEntry.below, alignedIncomingLines, direction) : currentEntry.below,
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

  const canSelectLines = Boolean(onStageLines || onUnstageLines || onDiscardLines)
  const canLoadMoreContext = Boolean(onLoadContext || onExpandContext)
  const sectionClassName = [
    'structured-diff',
    sectionLabel ? 'structured-diff-sectioned' : '',
    sectionTone ? `diff-section-${sectionTone}` : ''
  ].filter(Boolean).join(' ')

  return (
    <div className={sectionClassName}>
      {sectionLabel && (
        <div className="diff-section-heading">
          <div className="diff-section-title">
            <strong>{sectionLabel}</strong>
            {sectionDescription && <span>{sectionDescription}</span>}
          </div>
          {sectionStats && (
            <DiffStatBadges
              additions={sectionStats.additions}
              deletions={sectionStats.deletions}
              label={`${sectionLabel} diff stats`}
            />
          )}
        </div>
      )}
      {diff.files.map((file, fileIndex) => (
        <section className="diff-file" key={`${file.oldPath ?? 'none'}-${file.newPath}`}>
          {!hideFileHeading && (
            <div className="diff-file-heading">
              <strong>{file.newPath}</strong>
              {file.oldPath && file.oldPath !== file.newPath && <span>from {file.oldPath}</span>}
            </div>
          )}
          {file.hunks.map((hunk, index) => {
            const lang = langFromPath(file.newPath)
            const canEditCssColors = Boolean(onUpdateCssColor && isCssColorFile(file.newPath))
            const contextKey = hunkContextKey(file, hunk)
            const contextEntry = extraContext[contextKey]
            const canExpandBefore = canLoadMoreContext && !expanded && index === 0 && canExpandContext(file, hunk, index, contextEntry, 'up', extraContext)
            const canExpandAfter = canLoadMoreContext && !expanded && canExpandContext(file, hunk, index, contextEntry, 'down', extraContext)

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
                    ? <SplitDiffLines lines={contextEntry.above} lang={lang} filePath={file.newPath} canEditCssColors={canEditCssColors} onUpdateCssColor={onUpdateCssColor} onOpenLine={onOpenLine} onOpenContextMenu={onOpenContextMenu} />
                    : <UnifiedDiffLines lines={contextEntry.above} lang={lang} filePath={file.newPath} canEditCssColors={canEditCssColors} onUpdateCssColor={onUpdateCssColor} onOpenLine={onOpenLine} onOpenContextMenu={onOpenContextMenu} />
                ) : null}
                {displayMode === 'split'
                  ? <SplitDiffLines
                      lines={hunk.lines}
                      lang={lang}
                      filePath={file.newPath}
                      canEditCssColors={canEditCssColors}
                      onUpdateCssColor={onUpdateCssColor}
                      onOpenLine={onOpenLine}
                      keyPrefix={`${fileIndex}:${index}`}
                      selectable={canSelectLines}
                      selected={selected}
                      selectedDiscardPatch={selectedDiscardPatch}
                      selectedLineStaged={selectedLineStaged}
                      onLineSelect={selectLine}
                      onOpenContextMenu={onOpenContextMenu}
                    />
                  : <UnifiedDiffLines
                      lines={hunk.lines}
                      lang={lang}
                      filePath={file.newPath}
                      canEditCssColors={canEditCssColors}
                      onUpdateCssColor={onUpdateCssColor}
                      onOpenLine={onOpenLine}
                      keyPrefix={`${fileIndex}:${index}`}
                      selectable={canSelectLines}
                      selected={selected}
                      selectedDiscardPatch={selectedDiscardPatch}
                      selectedLineStaged={selectedLineStaged}
                      onLineSelect={selectLine}
                      onOpenContextMenu={onOpenContextMenu}
                    />}
                {contextEntry?.below.length ? (
                  displayMode === 'split'
                    ? <SplitDiffLines lines={contextEntry.below} lang={lang} filePath={file.newPath} canEditCssColors={canEditCssColors} onUpdateCssColor={onUpdateCssColor} onOpenLine={onOpenLine} onOpenContextMenu={onOpenContextMenu} />
                    : <UnifiedDiffLines lines={contextEntry.below} lang={lang} filePath={file.newPath} canEditCssColors={canEditCssColors} onUpdateCssColor={onUpdateCssColor} onOpenLine={onOpenLine} onOpenContextMenu={onOpenContextMenu} />
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
            {mode === 'staged' && onDiscardLines && (
              <button type="button" className="danger" onClick={discardSelected} disabled={busy} title="Unstage and permanently discard selected lines">
                <Trash2 size={15} />
                Discard selected
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
