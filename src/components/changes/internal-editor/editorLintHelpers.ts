import type { EditorDiagnostic } from './editorTypes'
import type { EditorLintRunState, EditorLintSettings } from './lintSettings'

export const JSON_RE = /\.(json|jsonc)$/i
const JSONC_RE = /\.jsonc$/i
const TSCONFIG_JSON_RE = /(^|\/)tsconfig[^/]*\.json$/i
const JSX_TSX_RE = /\.(jsx|tsx)$/i
const PLAIN_SCRIPT_RE = /\.(js|mjs|cjs|ts|mts|cts)$/i

export function lineColumnFromOffset(text: string, offset: number): { lineNumber: number; column: number } {
  const before = text.slice(0, Math.max(0, offset))
  const lines = before.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  return {
    lineNumber: lines.length,
    column: lines[lines.length - 1].length + 1
  }
}

export function utf8ByteOffset(text: string, charOffset: number): number {
  return new TextEncoder().encode(text.slice(0, Math.max(0, Math.min(charOffset, text.length)))).length
}

function parseJsonErrorLocation(message: string, text: string): { lineNumber: number; column: number } {
  const lineColumnMatch = message.match(/line\s+(\d+)\s+column\s+(\d+)/i)
  if (lineColumnMatch) {
    return {
      lineNumber: Number(lineColumnMatch[1]),
      column: Number(lineColumnMatch[2])
    }
  }

  const positionMatch = message.match(/position\s+(\d+)/i)
  if (positionMatch) {
    return lineColumnFromOffset(text, Number(positionMatch[1]))
  }

  return { lineNumber: 1, column: 1 }
}

export function isJsoncFilePath(filePath: string): boolean {
  const normalizedPath = filePath.replace(/\\/g, '/')
  return JSONC_RE.test(normalizedPath) || TSCONFIG_JSON_RE.test(normalizedPath)
}

export function stripJsonComments(text: string): string {
  let result = ''
  let state: 'code' | 'string' | 'line-comment' | 'block-comment' = 'code'
  let escaped = false

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    const next = text[index + 1] ?? ''

    if (state === 'line-comment') {
      if (char === '\n') {
        result += char
        state = 'code'
      } else {
        result += ' '
      }
      continue
    }

    if (state === 'block-comment') {
      if (char === '*' && next === '/') {
        result += '  '
        index += 1
        state = 'code'
      } else {
        result += char === '\n' ? '\n' : ' '
      }
      continue
    }

    if (state === 'string') {
      result += char
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === '"') {
        state = 'code'
      }
      continue
    }

    if (char === '"') {
      result += char
      state = 'string'
    } else if (char === '/' && next === '/') {
      result += '  '
      index += 1
      state = 'line-comment'
    } else if (char === '/' && next === '*') {
      result += '  '
      index += 1
      state = 'block-comment'
    } else {
      result += char
    }
  }

  return result
}

export function stripJsonTrailingCommas(text: string): string {
  let result = ''
  let state: 'code' | 'string' = 'code'
  let escaped = false

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]

    if (state === 'string') {
      result += char
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === '"') {
        state = 'code'
      }
      continue
    }

    if (char === '"') {
      result += char
      state = 'string'
      continue
    }

    if (char === ',') {
      let cursor = index + 1
      while (/\s/.test(text[cursor] ?? '')) cursor += 1
      if (text[cursor] === '}' || text[cursor] === ']') {
        result += ' '
      } else {
        result += char
      }
      continue
    }

    result += char
  }

  return result
}

function jsonLintText(filePath: string, text: string, settings: EditorLintSettings): { text: string; source: EditorDiagnostic['source'] } {
  const allowJsonc = isJsoncFilePath(filePath)
  let nextText = text

  if (allowJsonc && settings.allowJsonComments) nextText = stripJsonComments(nextText)
  if (allowJsonc && settings.allowJsonTrailingCommas) nextText = stripJsonTrailingCommas(nextText)

  return {
    text: nextText,
    source: allowJsonc ? 'JSONC' : 'JSON'
  }
}

function validateJsonText(filePath: string, text: string, settings: EditorLintSettings): EditorDiagnostic[] {
  if (!text.trim()) return []

  const prepared = jsonLintText(filePath, text, settings)

  try {
    JSON.parse(prepared.text)
    return []
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid JSON.'
    const location = parseJsonErrorLocation(message, prepared.text)
    return [{
      ...location,
      message,
      source: prepared.source
    }]
  }
}

export function parseEditorJsonText(filePath: string, text: string, settings: EditorLintSettings): { value: unknown; preparedText: string; source: EditorDiagnostic['source'] } {
  const prepared = jsonLintText(filePath, text, settings)
  return {
    value: JSON.parse(prepared.text) as unknown,
    preparedText: prepared.text,
    source: prepared.source
  }
}

function previousSignificantChar(text: string, index: number): string {
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const char = text[cursor]
    if (!/\s/.test(char)) return char
  }
  return ''
}

function slashStartsRegex(text: string, index: number): boolean {
  const previous = previousSignificantChar(text, index)
  return !previous || '([{=,:;!&|?+-*~^<>'.includes(previous)
}

function validateScriptStructure(text: string, options: { source: Extract<EditorDiagnostic['source'], 'JS/TS' | 'JSX/TSX'>; validateRegexLiterals: boolean }): EditorDiagnostic[] {
  type StackEntry = { expected: string; lineNumber: number; column: number }
  const stack: StackEntry[] = []
  const pairs: Record<string, string> = { '(': ')', '[': ']', '{': '}' }
  const closers = new Set(Object.values(pairs))
  let state: 'code' | 'line-comment' | 'block-comment' | 'string' | 'template' | 'regex' = 'code'
  let quote = ''
  let escaped = false
  let regexClass = false
  let stateLine = 1
  let stateColumn = 1
  let lineNumber = 1
  let column = 0

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    const next = text[index + 1] ?? ''
    column += 1

    if (state === 'line-comment') {
      if (char === '\n') state = 'code'
    } else if (state === 'block-comment') {
      if (char === '*' && next === '/') {
        index += 1
        column += 1
        state = 'code'
      }
    } else if (state === 'string') {
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === quote) {
        state = 'code'
      } else if (char === '\n') {
        return [{
          lineNumber: stateLine,
          column: stateColumn,
          source: options.source,
          message: 'Unterminated string literal.'
        }]
      }
    } else if (state === 'template') {
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === '`') {
        state = 'code'
      }
    } else if (state === 'regex') {
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === '[') {
        regexClass = true
      } else if (char === ']') {
        regexClass = false
      } else if (char === '/' && !regexClass) {
        state = 'code'
      } else if (char === '\n') {
        return [{
          lineNumber: stateLine,
          column: stateColumn,
          source: options.source,
          message: 'Unterminated regular expression literal.'
        }]
      }
    } else if (char === '/' && next === '/') {
      state = 'line-comment'
      index += 1
      column += 1
    } else if (char === '/' && next === '*') {
      state = 'block-comment'
      stateLine = lineNumber
      stateColumn = column
      index += 1
      column += 1
    } else if (options.validateRegexLiterals && char === '/' && slashStartsRegex(text, index)) {
      state = 'regex'
      stateLine = lineNumber
      stateColumn = column
      regexClass = false
    } else if (char === '"' || char === "'") {
      state = 'string'
      quote = char
      stateLine = lineNumber
      stateColumn = column
      escaped = false
    } else if (char === '`') {
      state = 'template'
      stateLine = lineNumber
      stateColumn = column
      escaped = false
    } else if (pairs[char]) {
      stack.push({ expected: pairs[char], lineNumber, column })
    } else if (closers.has(char)) {
      const opener = stack.pop()
      if (!opener || opener.expected !== char) {
        return [{
          lineNumber,
          column,
          source: options.source,
          message: `Unexpected "${char}".`
        }]
      }
    }

    if (char === '\n') {
      lineNumber += 1
      column = 0
    }
  }

  if (state === 'block-comment') {
    return [{ lineNumber: stateLine, column: stateColumn, source: options.source, message: 'Unterminated block comment.' }]
  }
  if (state === 'string') {
    return [{ lineNumber: stateLine, column: stateColumn, source: options.source, message: 'Unterminated string literal.' }]
  }
  if (state === 'template') {
    return [{ lineNumber: stateLine, column: stateColumn, source: options.source, message: 'Unterminated template literal.' }]
  }
  if (state === 'regex') {
    return [{ lineNumber: stateLine, column: stateColumn, source: options.source, message: 'Unterminated regular expression literal.' }]
  }

  const unclosed = stack.pop()
  if (unclosed) {
    return [{
      lineNumber: unclosed.lineNumber,
      column: unclosed.column,
      source: options.source,
      message: `Missing "${unclosed.expected}".`
    }]
  }

  return []
}

export function validateEditorText(filePath: string, text: string, settings: EditorLintSettings): EditorDiagnostic[] {
  if (settings.validateJson && JSON_RE.test(filePath)) return validateJsonText(filePath, text, settings)
  if (settings.validateJsxTsx && JSX_TSX_RE.test(filePath)) return validateScriptStructure(text, { source: 'JSX/TSX', validateRegexLiterals: false })
  if (settings.validateScripts && PLAIN_SCRIPT_RE.test(filePath)) {
    return validateScriptStructure(text, { source: 'JS/TS', validateRegexLiterals: settings.validateRegexLiterals })
  }
  return []
}

export function lintRulesEnabledForFile(filePath: string, settings: EditorLintSettings): boolean {
  if (JSON_RE.test(filePath)) return settings.validateJson
  if (JSX_TSX_RE.test(filePath)) return settings.validateJsxTsx
  if (PLAIN_SCRIPT_RE.test(filePath)) return settings.validateScripts
  return false
}

function lintCheckedAt(): string {
  return new Date().toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
}

export function lintStateFromDiagnostics(diagnostics: EditorDiagnostic[], filePath: string, source: 'Manual' | 'Auto'): EditorLintRunState {
  const checkedAt = lintCheckedAt()
  if (diagnostics.length > 0) {
    return {
      status: 'issues',
      message: `${source} lint found ${diagnostics.length} issue${diagnostics.length === 1 ? '' : 's'}.`,
      detail: `${filePath} · ${checkedAt}`
    }
  }

  return {
    status: 'clean',
    message: `${source} lint passed. No issues found.`,
    detail: `${filePath} · ${checkedAt}`
  }
}
