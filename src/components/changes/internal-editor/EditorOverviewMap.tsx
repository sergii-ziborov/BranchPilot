import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'
import { clamp } from './editorPrimitives'
import type { EditorMinimapLine, EditorOverviewMarker } from './editorTypes'

interface EditorOverviewMapProps {
  overviewViewportRef: { current: HTMLDivElement | null }
  editorOverviewViewport: { top: number; height: number }
  editorMinimapLines: EditorMinimapLine[]
  editorOverviewMarkers: EditorOverviewMarker[]
  draftLineCount: number
  activeEditorLineBase: number
  activeSearchLineNumber: number | null
  beginEditorOverviewDrag: (event: ReactPointerEvent<HTMLDivElement>) => void
  dragEditorOverview: (event: ReactPointerEvent<HTMLDivElement>) => void
  endEditorOverviewDrag: (event: ReactPointerEvent<HTMLDivElement>) => void
  focusEditorPosition: (lineNumber: number) => void
}

export function EditorOverviewMap({
  overviewViewportRef,
  editorOverviewViewport,
  editorMinimapLines,
  editorOverviewMarkers,
  draftLineCount,
  activeEditorLineBase,
  activeSearchLineNumber,
  beginEditorOverviewDrag,
  dragEditorOverview,
  endEditorOverviewDrag,
  focusEditorPosition
}: EditorOverviewMapProps) {
  return (
    <div
      className="changes-editor-overview"
      aria-label="File overview map"
      onPointerDown={beginEditorOverviewDrag}
      onPointerMove={dragEditorOverview}
      onPointerUp={endEditorOverviewDrag}
      onPointerCancel={endEditorOverviewDrag}
    >
      <div
        ref={overviewViewportRef}
        className="changes-editor-overview-viewport"
        style={{
          top: `${editorOverviewViewport.top}%`,
          height: `${editorOverviewViewport.height}%`
        } as CSSProperties}
      />
      <div className="changes-editor-overview-lines" aria-hidden="true">
        {editorMinimapLines.map((line) => {
          const denominator = Math.max(1, draftLineCount - 1)
          const top = clamp(((line.lineNumber - activeEditorLineBase) / denominator) * 100, 0, 100)

          return (
            <span
              className={`changes-editor-minimap-line minimap-${line.kind}`}
              style={{
                top: `${top}%`,
                width: `${line.widthPercent}%`
              } as CSSProperties}
              key={`${line.lineNumber}-${line.kind}`}
            />
          )
        })}
      </div>
      {editorOverviewMarkers.map((marker, index) => {
        const denominator = Math.max(1, draftLineCount - 1)
        const top = clamp(((marker.lineNumber - activeEditorLineBase) / denominator) * 100, 0, 100)

        return (
          <button
            type="button"
            className={[
              'changes-editor-overview-marker',
              `marker-${marker.kind}`,
              activeSearchLineNumber === marker.lineNumber && marker.kind === 'search' ? 'is-active' : ''
            ].filter(Boolean).join(' ')}
            style={{ top: `${top}%` } as CSSProperties}
            key={`${marker.kind}-${marker.lineNumber}-${index}`}
            title={marker.title}
            aria-label={marker.title}
            onClick={() => focusEditorPosition(marker.lineNumber)}
          />
        )
      })}
    </div>
  )
}
