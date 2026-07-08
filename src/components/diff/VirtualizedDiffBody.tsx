import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Plus, Trash2, X } from 'lucide-react'
import type { DiffFile, DiffHunk } from '../../shared/branchPilot'
import { DiffStatBadges } from '../DiffStatBadges'
import { DiffContextExpander } from './DiffContextExpander'
import { SplitDiffRowView, UnifiedDiffLineView } from './DiffLines'
import { buildUnifiedWordDiff } from './diffLineUtils'
import { getDiffRowWindow, type DiffRow, type DiffRowModel } from './diffRowModel'
import type { CssColorEditDraft } from './CssColorSwatch'
import type {
  DiffContextDirection,
  DiffDisplayMode,
  DiffLineContextMenuTarget,
  DiffLineEditorTarget,
  DiffMode
} from './diffViewTypes'

const OVERSCAN_PX = 320
const FALLBACK_VIEWPORT_HEIGHT = 520

/** Tracks the scroll container's scrollTop (rAF-coalesced) and viewport height. */
function useDiffScroll(resetKey: string) {
  const [containerElement, setContainerElement] = useState<HTMLDivElement | null>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(FALLBACK_VIEWPORT_HEIGHT)
  const scrollFrameRef = useRef<number | null>(null)
  const pendingScrollTopRef = useRef(0)

  useEffect(() => () => {
    if (scrollFrameRef.current !== null) cancelAnimationFrame(scrollFrameRef.current)
  }, [])

  useEffect(() => {
    if (!containerElement) return

    const updateViewportHeight = () => {
      setViewportHeight(containerElement.clientHeight || FALLBACK_VIEWPORT_HEIGHT)
    }

    updateViewportHeight()
    const resizeObserver = new ResizeObserver(updateViewportHeight)
    resizeObserver.observe(containerElement)
    return () => resizeObserver.disconnect()
  }, [containerElement])

  // Reset to the top whenever the underlying diff changes.
  useEffect(() => {
    if (containerElement) containerElement.scrollTop = 0
    setScrollTop(0)
  }, [containerElement, resetKey])

  const onScroll = (event: { currentTarget: HTMLDivElement }) => {
    pendingScrollTopRef.current = event.currentTarget.scrollTop
    if (scrollFrameRef.current !== null) return
    scrollFrameRef.current = requestAnimationFrame(() => {
      scrollFrameRef.current = null
      setScrollTop((current) => (current === pendingScrollTopRef.current ? current : pendingScrollTopRef.current))
    })
  }

  return { containerRef: setContainerElement, scrollTop, viewportHeight, onScroll }
}

export interface VirtualizedDiffBodyProps {
  className: string
  model: DiffRowModel
  displayMode: DiffDisplayMode
  resetKey: string
  mode?: DiffMode
  busy?: boolean
  onStageHunk?: (hunk: DiffHunk) => void
  onUnstageHunk?: (hunk: DiffHunk) => void
  onDiscardHunk?: (hunk: DiffHunk) => void
  onExpand: (file: DiffFile, hunk: DiffHunk, hunkIndex: number, direction: DiffContextDirection) => void
  onOpenLine?: (target: DiffLineEditorTarget) => void
  onOpenContextMenu?: (target: DiffLineContextMenuTarget) => void
  onUpdateCssColor?: (request: CssColorEditDraft) => Promise<void> | void
  selected: Set<string>
  selectedDiscardPatch?: string
  selectedLineStaged?: boolean
  onLineSelect: (key: string, shift: boolean) => void
  footer: ReactNode
}

/**
 * Renders a large diff by windowing the flat row model: only the rows in (or
 * near) the viewport are mounted, with leading/trailing spacers reserving the
 * height of the hidden rows so the native scrollbar stays accurate. Rows render
 * at their natural height in normal flow, so an imperfect height estimate can
 * only shift the scroll slightly — it can never overlap or hide a row.
 */
export function VirtualizedDiffBody({
  className,
  model,
  displayMode,
  resetKey,
  mode,
  busy,
  onStageHunk,
  onUnstageHunk,
  onDiscardHunk,
  onExpand,
  onOpenLine,
  onOpenContextMenu,
  onUpdateCssColor,
  selected,
  selectedDiscardPatch,
  selectedLineStaged,
  onLineSelect,
  footer
}: VirtualizedDiffBodyProps) {
  const { containerRef, scrollTop, viewportHeight, onScroll } = useDiffScroll(resetKey)

  // Word-diff highlighting for the unified view is computed per line group; the
  // split view computes it per row inside SplitDiffRowView.
  const unifiedWordDiff = useMemo(() => {
    const maps = new Map<string, Map<number, ReactNode>>()
    if (displayMode !== 'unified') return maps
    for (const group of model.groups) {
      maps.set(group.id, buildUnifiedWordDiff(group.lines, group.lang))
    }
    return maps
  }, [displayMode, model.groups])

  const window = useMemo(
    () => getDiffRowWindow(model, scrollTop, viewportHeight, OVERSCAN_PX),
    [model, scrollTop, viewportHeight]
  )
  const visibleRows = useMemo(
    () => model.rows.slice(window.startIndex, window.endIndex),
    [model.rows, window.endIndex, window.startIndex]
  )

  const renderRow = (row: DiffRow): ReactNode => {
    switch (row.kind) {
      case 'section-heading':
        return (
          <div className="diff-section-heading" key={row.id}>
            <div className="diff-section-title">
              <strong>{row.label}</strong>
              {row.description && <span>{row.description}</span>}
            </div>
            {row.stats && (
              <DiffStatBadges additions={row.stats.additions} deletions={row.stats.deletions} label={`${row.label} diff stats`} />
            )}
          </div>
        )
      case 'file-heading':
        return (
          <div className="diff-file-heading" key={row.id}>
            <strong>{row.newPath}</strong>
            {row.oldPath && row.oldPath !== row.newPath && <span>from {row.oldPath}</span>}
          </div>
        )
      case 'hunk-heading':
        return (
          <div className="diff-hunk-heading" key={row.id}>
            <code>{row.header}</code>
            <div className="diff-hunk-actions">
              {mode === 'unstaged' && onStageHunk && (
                <button type="button" className="hunk-icon-btn" title="Stage hunk" aria-label="Stage hunk" onClick={() => onStageHunk(row.hunk)} disabled={busy}>
                  <Plus size={15} />
                </button>
              )}
              {mode === 'unstaged' && onDiscardHunk && (
                <button type="button" className="hunk-icon-btn danger" title="Discard hunk" aria-label="Discard hunk" onClick={() => onDiscardHunk(row.hunk)} disabled={busy}>
                  <Trash2 size={15} />
                </button>
              )}
              {mode === 'staged' && onUnstageHunk && (
                <button type="button" className="hunk-icon-btn" title="Unstage hunk" aria-label="Unstage hunk" onClick={() => onUnstageHunk(row.hunk)} disabled={busy}>
                  <X size={15} />
                </button>
              )}
            </div>
          </div>
        )
      case 'expander':
        return (
          <DiffContextExpander
            key={row.id}
            direction={row.direction}
            onExpandContext={() => onExpand(row.file, row.hunk, row.hunkIndex, row.direction)}
          />
        )
      case 'u-line':
        return (
          <div className="diff-lines" key={row.id}>
            <UnifiedDiffLineView
              line={row.line}
              selectKey={row.selectKey}
              wordContent={unifiedWordDiff.get(row.group.id)?.get(row.lineIndex)}
              lang={row.group.lang}
              filePath={row.group.filePath}
              canEditCssColors={row.group.canEditCssColors}
              onUpdateCssColor={onUpdateCssColor}
              onOpenLine={onOpenLine}
              selectable={row.group.selectable}
              selected={selected}
              selectedDiscardPatch={selectedDiscardPatch}
              selectedLineStaged={selectedLineStaged}
              onLineSelect={onLineSelect}
              onOpenContextMenu={onOpenContextMenu}
            />
          </div>
        )
      case 's-row':
        return (
          <div className="split-diff-lines" key={row.id}>
            <SplitDiffRowView
              row={row.row}
              oldKey={row.oldKey}
              newKey={row.newKey}
              lang={row.group.lang}
              filePath={row.group.filePath}
              canEditCssColors={row.group.canEditCssColors}
              onUpdateCssColor={onUpdateCssColor}
              onOpenLine={onOpenLine}
              selected={selected}
              selectedDiscardPatch={selectedDiscardPatch}
              selectedLineStaged={selectedLineStaged}
              onLineSelect={onLineSelect}
              onOpenContextMenu={onOpenContextMenu}
            />
          </div>
        )
    }
  }

  return (
    <div className={className} ref={containerRef} onScroll={onScroll}>
      <div style={{ height: window.offsetBefore }} aria-hidden />
      {visibleRows.map(renderRow)}
      <div style={{ height: window.offsetAfter }} aria-hidden />
      {footer}
    </div>
  )
}
