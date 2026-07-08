import type { ReactNode } from 'react'

export interface JsonTreeNode {
  keyName?: string
  value: unknown
  depth: number
  path: string
  lineNumber?: number
  expandable: boolean
  childCount: number
}

export interface JsonEditCell {
  path: string
  kind: 'string' | 'number' | 'boolean'
  value: string
}

export function jsonChildEntries(value: unknown): Array<[string, unknown]> {
  if (value === null || typeof value !== 'object') return []
  if (Array.isArray(value)) return value.map((entry, index) => [String(index), entry])
  return Object.entries(value as Record<string, unknown>)
}

export function jsonPointerChild(parentPath: string, key: string): string {
  const escaped = key.replace(/~/g, '~0').replace(/\//g, '~1')
  return `${parentPath}/${escaped}`
}

export function jsonPointerParts(path: string): string[] {
  if (!path) return []
  return path
    .split('/')
    .slice(1)
    .map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~'))
}

export function jsonEditableKind(value: unknown): JsonEditCell['kind'] | null {
  if (typeof value === 'string') return 'string'
  if (typeof value === 'number') return 'number'
  if (typeof value === 'boolean') return 'boolean'
  return null
}

export function jsonEditInitialValue(value: unknown): string {
  return String(value)
}

export function parseJsonEditValue(kind: JsonEditCell['kind'], rawValue: string): unknown {
  if (kind === 'string') return rawValue
  if (kind === 'boolean') return rawValue === 'true'

  const value = Number(rawValue.trim())
  if (!Number.isFinite(value)) {
    throw new Error('Number value is invalid.')
  }
  return value
}

export function updateJsonValueAtPath(rootValue: unknown, path: string, nextValue: unknown): unknown {
  const parts = jsonPointerParts(path)
  if (parts.length === 0) return nextValue

  const update = (currentValue: unknown, [part, ...rest]: string[]): unknown => {
    if (part === undefined) return nextValue

    if (Array.isArray(currentValue)) {
      const index = Number(part)
      if (!Number.isInteger(index) || index < 0 || index >= currentValue.length) {
        throw new Error('JSON array path no longer exists.')
      }
      const nextArray = [...currentValue]
      nextArray[index] = update(nextArray[index], rest)
      return nextArray
    }

    if (currentValue && typeof currentValue === 'object') {
      const currentObject = currentValue as Record<string, unknown>
      if (!(part in currentObject)) {
        throw new Error('JSON object path no longer exists.')
      }
      return {
        ...currentObject,
        [part]: update(currentObject[part], rest)
      }
    }

    throw new Error('JSON path no longer exists.')
  }

  return update(rootValue, parts)
}

export function collectJsonExpandablePaths(value: unknown, path = ''): string[] {
  const children = jsonChildEntries(value)
  if (children.length === 0) return []

  return [
    path,
    ...children.flatMap(([key, entry]) => collectJsonExpandablePaths(entry, jsonPointerChild(path, key)))
  ]
}

export function buildJsonLineNumberMap(text: string): Map<string, number> {
  const lineNumbers = new Map<string, number>()
  let index = 0
  let lineNumber = 1

  const current = () => text[index] ?? ''
  const advance = () => {
    if (text[index] === '\n') lineNumber += 1
    index += 1
  }
  const skipWhitespace = () => {
    while (/\s/.test(current())) advance()
  }
  const parseString = () => {
    let value = ''
    if (current() !== '"') return value
    advance()
    while (index < text.length) {
      const char = current()
      if (char === '\\') {
        advance()
        if (index < text.length) {
          value += current()
          advance()
        }
        continue
      }
      if (char === '"') {
        advance()
        return value
      }
      value += char
      advance()
    }
    return value
  }
  const parseLiteral = () => {
    while (index < text.length && !/[\s,\]}]/.test(current())) advance()
  }
  const parseValue = (path: string, preferredLineNumber?: number) => {
    skipWhitespace()
    lineNumbers.set(path, preferredLineNumber ?? lineNumber)
    const char = current()

    if (char === '{') {
      parseObject(path)
    } else if (char === '[') {
      parseArray(path)
    } else if (char === '"') {
      parseString()
    } else {
      parseLiteral()
    }
  }
  const parseObject = (path: string) => {
    advance()
    skipWhitespace()
    while (index < text.length && current() !== '}') {
      const keyLineNumber = lineNumber
      const key = parseString()
      skipWhitespace()
      if (current() === ':') advance()
      parseValue(jsonPointerChild(path, key), keyLineNumber)
      skipWhitespace()
      if (current() === ',') {
        advance()
        skipWhitespace()
      }
    }
    if (current() === '}') advance()
  }
  const parseArray = (path: string) => {
    advance()
    skipWhitespace()
    let itemIndex = 0
    while (index < text.length && current() !== ']') {
      parseValue(jsonPointerChild(path, String(itemIndex)))
      itemIndex += 1
      skipWhitespace()
      if (current() === ',') {
        advance()
        skipWhitespace()
      }
    }
    if (current() === ']') advance()
  }

  try {
    parseValue('')
  } catch {
    return new Map()
  }

  return lineNumbers
}

export function flattenJsonTree(value: unknown, collapsedPaths: Set<string>, lineNumbers: Map<string, number>, depth = 0, keyName?: string, path = ''): JsonTreeNode[] {
  const children = jsonChildEntries(value)
  const node: JsonTreeNode = {
    keyName,
    value,
    depth,
    path,
    lineNumber: lineNumbers.get(path),
    expandable: children.length > 0,
    childCount: children.length
  }
  if (children.length === 0 || collapsedPaths.has(path)) return [node]

  return [
    node,
    ...children.flatMap(([key, entry]) => flattenJsonTree(entry, collapsedPaths, lineNumbers, depth + 1, key, jsonPointerChild(path, key)))
  ]
}

export function jsonValueSummary(value: unknown): { type: string; preview: ReactNode } {
  if (value === null) return { type: 'null', preview: <span className="tok-keyword">null</span> }
  if (Array.isArray(value)) return { type: 'array', preview: <span>{value.length} item{value.length === 1 ? '' : 's'}</span> }
  if (typeof value === 'object') return { type: 'object', preview: <span>{Object.keys(value as Record<string, unknown>).length} key{Object.keys(value as Record<string, unknown>).length === 1 ? '' : 's'}</span> }
  if (typeof value === 'string') return { type: 'string', preview: <span className="tok-string">"{value}"</span> }
  if (typeof value === 'number') return { type: 'number', preview: <span className="tok-number">{String(value)}</span> }
  if (typeof value === 'boolean') return { type: 'boolean', preview: <span className="tok-keyword">{String(value)}</span> }
  return { type: typeof value, preview: <span>{String(value)}</span> }
}
