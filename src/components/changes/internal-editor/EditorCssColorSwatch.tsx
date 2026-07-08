import { useRef, useState, type CSSProperties } from 'react'
import {
  openCssColorPicker,
  rewriteCssColorValue,
  type CssColorEditDraft
} from '../../diff/CssColorSwatch'
import type { EditorCssColorToken } from './editorTypes'

export function EditorCssColorSwatch({
  filePath,
  token,
  onUpdateCssColor
}: {
  filePath: string
  token: EditorCssColorToken
  onUpdateCssColor: (request: CssColorEditDraft) => Promise<void> | void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [pending, setPending] = useState(false)
  const slotStyle = {
    '--css-color-preview': token.previewValue,
    '--editor-color-line': String(token.renderLineIndex),
    '--editor-color-column': String(Math.max(0, token.columnStart - 2))
  } as CSSProperties

  const openPicker = () => {
    if (!pending) openCssColorPicker(inputRef.current)
  }

  const updateColor = async (inputValue: string) => {
    const newValue = rewriteCssColorValue(token.value, inputValue)
    if (newValue === token.value) return

    setPending(true)
    try {
      await onUpdateCssColor({
        filePath,
        lineNumber: token.lineNumber,
        columnStart: token.columnStart,
        oldValue: token.value,
        newValue
      })
    } finally {
      setPending(false)
    }
  }

  return (
    <span className="changes-editor-color-swatch-slot" style={slotStyle} onMouseDown={(event) => event.stopPropagation()}>
      <span
        className={pending ? 'css-color-swatch pending' : 'css-color-swatch'}
        role="button"
        tabIndex={0}
        aria-label={`Change ${token.value}`}
        title={`Change ${token.value}`}
        onClick={(event) => {
          event.stopPropagation()
          openPicker()
        }}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return
          event.preventDefault()
          event.stopPropagation()
          openPicker()
        }}
      >
        <input
          ref={inputRef}
          className="css-color-picker-input"
          type="color"
          value={token.inputValue}
          aria-hidden="true"
          tabIndex={-1}
          onChange={(event) => void updateColor(event.currentTarget.value)}
        />
      </span>
    </span>
  )
}
