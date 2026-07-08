import { FileImage } from 'lucide-react'
import { normalizePickerColor, type SvgAnalysis, type SvgColorTarget } from './svgUtils'

export interface SvgEditorViewProps {
  selectedPath: string
  draftText: string
  textUnavailableMessage: string | null
  svgAnalysis: SvgAnalysis | null
  activeImagePreviewUrl: string
  updateSvgRootAttribute: (attr: string, value: string) => void
  updateSvgColorAttribute: (target: SvgColorTarget, value: string) => void
}

export function SvgEditorView({
  selectedPath,
  draftText,
  textUnavailableMessage,
  svgAnalysis,
  activeImagePreviewUrl,
  updateSvgRootAttribute,
  updateSvgColorAttribute
}: SvgEditorViewProps) {
  if (textUnavailableMessage) {
    return (
      <div className="changes-editor-mode-message">
        <FileImage size={28} />
        <strong>{textUnavailableMessage}</strong>
        <span>SVG text is not available for editing.</span>
      </div>
    )
  }

  if (!draftText.trim()) {
    return (
      <div className="changes-editor-mode-message">
        <FileImage size={28} />
        <strong>Empty SVG</strong>
        <span>Switch to SVG source to add content.</span>
      </div>
    )
  }

  if (svgAnalysis?.error) {
    return (
      <div className="changes-editor-mode-message danger-text">
        <FileImage size={28} />
        <strong>Invalid SVG</strong>
        <span>{svgAnalysis.error}</span>
      </div>
    )
  }

  return (
    <div className="changes-editor-svg-editor">
      <div className="changes-editor-svg-stage">
        {activeImagePreviewUrl ? (
          <img src={activeImagePreviewUrl} alt={selectedPath} />
        ) : (
          <div className="changes-editor-mode-message">
            <FileImage size={28} />
            <strong>SVG preview unavailable</strong>
            <span>Switch to SVG source to inspect the file.</span>
          </div>
        )}
        <span>{svgAnalysis?.elementCount ?? 0} elements</span>
      </div>
      <aside className="changes-editor-svg-controls">
        <section>
          <h4>Canvas</h4>
          <label>
            Width
            <input value={svgAnalysis?.width ?? ''} onChange={(event) => updateSvgRootAttribute('width', event.target.value)} placeholder="auto" />
          </label>
          <label>
            Height
            <input value={svgAnalysis?.height ?? ''} onChange={(event) => updateSvgRootAttribute('height', event.target.value)} placeholder="auto" />
          </label>
          <label className="wide">
            ViewBox
            <input value={svgAnalysis?.viewBox ?? ''} onChange={(event) => updateSvgRootAttribute('viewBox', event.target.value)} placeholder="0 0 48 48" />
          </label>
        </section>
        <section>
          <h4>Colors</h4>
          {svgAnalysis && svgAnalysis.colors.length > 0 ? (
            <div className="changes-editor-svg-color-list">
              {svgAnalysis.colors.map((target) => {
                const pickerColor = normalizePickerColor(target.value)
                const key = `${target.index}-${target.attr}-${target.label}`

                return (
                  <div className="changes-editor-svg-color-row" key={key}>
                    <div>
                      <strong>{target.label}</strong>
                      <span>{target.element}.{target.attr}</span>
                    </div>
                    <input
                      type="color"
                      value={pickerColor ?? '#000000'}
                      disabled={!pickerColor}
                      onChange={(event) => updateSvgColorAttribute(target, event.target.value)}
                      aria-label={`Pick ${target.attr} for ${target.label}`}
                    />
                    <input
                      value={target.value}
                      onChange={(event) => updateSvgColorAttribute(target, event.target.value)}
                      aria-label={`${target.attr} value for ${target.label}`}
                    />
                  </div>
                )
              })}
            </div>
          ) : (
            <p>No direct SVG colors found.</p>
          )}
        </section>
      </aside>
    </div>
  )
}
