import { useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { highlight } from '../../lib/highlight'

export interface CssColorEditDraft {
  filePath: string
  lineNumber: number
  columnStart: number
  oldValue: string
  newValue: string
}

export type CssColorUpdateHandler = (request: CssColorEditDraft) => Promise<void> | void

export interface CssColorToken {
  value: string
  columnStart: number
  inputValue: string
  previewValue: string
}

const CSS_COLOR_FILE_RE = /\.(?:css|scss|sass|less|pcss|postcss)$/i
const CSS_COLOR_LITERAL_RE = /#[\da-fA-F]{3,8}\b|\brgba?\(\s*[^()\r\n]*\)/g

export function isCssColorFile(filePath: string): boolean {
  return CSS_COLOR_FILE_RE.test(filePath)
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)))
}

function toHexByte(value: number): string {
  return clampByte(value).toString(16).padStart(2, '0')
}

function expandHexColor(value: string): { inputValue: string; previewValue: string; alphaHex?: string } | null {
  const raw = value.slice(1)

  if (![3, 4, 6, 8].includes(raw.length)) return null

  const expanded = raw.length <= 4
    ? raw.split('').map((char) => `${char}${char}`).join('')
    : raw
  const inputValue = `#${expanded.slice(0, 6).toLowerCase()}`
  const alphaHex = expanded.length === 8 ? expanded.slice(6, 8).toLowerCase() : undefined

  if (!alphaHex) {
    return { inputValue, previewValue: inputValue }
  }

  const alpha = Number.parseInt(alphaHex, 16) / 255
  const red = Number.parseInt(expanded.slice(0, 2), 16)
  const green = Number.parseInt(expanded.slice(2, 4), 16)
  const blue = Number.parseInt(expanded.slice(4, 6), 16)

  return {
    inputValue,
    previewValue: `rgba(${red}, ${green}, ${blue}, ${Number(alpha.toFixed(3))})`,
    alphaHex
  }
}

function parseCssChannel(value: string): number | null {
  const trimmed = value.trim()
  const percent = trimmed.endsWith('%')
  const numeric = Number.parseFloat(percent ? trimmed.slice(0, -1) : trimmed)

  if (!Number.isFinite(numeric)) return null
  return percent ? clampByte((numeric / 100) * 255) : clampByte(numeric)
}

function parseRgbColor(value: string): { inputValue: string; previewValue: string } | null {
  const body = value.match(/^rgba?\((.*)\)$/i)?.[1]
  if (!body) return null

  const normalized = body.includes(',')
    ? body.split(',').map((part) => part.trim())
    : body.replace(/\s*\/\s*/, ' / ').split(/\s+/).filter(Boolean)
  const slashIndex = normalized.indexOf('/')
  const channels = (slashIndex >= 0 ? normalized.slice(0, slashIndex) : normalized).slice(0, 3)
  const alpha = body.includes(',')
    ? normalized[3]
    : slashIndex >= 0
      ? normalized[slashIndex + 1]
      : undefined

  if (channels.length !== 3) return null

  const rgb = channels.map(parseCssChannel)
  if (rgb.some((channel) => channel === null)) return null

  const [red, green, blue] = rgb as [number, number, number]
  const inputValue = `#${toHexByte(red)}${toHexByte(green)}${toHexByte(blue)}`
  const previewValue = alpha ? `rgba(${red}, ${green}, ${blue}, ${alpha.trim()})` : `rgb(${red}, ${green}, ${blue})`

  return { inputValue, previewValue }
}

function parseCssColorToken(value: string): Pick<CssColorToken, 'inputValue' | 'previewValue'> | null {
  return value.startsWith('#') ? expandHexColor(value) : parseRgbColor(value)
}

export function findCssColorTokens(content: string): CssColorToken[] {
  const tokens: CssColorToken[] = []
  const re = new RegExp(CSS_COLOR_LITERAL_RE)
  let match: RegExpExecArray | null

  while ((match = re.exec(content)) !== null) {
    const value = match[0]
    const parsed = parseCssColorToken(value)
    if (!parsed) continue
    tokens.push({
      value,
      columnStart: match.index,
      inputValue: parsed.inputValue,
      previewValue: parsed.previewValue
    })
  }

  return tokens
}

function rgbFromHex(inputValue: string): [number, number, number] {
  return [
    Number.parseInt(inputValue.slice(1, 3), 16),
    Number.parseInt(inputValue.slice(3, 5), 16),
    Number.parseInt(inputValue.slice(5, 7), 16)
  ]
}

export function rewriteCssColorValue(oldValue: string, inputValue: string): string {
  const normalizedHex = inputValue.toLowerCase()
  const [red, green, blue] = rgbFromHex(normalizedHex)

  if (oldValue.startsWith('#')) {
    const expanded = expandHexColor(oldValue)
    return expanded?.alphaHex ? `${normalizedHex}${expanded.alphaHex}` : normalizedHex
  }

  const body = oldValue.match(/^rgba?\((.*)\)$/i)?.[1] ?? ''
  const commaAlpha = body.split(',').slice(3).join(',').trim()
  const slashAlpha = body.match(/\/\s*(.+)$/)?.[1]?.trim()
  const alpha = commaAlpha || slashAlpha

  if (/^rgba\(/i.test(oldValue) && alpha) {
    return `rgba(${red}, ${green}, ${blue}, ${alpha})`
  }

  return `rgb(${red}, ${green}, ${blue})`
}

function CssColorSwatch({
  token,
  filePath,
  lineNumber,
  onUpdateCssColor
}: {
  token: CssColorToken
  filePath: string
  lineNumber: number
  onUpdateCssColor: CssColorUpdateHandler
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [pending, setPending] = useState(false)
  const style = { '--css-color-preview': token.previewValue } as CSSProperties

  const openPicker = () => {
    if (!pending) inputRef.current?.click()
  }

  const updateColor = async (inputValue: string) => {
    const newValue = rewriteCssColorValue(token.value, inputValue)
    if (newValue === token.value) return

    setPending(true)
    try {
      await onUpdateCssColor({
        filePath,
        lineNumber,
        columnStart: token.columnStart,
        oldValue: token.value,
        newValue
      })
    } finally {
      setPending(false)
    }
  }

  return (
    <span className="css-color-control" onMouseDown={(event) => event.stopPropagation()}>
      <span
        className={pending ? 'css-color-swatch pending' : 'css-color-swatch'}
        role="button"
        tabIndex={0}
        aria-label={`Change ${token.value}`}
        title={`Change ${token.value}`}
        style={style}
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

export function renderCssColorizedContent({
  content,
  lang,
  filePath,
  lineNumber,
  canEditCssColors,
  onUpdateCssColor
}: {
  content: string
  lang: string
  filePath: string
  lineNumber?: number
  canEditCssColors?: boolean
  onUpdateCssColor?: CssColorUpdateHandler
}): ReactNode {
  if (!canEditCssColors || !lineNumber || !onUpdateCssColor || !isCssColorFile(filePath)) {
    return highlight(content, lang)
  }

  const tokens = findCssColorTokens(content)
  if (tokens.length === 0) return highlight(content, lang)

  const nodes: ReactNode[] = []
  let last = 0

  tokens.forEach((token, index) => {
    if (token.columnStart > last) {
      nodes.push(<span key={`text-${index}`}>{highlight(content.slice(last, token.columnStart), lang)}</span>)
    }
    nodes.push(
      <CssColorSwatch
        key={`swatch-${index}-${token.columnStart}`}
        token={token}
        filePath={filePath}
        lineNumber={lineNumber}
        onUpdateCssColor={onUpdateCssColor}
      />
    )
    nodes.push(<span key={`value-${index}`}>{highlight(token.value, lang)}</span>)
    last = token.columnStart + token.value.length
  })

  if (last < content.length) {
    nodes.push(<span key="tail">{highlight(content.slice(last), lang)}</span>)
  }

  return nodes
}
