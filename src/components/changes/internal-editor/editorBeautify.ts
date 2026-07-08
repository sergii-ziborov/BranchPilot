import { JSON_RE, isJsoncFilePath, stripJsonComments, stripJsonTrailingCommas } from './editorLintHelpers'
import { beautifyMarkupText } from './svgUtils'

export function normalizeTextForEditor(text: string): string {
  return `${text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/[ \t]+$/gm, '').trimEnd()}\n`
}

export function beautifyPreservesTokens(before: string, after: string): boolean {
  return before.replace(/\s+/g, '') === after.replace(/\s+/g, '')
}

function beautifyJsonText(text: string): string {
  return `${JSON.stringify(JSON.parse(text), null, 2)}\n`
}

type JsoncTokenKind = 'punctuation' | 'string' | 'literal' | 'line-comment' | 'block-comment'

interface JsoncToken {
  kind: JsoncTokenKind
  value: string
  leadingNewlines: number
}

const JSONC_PUNCTUATION = new Set(['{', '}', '[', ']', ':', ','])

function tokenizeJsonc(text: string): JsoncToken[] {
  const tokens: JsoncToken[] = []
  let index = 0
  let leadingNewlines = 0

  while (index < text.length) {
    const char = text[index]
    const next = text[index + 1] ?? ''

    if (char === '\r') {
      leadingNewlines += 1
      index += next === '\n' ? 2 : 1
      continue
    }
    if (char === '\n') {
      leadingNewlines += 1
      index += 1
      continue
    }
    if (/\s/.test(char)) {
      index += 1
      continue
    }

    const tokenLeadingNewlines = leadingNewlines
    leadingNewlines = 0

    if (char === '"') {
      let cursor = index + 1
      let escaped = false
      while (cursor < text.length) {
        const tokenChar = text[cursor]
        cursor += 1
        if (escaped) {
          escaped = false
        } else if (tokenChar === '\\') {
          escaped = true
        } else if (tokenChar === '"') {
          break
        }
      }
      tokens.push({ kind: 'string', value: text.slice(index, cursor), leadingNewlines: tokenLeadingNewlines })
      index = cursor
      continue
    }

    if (char === '/' && next === '/') {
      let cursor = index + 2
      while (cursor < text.length && text[cursor] !== '\n' && text[cursor] !== '\r') cursor += 1
      tokens.push({ kind: 'line-comment', value: text.slice(index, cursor).trimEnd(), leadingNewlines: tokenLeadingNewlines })
      index = cursor
      continue
    }

    if (char === '/' && next === '*') {
      let cursor = index + 2
      while (cursor < text.length && !(text[cursor] === '*' && text[cursor + 1] === '/')) cursor += 1
      cursor = Math.min(text.length, cursor + (cursor < text.length ? 2 : 0))
      tokens.push({ kind: 'block-comment', value: text.slice(index, cursor), leadingNewlines: tokenLeadingNewlines })
      index = cursor
      continue
    }

    if (JSONC_PUNCTUATION.has(char)) {
      tokens.push({ kind: 'punctuation', value: char, leadingNewlines: tokenLeadingNewlines })
      index += 1
      continue
    }

    let cursor = index + 1
    while (cursor < text.length) {
      const tokenChar = text[cursor]
      const tokenNext = text[cursor + 1] ?? ''
      if (/\s/.test(tokenChar) || JSONC_PUNCTUATION.has(tokenChar) || (tokenChar === '/' && (tokenNext === '/' || tokenNext === '*'))) break
      cursor += 1
    }
    tokens.push({ kind: 'literal', value: text.slice(index, cursor), leadingNewlines: tokenLeadingNewlines })
    index = cursor
  }

  return tokens
}

function validateJsoncForBeautify(text: string) {
  JSON.parse(stripJsonTrailingCommas(stripJsonComments(text)))
}

export function beautifyJsoncText(text: string): string {
  validateJsoncForBeautify(text)

  const tokens = tokenizeJsonc(text)
  const lines: string[] = []
  let currentLine = ''
  let indent = 0

  const indentText = () => '  '.repeat(Math.max(0, indent))
  const append = (value: string) => {
    if (!currentLine) currentLine = indentText()
    currentLine += value
  }
  const appendSpace = () => {
    if (currentLine && !/\s$/.test(currentLine)) currentLine += ' '
  }
  const pushLine = () => {
    lines.push(currentLine.trimEnd())
    currentLine = ''
  }
  const pushBlankLine = () => {
    if (lines.length > 0 && lines[lines.length - 1] !== '') lines.push('')
  }
  const appendMultiline = (value: string) => {
    const parts = value.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
    append(parts[0])
    for (let index = 1; index < parts.length; index += 1) {
      pushLine()
      currentLine = `${indentText()}${parts[index].replace(/^[ \t]+/, '')}`
    }
  }

  tokens.forEach((token, index) => {
    const nextToken = tokens[index + 1]
    if (!currentLine && token.leadingNewlines > 1) pushBlankLine()

    if (token.kind === 'punctuation') {
      if (token.value === '{' || token.value === '[') {
        append(token.value)
        indent += 1
        pushLine()
      } else if (token.value === '}' || token.value === ']') {
        indent = Math.max(0, indent - 1)
        if (currentLine.trim()) pushLine()
        append(token.value)
      } else if (token.value === ':') {
        append(':')
        appendSpace()
      } else if (token.value === ',') {
        append(',')
        if (nextToken?.kind === 'line-comment' && nextToken.leadingNewlines === 0) {
          appendSpace()
        } else {
          pushLine()
        }
      }
      return
    }

    if (token.kind === 'line-comment') {
      if (currentLine.trim()) appendSpace()
      append(token.value)
      pushLine()
      return
    }

    if (token.kind === 'block-comment') {
      if (currentLine.trim()) appendSpace()
      appendMultiline(token.value)
      if (nextToken?.value !== ',' && nextToken?.leadingNewlines === 0) appendSpace()
      if (nextToken?.value !== ',' && nextToken?.leadingNewlines !== 0) pushLine()
      return
    }

    append(token.value)
  })

  if (currentLine.trim()) pushLine()
  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n')}\n`
}

function beautifyCssText(text: string): string {
  let result = ''
  let indent = 0
  let quote = ''
  let escaped = false

  const writeIndent = () => {
    result = result.trimEnd()
    result += `\n${'  '.repeat(Math.max(0, indent))}`
  }

  for (const char of text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')) {
    if (quote) {
      result += char
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === quote) {
        quote = ''
      }
      continue
    }

    if (char === '"' || char === "'") {
      quote = char
      result += char
    } else if (char === '{') {
      result = `${result.trimEnd()} {`
      indent += 1
      writeIndent()
    } else if (char === '}') {
      indent = Math.max(0, indent - 1)
      writeIndent()
      result += '}'
      writeIndent()
    } else if (char === ';') {
      result = `${result.trimEnd()};`
      writeIndent()
    } else if (char === '\n') {
      writeIndent()
    } else {
      result += char
    }
  }

  return normalizeTextForEditor(result.replace(/\n{3,}/g, '\n\n'))
}

function beautifyMarkdownText(text: string): string {
  return normalizeTextForEditor(text.replace(/\n{4,}/g, '\n\n\n'))
}

function lineSyntaxDelta(line: string): { before: number; after: number } {
  let after = 0
  let quote = ''
  let escaped = false
  let blockComment = false
  const trimmed = line.trim()
  const leadingSyntaxClosers = trimmed.match(/^[)\]}]+/)?.[0].length ?? 0
  const closesJsxTag = /^<\/[^>]+>$/.test(trimmed)
  const before = leadingSyntaxClosers + (closesJsxTag ? 1 : 0)

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    const next = line[index + 1]

    if (blockComment) {
      if (char === '*' && next === '/') {
        blockComment = false
        index += 1
      }
      continue
    }

    if (quote) {
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === quote) {
        quote = ''
      }
      continue
    }

    if (char === '/' && next === '/') {
      break
    }
    if (char === '/' && next === '*') {
      blockComment = true
      index += 1
      continue
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char
      continue
    }
    if (char === '{' || char === '[' || char === '(') after += 1
    if (char === '}' || char === ']' || char === ')') after -= 1
  }

  after += leadingSyntaxClosers

  const opensJsxTag = /^<[^/!][^>]*[^/]?>$/.test(trimmed) && !/<\/[^>]+>$/.test(trimmed)
  if (opensJsxTag) after += 1

  return { before, after }
}

type ScriptMultilineState = 'none' | 'block-comment' | 'template'

function nextScriptMultilineState(line: string, initialState: ScriptMultilineState): ScriptMultilineState {
  let state = initialState
  let quote = state === 'template' ? '`' : ''
  let escaped = false

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    const next = line[index + 1]

    if (state === 'block-comment') {
      if (char === '*' && next === '/') {
        state = 'none'
        index += 1
      }
      continue
    }

    if (quote) {
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === quote) {
        quote = ''
        state = 'none'
      }
      continue
    }

    if (char === '/' && next === '/') break
    if (char === '/' && next === '*') {
      state = 'block-comment'
      index += 1
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      continue
    }
    if (char === '`') {
      quote = '`'
      state = 'template'
    }
  }

  return state
}

function beautifyScriptText(text: string): string {
  const lines = normalizeTextForEditor(text).split('\n')
  if (lines[lines.length - 1] === '') lines.pop()

  let indent = 0
  const nextLines: string[] = []
  let blankRun = 0
  let multilineState: ScriptMultilineState = 'none'

  for (const rawLine of lines) {
    const rawLineTrimmedRight = rawLine.replace(/[ \t]+$/, '')
    if (multilineState !== 'none') {
      nextLines.push(rawLineTrimmedRight)
      multilineState = nextScriptMultilineState(rawLineTrimmedRight, multilineState)
      continue
    }

    const trimmed = rawLine.trim()
    if (!trimmed) {
      blankRun += 1
      if (blankRun <= 1) nextLines.push('')
      continue
    }

    blankRun = 0
    const delta = lineSyntaxDelta(trimmed)
    indent = Math.max(0, indent - delta.before)
    nextLines.push(`${'  '.repeat(indent)}${trimmed}`)
    indent = Math.max(0, indent + delta.after)
    multilineState = nextScriptMultilineState(trimmed, 'none')
  }

  return `${nextLines.join('\n').replace(/\n{3,}/g, '\n\n')}\n`
}

export function beautifyTextLocally(filePath: string, text: string): string {
  if (JSON_RE.test(filePath)) return isJsoncFilePath(filePath) ? beautifyJsoncText(text) : beautifyJsonText(text)
  if (/\.(m?[jt]sx?|cts|mts)$/i.test(filePath)) return beautifyScriptText(text)
  if (/\.(css|scss|less)$/i.test(filePath)) return beautifyCssText(text)
  if (/\.(html?|xml|svg)$/i.test(filePath)) return beautifyMarkupText(text)
  if (/\.(md|markdown|ya?ml|toml|ini|env|txt)$/i.test(filePath)) return beautifyMarkdownText(text)
  return normalizeTextForEditor(text)
}
