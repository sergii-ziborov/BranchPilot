export interface SvgColorTarget {
  index: number
  element: string
  label: string
  attr: string
  value: string
}

export interface SvgAnalysis {
  error: string | null
  width: string
  height: string
  viewBox: string
  elementCount: number
  colors: SvgColorTarget[]
}

export function safeSvgDataUrl(svgText: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgText)}`
}

export function beautifyMarkupText(text: string): string {
  const compact = text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/>\s+</g, '>\n<')
  const tokens = compact.split('\n').map((line) => line.trim()).filter(Boolean)
  let indent = 0
  const lines: string[] = []

  for (const token of tokens) {
    const closing = /^<\//.test(token)
    const selfClosing = /^<!|^<\?/.test(token) || /\/>$/.test(token)
    const opens = /^<[^/!?\s>]+(?:\s|>)/.test(token) && !selfClosing && !/<\/[^>]+>$/.test(token)

    if (closing) indent = Math.max(0, indent - 1)
    lines.push(`${'  '.repeat(indent)}${token}`)
    if (opens) indent += 1
  }

  return `${lines.join('\n')}\n`
}

export function parseSvgDocument(text: string): { document: XMLDocument | null; error: string | null } {
  try {
    const document = new DOMParser().parseFromString(text, 'image/svg+xml')
    const parseError = document.querySelector('parsererror')
    if (parseError) {
      return { document: null, error: parseError.textContent?.trim() || 'Invalid SVG.' }
    }
    if (document.documentElement.tagName.toLowerCase() !== 'svg') {
      return { document: null, error: 'Root element is not <svg>.' }
    }
    return { document, error: null }
  } catch (error) {
    return { document: null, error: error instanceof Error ? error.message : 'Invalid SVG.' }
  }
}

export function serializeSvgDocument(document: XMLDocument): string {
  return beautifyMarkupText(new XMLSerializer().serializeToString(document.documentElement))
}

export function svgElements(document: XMLDocument): Element[] {
  const root = document.documentElement
  return [root, ...Array.from(root.querySelectorAll('*'))]
}

export function svgElementLabel(element: Element, index: number): string {
  const id = element.getAttribute('id')
  const className = element.getAttribute('class')
  if (id) return `#${id}`
  if (className) return `.${className.split(/\s+/)[0]}`
  return `${element.tagName.toLowerCase()} ${index}`
}

export function analyzeSvgText(text: string): SvgAnalysis {
  const parsed = parseSvgDocument(text)
  if (!parsed.document) {
    return {
      error: parsed.error,
      width: '',
      height: '',
      viewBox: '',
      elementCount: 0,
      colors: []
    }
  }

  const root = parsed.document.documentElement
  const colors: SvgColorTarget[] = []

  svgElements(parsed.document).forEach((element, index) => {
    for (const attr of ['fill', 'stroke', 'stop-color']) {
      const value = element.getAttribute(attr)
      if (!value || value === 'none') continue
      colors.push({
        index,
        element: element.tagName.toLowerCase(),
        label: svgElementLabel(element, index),
        attr,
        value
      })
    }
  })

  return {
    error: null,
    width: root.getAttribute('width') ?? '',
    height: root.getAttribute('height') ?? '',
    viewBox: root.getAttribute('viewBox') ?? '',
    elementCount: svgElements(parsed.document).length,
    colors: colors.slice(0, 80)
  }
}

export function normalizePickerColor(value: string): string | null {
  const raw = value.trim()
  if (/^#[0-9a-f]{6}$/i.test(raw)) return raw
  if (/^#[0-9a-f]{3}$/i.test(raw)) {
    return `#${raw[1]}${raw[1]}${raw[2]}${raw[2]}${raw[3]}${raw[3]}`
  }
  return null
}
