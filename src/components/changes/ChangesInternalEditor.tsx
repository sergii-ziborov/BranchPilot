import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type UIEvent as ReactUIEvent
} from 'react'
import { ArrowLeft, ChevronDown, ChevronRight, ChevronUp, Code2, Copy, FileCode2, FileImage, Folder, FolderOpen, MinusSquare, Pencil, PlusSquare, RotateCcw, Save, Search, Sparkles, Terminal, Trash2, WandSparkles, X } from 'lucide-react'
import type { ApiResult, AssistantId, BranchPilotApi, ImagePreview, RepositoryFileBytesResult, RepositoryFileChunkResult, RepositoryFileEntry, RepositorySnapshot } from '../../shared/branchPilot'
import { fileStatusToken } from '../../lib/fileChangeLabels'
import { fileTypeIconForPath } from '../../lib/fileTypeIcons'
import { friendlyIpcErrorMessage } from '../../lib/ipcErrorMessage'
import { highlight, langFromPath } from '../../lib/highlight'
import { SignalStatus } from '../SignalStatus'
import {
  findCssColorTokens,
  isCssColorFile,
  rewriteCssColorValue,
  type CssColorEditDraft,
  type CssColorToken
} from '../diff/CssColorSwatch'

interface ChangesInternalEditorProps {
  api: BranchPilotApi | undefined
  currentRepoPath: string | undefined
  snapshot: RepositorySnapshot | null
  initialFilePath: string | null
  selectedAssistant: AssistantId
  onBack: () => void
  setNotice: (message: string) => void
  runSnapshotAction: (label: string, action: () => Promise<ApiResult<RepositorySnapshot>>) => boolean | void | Promise<boolean>
}

const EDITOR_SIDEBAR_STORAGE_KEY = 'branchpilot:changes-editor-sidebar-width'
const EDITOR_SIDEBAR_DEFAULT_WIDTH = 460
const EDITOR_SIDEBAR_MIN_WIDTH = 280
const EDITOR_SIDEBAR_MAX_WIDTH = 760
const EDITOR_DETAIL_MIN_WIDTH = 520
const EDITOR_SPLITTER_WIDTH = 10
const EDITOR_LARGE_FILE_LINE_THRESHOLD = 1000
const EDITOR_INITIAL_RENDER_LINES = 720
const EDITOR_RENDER_BATCH_SIZE = 560
const EDITOR_RENDER_LOOKAHEAD = 160
const EDITOR_SEARCH_MATCH_LIMIT = 5000
const EDITOR_LINE_HEIGHT = 20.4
const EDITOR_FILE_CHUNK_BYTES = 96_000
const PREVIEWABLE_IMAGE_RE = /\.(png|jpe?g|gif|webp|bmp|svg|ico|icns|avif)$/i
const SVG_RE = /\.svg$/i
const JSON_RE = /\.(json|jsonc)$/i
const JSONC_RE = /\.jsonc$/i
const TSCONFIG_JSON_RE = /(^|\/)tsconfig[^/]*\.json$/i
const SCRIPT_RE = /\.(m?[jt]sx?|cts|mts)$/i
const JSX_TSX_RE = /\.(jsx|tsx)$/i
const PLAIN_SCRIPT_RE = /\.(js|mjs|cjs|ts|mts|cts)$/i
const EDITOR_LINT_SETTINGS_STORAGE_KEY = 'branchpilot:changes-editor-lint-settings'

type EditorViewMode = 'code' | 'image' | 'json' | 'svg-editor' | 'hex'

interface EditorFileMenu {
  x: number
  y: number
  path: string
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function clampEditorSidebarWidth(width: number, containerWidth?: number): number {
  const maxForContainer = containerWidth && containerWidth > 0
    ? Math.max(EDITOR_SIDEBAR_MIN_WIDTH, containerWidth - EDITOR_SPLITTER_WIDTH - EDITOR_DETAIL_MIN_WIDTH)
    : EDITOR_SIDEBAR_MAX_WIDTH

  return Math.round(clamp(width, EDITOR_SIDEBAR_MIN_WIDTH, Math.min(EDITOR_SIDEBAR_MAX_WIDTH, maxForContainer)))
}

function editorLineWindowForScroll(totalLines: number, scrollTop: number, viewportHeight: number): EditorLineWindow {
  if (totalLines <= 0) {
    return { start: 0, end: 0, offsetTop: 0, rendered: 0, virtual: false }
  }

  if (totalLines <= EDITOR_LARGE_FILE_LINE_THRESHOLD) {
    return { start: 0, end: totalLines, offsetTop: 0, rendered: totalLines, virtual: false }
  }

  const viewportLines = Math.max(
    1,
    Math.ceil((viewportHeight || EDITOR_INITIAL_RENDER_LINES * EDITOR_LINE_HEIGHT) / EDITOR_LINE_HEIGHT)
  )
  const firstVisibleLine = Math.max(0, Math.floor(scrollTop / EDITOR_LINE_HEIGHT))
  const rawStart = Math.max(0, firstVisibleLine - EDITOR_RENDER_LOOKAHEAD)
  const rawEnd = Math.min(totalLines, firstVisibleLine + viewportLines + EDITOR_RENDER_LOOKAHEAD)
  const start = Math.floor(rawStart / EDITOR_RENDER_BATCH_SIZE) * EDITOR_RENDER_BATCH_SIZE
  const end = Math.min(
    totalLines,
    Math.max(start + EDITOR_RENDER_BATCH_SIZE, Math.ceil(rawEnd / EDITOR_RENDER_BATCH_SIZE) * EDITOR_RENDER_BATCH_SIZE)
  )

  return {
    start,
    end,
    offsetTop: start * EDITOR_LINE_HEIGHT,
    rendered: Math.max(0, end - start),
    virtual: true
  }
}

function readStoredEditorSidebarWidth(): number {
  try {
    const rawWidth = window.localStorage.getItem(EDITOR_SIDEBAR_STORAGE_KEY)
    if (rawWidth === null) return EDITOR_SIDEBAR_DEFAULT_WIDTH

    const stored = Number(rawWidth)
    if (Number.isFinite(stored)) return clampEditorSidebarWidth(stored)
  } catch {
    /* ignore unavailable storage */
  }

  return EDITOR_SIDEBAR_DEFAULT_WIDTH
}

function changedLineCount(originalText: string, draftText: string): number {
  const original = originalText.replace(/\r\n/g, '\n').split('\n')
  const draft = draftText.replace(/\r\n/g, '\n').split('\n')
  const count = Math.max(original.length, draft.length)
  let changed = 0

  for (let index = 0; index < count; index += 1) {
    if ((original[index] ?? '') !== (draft[index] ?? '')) changed += 1
  }

  return changed
}

interface LiveLineChange {
  lineNumber: number
  kind: 'added' | 'removed' | 'modified'
  before: string
  after: string
}

interface EditorCssColorToken extends CssColorToken {
  lineNumber: number
  renderLineIndex: number
}

interface EditorLineWindow {
  start: number
  end: number
  offsetTop: number
  rendered: number
  virtual: boolean
}

interface FileSearchMatch {
  lineNumber: number
  column: number
  length: number
}

interface ChunkedTextMarker {
  offset: number
  lineNumber: number
}

interface ChunkedTextPreview {
  filePath: string
  text: string
  byteSize: number
  startOffset: number
  endOffset: number
  startLine: number
  hasMore: boolean
  previous: ChunkedTextMarker[]
  loading: boolean
  error: string | null
}

interface JsonTreeNode {
  keyName?: string
  value: unknown
  depth: number
  path: string
  lineNumber?: number
  expandable: boolean
  childCount: number
}

interface JsonEditCell {
  path: string
  kind: 'string' | 'number' | 'boolean'
  value: string
}

interface EditorDiagnostic {
  lineNumber: number
  column: number
  message: string
  source: 'JSON' | 'JSONC' | 'JS/TS' | 'JSX/TSX'
}

interface EditorLintSettings {
  autoValidate: boolean
  validateJson: boolean
  allowJsonComments: boolean
  allowJsonTrailingCommas: boolean
  validateScripts: boolean
  validateJsxTsx: boolean
  validateRegexLiterals: boolean
}

interface SvgColorTarget {
  index: number
  element: string
  label: string
  attr: string
  value: string
}

interface SvgAnalysis {
  error: string | null
  width: string
  height: string
  viewBox: string
  elementCount: number
  colors: SvgColorTarget[]
}

interface FileTreeFolder {
  name: string
  path: string
  files: RepositoryFileEntry[]
  children: FileTreeFolder[]
}

interface MutableFileTreeFolder extends FileTreeFolder {
  children: MutableFileTreeFolder[]
  childMap: Map<string, MutableFileTreeFolder>
}

const DEFAULT_LINT_SETTINGS: EditorLintSettings = {
  autoValidate: true,
  validateJson: true,
  allowJsonComments: true,
  allowJsonTrailingCommas: true,
  validateScripts: true,
  validateJsxTsx: true,
  validateRegexLiterals: true
}

function readStoredLintSettings(): EditorLintSettings {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(EDITOR_LINT_SETTINGS_STORAGE_KEY) ?? '') as Partial<EditorLintSettings>
    return {
      autoValidate: typeof parsed.autoValidate === 'boolean' ? parsed.autoValidate : DEFAULT_LINT_SETTINGS.autoValidate,
      validateJson: typeof parsed.validateJson === 'boolean' ? parsed.validateJson : DEFAULT_LINT_SETTINGS.validateJson,
      allowJsonComments: typeof parsed.allowJsonComments === 'boolean' ? parsed.allowJsonComments : DEFAULT_LINT_SETTINGS.allowJsonComments,
      allowJsonTrailingCommas: typeof parsed.allowJsonTrailingCommas === 'boolean' ? parsed.allowJsonTrailingCommas : DEFAULT_LINT_SETTINGS.allowJsonTrailingCommas,
      validateScripts: typeof parsed.validateScripts === 'boolean' ? parsed.validateScripts : DEFAULT_LINT_SETTINGS.validateScripts,
      validateJsxTsx: typeof parsed.validateJsxTsx === 'boolean' ? parsed.validateJsxTsx : DEFAULT_LINT_SETTINGS.validateJsxTsx,
      validateRegexLiterals: typeof parsed.validateRegexLiterals === 'boolean' ? parsed.validateRegexLiterals : DEFAULT_LINT_SETTINGS.validateRegexLiterals
    }
  } catch {
    return DEFAULT_LINT_SETTINGS
  }
}

function persistLintSettings(settings: EditorLintSettings) {
  try {
    window.localStorage.setItem(EDITOR_LINT_SETTINGS_STORAGE_KEY, JSON.stringify(settings))
  } catch {
    /* ignore unavailable storage */
  }
}

function createFileTreeFolder(name: string, path: string): MutableFileTreeFolder {
  return {
    name,
    path,
    files: [],
    children: [],
    childMap: new Map()
  }
}

function fileDisplayName(filePath: string, folderPath: string): string {
  return folderPath ? filePath.slice(folderPath.length + 1) : filePath
}

function comparePathPart(left: string, right: string): number {
  return left.localeCompare(right, undefined, { sensitivity: 'base', numeric: true })
}

function sortFileTreeFolder(folder: MutableFileTreeFolder) {
  folder.files.sort((left, right) => {
    const byName = comparePathPart(fileDisplayName(left.path, folder.path), fileDisplayName(right.path, folder.path))
    return byName || comparePathPart(left.path, right.path)
  })
  folder.children.sort((left, right) => comparePathPart(left.name, right.name) || comparePathPart(left.path, right.path))
  folder.children.forEach(sortFileTreeFolder)
}

function buildRepositoryFileTree(files: RepositoryFileEntry[]): FileTreeFolder {
  const root = createFileTreeFolder('', '')

  for (const file of files) {
    const parts = file.path.split('/').filter(Boolean)
    if (parts.length <= 1) {
      root.files.push(file)
      continue
    }

    let folder = root
    for (let index = 0; index < parts.length - 1; index += 1) {
      const name = parts[index]
      const path = parts.slice(0, index + 1).join('/')
      let child = folder.childMap.get(name)
      if (!child) {
        child = createFileTreeFolder(name, path)
        folder.childMap.set(name, child)
        folder.children.push(child)
      }
      folder = child
    }

    folder.files.push(file)
  }

  sortFileTreeFolder(root)
  return root
}

function textLines(text: string): string[] {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const trimmed = normalized.endsWith('\n') ? normalized.slice(0, -1) : normalized
  return trimmed ? trimmed.split('\n') : ['']
}

function lineBreakCount(text: string): number {
  return text.match(/\n/g)?.length ?? 0
}

function chunkedTextPreviewFromResult(
  result: RepositoryFileChunkResult,
  options: { startLine: number; previous: ChunkedTextMarker[] }
): ChunkedTextPreview {
  return {
    filePath: result.filePath,
    text: result.text,
    byteSize: result.byteSize,
    startOffset: result.startOffset,
    endOffset: result.endOffset,
    startLine: options.startLine,
    hasMore: result.hasMore,
    previous: options.previous,
    loading: false,
    error: null
  }
}

function defaultViewModeForPath(filePath: string): EditorViewMode {
  if (PREVIEWABLE_IMAGE_RE.test(filePath)) return 'image'
  return 'code'
}

function lineColumnFromOffset(text: string, offset: number): { lineNumber: number; column: number } {
  const before = text.slice(0, Math.max(0, offset))
  const lines = before.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  return {
    lineNumber: lines.length,
    column: lines[lines.length - 1].length + 1
  }
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

function isJsoncFilePath(filePath: string): boolean {
  const normalizedPath = filePath.replace(/\\/g, '/')
  return JSONC_RE.test(normalizedPath) || TSCONFIG_JSON_RE.test(normalizedPath)
}

function stripJsonComments(text: string): string {
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

function stripJsonTrailingCommas(text: string): string {
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

function validateEditorText(filePath: string, text: string, settings: EditorLintSettings): EditorDiagnostic[] {
  if (settings.validateJson && JSON_RE.test(filePath)) return validateJsonText(filePath, text, settings)
  if (settings.validateJsxTsx && JSX_TSX_RE.test(filePath)) return validateScriptStructure(text, { source: 'JSX/TSX', validateRegexLiterals: false })
  if (settings.validateScripts && PLAIN_SCRIPT_RE.test(filePath)) {
    return validateScriptStructure(text, { source: 'JS/TS', validateRegexLiterals: settings.validateRegexLiterals })
  }
  return []
}

function normalizeTextForEditor(text: string): string {
  return `${text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/[ \t]+$/gm, '').trimEnd()}\n`
}

function beautifyPreservesTokens(before: string, after: string): boolean {
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

function beautifyJsoncText(text: string): string {
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

function beautifyMarkupText(text: string): string {
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

function beautifyMarkdownText(text: string): string {
  return normalizeTextForEditor(text.replace(/\n{4,}/g, '\n\n\n'))
}

function lineSyntaxDelta(line: string): { before: number; after: number } {
  let after = 0
  let quote = ''
  let escaped = false
  let lineComment = false
  let blockComment = false
  const trimmed = line.trim()
  const leadingSyntaxClosers = trimmed.match(/^[)\]}]+/)?.[0].length ?? 0
  const closesJsxTag = /^<\/[^>]+>$/.test(trimmed)
  const before = leadingSyntaxClosers + (closesJsxTag ? 1 : 0)

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    const next = line[index + 1]

    if (lineComment) break

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
      lineComment = true
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

function beautifyTextLocally(filePath: string, text: string): string {
  if (JSON_RE.test(filePath)) return isJsoncFilePath(filePath) ? beautifyJsoncText(text) : beautifyJsonText(text)
  if (/\.(m?[jt]sx?|cts|mts)$/i.test(filePath)) return beautifyScriptText(text)
  if (/\.(css|scss|less)$/i.test(filePath)) return beautifyCssText(text)
  if (/\.(html?|xml|svg)$/i.test(filePath)) return beautifyMarkupText(text)
  if (/\.(md|markdown|ya?ml|toml|ini|env|txt)$/i.test(filePath)) return beautifyMarkdownText(text)
  return normalizeTextForEditor(text)
}

function buildRepoFilePath(repoPath: string, filePath: string): string {
  const separator = repoPath.includes('\\') ? '\\' : '/'
  const root = repoPath.replace(/[\\/]+$/, '')
  const relativePath = filePath.replace(/^[\\/]+/, '').replace(/[\\/]+/g, separator)
  return `${root}${separator}${relativePath}`
}

function buildRepoFileDirectory(repoPath: string, filePath: string): string {
  const targetPath = buildRepoFilePath(repoPath, filePath)
  const lastSlash = Math.max(targetPath.lastIndexOf('/'), targetPath.lastIndexOf('\\'))
  return lastSlash > 0 ? targetPath.slice(0, lastSlash) : repoPath
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 102.4) / 10} KB`
  return `${Math.round(bytes / (1024 * 102.4)) / 10} MB`
}

function safeSvgDataUrl(svgText: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgText)}`
}

function bytesFromBase64(base64: string): Uint8Array {
  const binary = window.atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

function base64FromBytes(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize))
  }
  return window.btoa(binary)
}

function bytesToHexText(bytes: Uint8Array): string {
  const rows: string[] = []
  for (let offset = 0; offset < bytes.length; offset += 16) {
    rows.push(Array.from(bytes.subarray(offset, offset + 16), (byte) => byte.toString(16).padStart(2, '0')).join(' '))
  }
  return rows.join('\n')
}

function parseHexText(hexText: string): { bytes: Uint8Array | null; error: string | null } {
  const normalized = hexText.replace(/\s+/g, '')
  if (!normalized) return { bytes: new Uint8Array(), error: null }
  if (/[^0-9a-f]/i.test(normalized)) return { bytes: null, error: 'Hex can contain only 0-9 and A-F bytes.' }
  if (normalized.length % 2 !== 0) return { bytes: null, error: 'Hex byte stream has an odd number of digits.' }

  const bytes = new Uint8Array(normalized.length / 2)
  for (let index = 0; index < normalized.length; index += 2) {
    bytes[index / 2] = Number.parseInt(normalized.slice(index, index + 2), 16)
  }
  return { bytes, error: null }
}

function asciiFromBytes(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => (byte >= 32 && byte <= 126 ? String.fromCharCode(byte) : '.')).join('')
}

function hexRows(bytes: Uint8Array): Array<{ offset: string; hex: string; ascii: string }> {
  const rows: Array<{ offset: string; hex: string; ascii: string }> = []
  for (let offset = 0; offset < bytes.length; offset += 16) {
    const rowBytes = bytes.subarray(offset, offset + 16)
    rows.push({
      offset: offset.toString(16).padStart(8, '0'),
      hex: Array.from(rowBytes, (byte) => byte.toString(16).padStart(2, '0')).join(' '),
      ascii: asciiFromBytes(rowBytes)
    })
  }
  return rows
}

function parseSvgDocument(text: string): { document: XMLDocument | null; error: string | null } {
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

function serializeSvgDocument(document: XMLDocument): string {
  return beautifyMarkupText(new XMLSerializer().serializeToString(document.documentElement))
}

function svgElements(document: XMLDocument): Element[] {
  const root = document.documentElement
  return [root, ...Array.from(root.querySelectorAll('*'))]
}

function svgElementLabel(element: Element, index: number): string {
  const id = element.getAttribute('id')
  const className = element.getAttribute('class')
  if (id) return `#${id}`
  if (className) return `.${className.split(/\s+/)[0]}`
  return `${element.tagName.toLowerCase()} ${index}`
}

function analyzeSvgText(text: string): SvgAnalysis {
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

function normalizePickerColor(value: string): string | null {
  const raw = value.trim()
  if (/^#[0-9a-f]{6}$/i.test(raw)) return raw
  if (/^#[0-9a-f]{3}$/i.test(raw)) {
    return `#${raw[1]}${raw[1]}${raw[2]}${raw[2]}${raw[3]}${raw[3]}`
  }
  return null
}

function jsonChildEntries(value: unknown): Array<[string, unknown]> {
  if (value === null || typeof value !== 'object') return []
  if (Array.isArray(value)) return value.map((entry, index) => [String(index), entry])
  return Object.entries(value as Record<string, unknown>)
}

function jsonPointerChild(parentPath: string, key: string): string {
  const escaped = key.replace(/~/g, '~0').replace(/\//g, '~1')
  return `${parentPath}/${escaped}`
}

function jsonPointerParts(path: string): string[] {
  if (!path) return []
  return path
    .split('/')
    .slice(1)
    .map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~'))
}

function jsonEditableKind(value: unknown): JsonEditCell['kind'] | null {
  if (typeof value === 'string') return 'string'
  if (typeof value === 'number') return 'number'
  if (typeof value === 'boolean') return 'boolean'
  return null
}

function jsonEditInitialValue(value: unknown): string {
  return String(value)
}

function parseJsonEditValue(kind: JsonEditCell['kind'], rawValue: string): unknown {
  if (kind === 'string') return rawValue
  if (kind === 'boolean') return rawValue === 'true'

  const value = Number(rawValue.trim())
  if (!Number.isFinite(value)) {
    throw new Error('Number value is invalid.')
  }
  return value
}

function updateJsonValueAtPath(rootValue: unknown, path: string, nextValue: unknown): unknown {
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

function collectJsonExpandablePaths(value: unknown, path = ''): string[] {
  const children = jsonChildEntries(value)
  if (children.length === 0) return []

  return [
    path,
    ...children.flatMap(([key, entry]) => collectJsonExpandablePaths(entry, jsonPointerChild(path, key)))
  ]
}

function buildJsonLineNumberMap(text: string): Map<string, number> {
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

function flattenJsonTree(value: unknown, collapsedPaths: Set<string>, lineNumbers: Map<string, number>, depth = 0, keyName?: string, path = ''): JsonTreeNode[] {
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

function jsonValueSummary(value: unknown): { type: string; preview: ReactNode } {
  if (value === null) return { type: 'null', preview: <span className="tok-keyword">null</span> }
  if (Array.isArray(value)) return { type: 'array', preview: <span>{value.length} item{value.length === 1 ? '' : 's'}</span> }
  if (typeof value === 'object') return { type: 'object', preview: <span>{Object.keys(value as Record<string, unknown>).length} key{Object.keys(value as Record<string, unknown>).length === 1 ? '' : 's'}</span> }
  if (typeof value === 'string') return { type: 'string', preview: <span className="tok-string">"{value}"</span> }
  if (typeof value === 'number') return { type: 'number', preview: <span className="tok-number">{String(value)}</span> }
  if (typeof value === 'boolean') return { type: 'boolean', preview: <span className="tok-keyword">{String(value)}</span> }
  return { type: typeof value, preview: <span>{String(value)}</span> }
}

function buildLineOffsets(lines: string[]): number[] {
  const offsets: number[] = []
  let offset = 0

  for (const line of lines) {
    offsets.push(offset)
    offset += line.length + 1
  }

  return offsets
}

function findFileSearchMatches(lines: string[], needle: string): FileSearchMatch[] {
  const query = needle.trim()
  if (!query) return []

  const lowerQuery = query.toLowerCase()
  const matches: FileSearchMatch[] = []

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex]
    const lowerLine = line.toLowerCase()
    let column = lowerLine.indexOf(lowerQuery)

    while (column !== -1) {
      matches.push({ lineNumber: lineIndex + 1, column, length: query.length })
      if (matches.length >= EDITOR_SEARCH_MATCH_LIMIT) return matches
      column = lowerLine.indexOf(lowerQuery, column + Math.max(1, lowerQuery.length))
    }
  }

  return matches
}

function highlightedLineContent(line: string, lang: string, searchQuery: string, activeMatch: FileSearchMatch | null, lineNumber: number) {
  const query = searchQuery.trim()
  if (!query) return highlight(line || ' ', lang)

  const lowerLine = line.toLowerCase()
  const lowerQuery = query.toLowerCase()
  const chunks = []
  let last = 0
  let key = 0
  let column = lowerLine.indexOf(lowerQuery)

  while (column !== -1) {
    if (column > last) {
      const plain = line.slice(last, column)
      chunks.push(<span key={`plain-${key++}`}>{highlight(plain, lang)}</span>)
    }

    const token = line.slice(column, column + query.length)
    const active = activeMatch?.lineNumber === lineNumber && activeMatch.column === column
    chunks.push(
      <mark className={active ? 'changes-editor-search-hit active' : 'changes-editor-search-hit'} key={`match-${key++}`}>
        {highlight(token, lang)}
      </mark>
    )

    last = column + query.length
    column = lowerLine.indexOf(lowerQuery, last)
  }

  if (last < line.length) {
    chunks.push(<span key={`tail-${key++}`}>{highlight(line.slice(last), lang)}</span>)
  }

  return chunks.length ? chunks : highlight(line || ' ', lang)
}

function buildLiveLineChanges(originalText: string, draftText: string): LiveLineChange[] {
  const original = originalText.replace(/\r\n/g, '\n').split('\n')
  const draft = draftText.replace(/\r\n/g, '\n').split('\n')
  const count = Math.max(original.length, draft.length)
  const changes: LiveLineChange[] = []

  for (let index = 0; index < count; index += 1) {
    const before = original[index] ?? ''
    const after = draft[index] ?? ''
    if (before === after) continue

    changes.push({
      lineNumber: index + 1,
      kind: before ? (after ? 'modified' : 'removed') : 'added',
      before,
      after
    })
  }

  return changes
}

function updateLineInText(text: string, lineNumber: number, nextLine: string | null): string {
  const hasTrailingNewline = /\r?\n$/.test(text)
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  if (hasTrailingNewline && lines[lines.length - 1] === '') lines.pop()
  const index = lineNumber - 1

  if (index < 0 || index > lines.length) return text

  if (nextLine === null) {
    lines.splice(index, 1)
  } else if (index === lines.length) {
    lines.push(nextLine)
  } else {
    lines[index] = nextLine
  }

  return `${lines.join('\n')}${hasTrailingNewline ? '\n' : ''}`
}

function EditorCssColorSwatch({
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
    if (!pending) inputRef.current?.click()
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
          event.preventDefault()
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

export function ChangesInternalEditor({
  api,
  currentRepoPath,
  snapshot,
  initialFilePath,
  selectedAssistant,
  onBack,
  setNotice,
  runSnapshotAction
}: ChangesInternalEditorProps) {
  const editorRef = useRef<HTMLElement | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const highlightInnerRef = useRef<HTMLDivElement | null>(null)
  const lineNumbersInnerRef = useRef<HTMLDivElement | null>(null)
  const colorSwatchesInnerRef = useRef<HTMLDivElement | null>(null)
  const skipJsonEditBlurRef = useRef(false)
  const chunkPageRequestRef = useRef(false)
  const [sidebarWidth, setSidebarWidth] = useState(readStoredEditorSidebarWidth)
  const [files, setFiles] = useState<RepositoryFileEntry[]>([])
  const [filesLoading, setFilesLoading] = useState(false)
  const [fileQuery, setFileQuery] = useState('')
  const [fileSearchQuery, setFileSearchQuery] = useState('')
  const [activeSearchIndex, setActiveSearchIndex] = useState(-1)
  const [fileMenu, setFileMenu] = useState<EditorFileMenu | null>(null)
  const [viewMode, setViewMode] = useState<EditorViewMode>(() => defaultViewModeForPath(initialFilePath ?? ''))
  const [selectedPath, setSelectedPath] = useState(initialFilePath ?? '')
  const [originalText, setOriginalText] = useState('')
  const [draftText, setDraftText] = useState('')
  const [chunkedTextPreview, setChunkedTextPreview] = useState<ChunkedTextPreview | null>(null)
  const [imagePreview, setImagePreview] = useState<ImagePreview | null>(null)
  const [imagePreviewLoading, setImagePreviewLoading] = useState(false)
  const [imagePreviewError, setImagePreviewError] = useState<string | null>(null)
  const [hexBytes, setHexBytes] = useState<RepositoryFileBytesResult | null>(null)
  const [hexLoading, setHexLoading] = useState(false)
  const [hexError, setHexError] = useState<string | null>(null)
  const [hexOriginalText, setHexOriginalText] = useState('')
  const [hexDraftText, setHexDraftText] = useState('')
  const [editorScrollTop, setEditorScrollTop] = useState(0)
  const [editorViewportHeight, setEditorViewportHeight] = useState(0)
  const [collapsedJsonPaths, setCollapsedJsonPaths] = useState<Set<string>>(new Set())
  const [jsonEdit, setJsonEdit] = useState<JsonEditCell | null>(null)
  const [fileLoading, setFileLoading] = useState(false)
  const [filesError, setFilesError] = useState<string | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [textUnavailableMessage, setTextUnavailableMessage] = useState<string | null>(null)
  const [beautifying, setBeautifying] = useState(false)
  const [aiBeautifying, setAiBeautifying] = useState(false)
  const [saving, setSaving] = useState(false)
  const [lintSettings, setLintSettings] = useState(readStoredLintSettings)
  const [diagnostics, setDiagnostics] = useState<EditorDiagnostic[]>([])
  const changeByPath = useMemo(() => new Map((snapshot?.status.changes ?? []).map((change) => [change.path, change])), [snapshot])
  const query = fileQuery.trim().toLowerCase()
  const visibleFiles = useMemo(() => (
    query ? files.filter((file) => file.path.toLowerCase().includes(query)) : files
  ), [files, query])
  const visibleFileTree = useMemo(() => buildRepositoryFileTree(visibleFiles), [visibleFiles])
  const chunkedReadOnly = Boolean(chunkedTextPreview)
  const activeEditorText = chunkedTextPreview?.text ?? draftText
  const activeEditorLineBase = chunkedTextPreview?.startLine ?? 1
  const textDirty = !chunkedReadOnly && draftText !== originalText
  const hexDirty = hexDraftText !== hexOriginalText
  const dirty = textDirty || hexDirty
  const editedLines = dirty ? changedLineCount(originalText, draftText) : 0
  const liveChanges = useMemo(() => (textDirty ? buildLiveLineChanges(originalText, draftText) : []), [textDirty, originalText, draftText])
  const changeKindByLine = useMemo(() => new Map(liveChanges.map((change) => [change.lineNumber, change.kind])), [liveChanges])
  const draftLines = useMemo(() => textLines(activeEditorText), [activeEditorText])
  const lineOffsets = useMemo(() => buildLineOffsets(draftLines), [draftLines])
  const fileSearchMatches = useMemo(() => (
    findFileSearchMatches(draftLines, fileSearchQuery).map((match) => ({
      ...match,
      lineNumber: activeEditorLineBase + match.lineNumber - 1
    }))
  ), [activeEditorLineBase, draftLines, fileSearchQuery])
  const parsedHexDraft = useMemo(() => parseHexText(hexDraftText), [hexDraftText])
  const hexPreviewRows = useMemo(() => (parsedHexDraft.bytes ? hexRows(parsedHexDraft.bytes).slice(0, 4000) : []), [parsedHexDraft.bytes])
  const diagnosticByLine = useMemo(() => new Map(diagnostics.map((diagnostic) => [diagnostic.lineNumber, diagnostic])), [diagnostics])
  const fileSearchOverflow = fileSearchMatches.length >= EDITOR_SEARCH_MATCH_LIMIT
  const activeSearchMatch = activeSearchIndex >= 0 ? fileSearchMatches[activeSearchIndex] ?? null : null
  const editorLineWindow = useMemo(
    () => editorLineWindowForScroll(draftLines.length, editorScrollTop, editorViewportHeight),
    [draftLines.length, editorScrollTop, editorViewportHeight]
  )
  const visibleDraftLines = useMemo(
    () => draftLines.slice(editorLineWindow.start, editorLineWindow.end),
    [draftLines, editorLineWindow.end, editorLineWindow.start]
  )
  const editorCssColorTokens = useMemo<EditorCssColorToken[]>(() => {
    if (!isCssColorFile(selectedPath) || textUnavailableMessage) return []
    return visibleDraftLines.flatMap((line, index) => (
      findCssColorTokens(line).map((token) => ({
        ...token,
        lineNumber: activeEditorLineBase + editorLineWindow.start + index,
        renderLineIndex: index
      }))
    ))
  }, [activeEditorLineBase, editorLineWindow.start, selectedPath, textUnavailableMessage, visibleDraftLines])
  const selectedIsImage = PREVIEWABLE_IMAGE_RE.test(selectedPath)
  const selectedIsSvg = SVG_RE.test(selectedPath)
  const selectedIsJson = JSON_RE.test(selectedPath)
  const selectedIsBinaryPreview = selectedIsImage && Boolean(textUnavailableMessage)
  const svgPreviewUrl = selectedIsSvg && !chunkedReadOnly && draftText ? safeSvgDataUrl(draftText) : ''
  const activeImagePreviewUrl = selectedIsSvg ? (svgPreviewUrl || imagePreview?.dataUrl || '') : imagePreview?.dataUrl ?? ''
  const svgAnalysis = useMemo(() => (selectedIsSvg && !chunkedReadOnly ? analyzeSvgText(draftText) : null), [chunkedReadOnly, draftText, selectedIsSvg])
  const jsonParseResult = useMemo(() => {
    if (chunkedReadOnly || !selectedIsJson || !draftText.trim()) {
      return { rows: [] as JsonTreeNode[], expandablePaths: [] as string[], error: null as string | null }
    }
    try {
      const parsed = JSON.parse(draftText)
      const lineNumbers = buildJsonLineNumberMap(draftText)
      return {
        rows: flattenJsonTree(parsed, collapsedJsonPaths, lineNumbers),
        expandablePaths: collectJsonExpandablePaths(parsed),
        error: null
      }
    } catch (error) {
      return {
        rows: [] as JsonTreeNode[],
        expandablePaths: [] as string[],
        error: error instanceof Error ? error.message : 'Invalid JSON.'
      }
    }
  }, [chunkedReadOnly, collapsedJsonPaths, draftText, selectedIsJson])
  const selectedIcon = fileTypeIconForPath(selectedPath)
  const selectedLang = langFromPath(selectedPath)
  const selectedLintSupported = !chunkedReadOnly && (selectedIsJson || SCRIPT_RE.test(selectedPath))
  const selectedHexOnly = Boolean(textUnavailableMessage)
  const lintBlocked = !selectedPath || fileLoading || Boolean(fileError) || selectedHexOnly || chunkedReadOnly || viewMode === 'image' || viewMode === 'hex'
  const textSaveBlocked = chunkedReadOnly && !hexDirty
  const contextMenuChange = fileMenu ? changeByPath.get(fileMenu.path) : null
  const availableViewModes = useMemo<Array<{ id: EditorViewMode; label: string }>>(() => {
    const modes: Array<{ id: EditorViewMode; label: string }> = []
    if (selectedIsImage) modes.push({ id: 'image', label: 'Preview' })
    if (selectedIsSvg && !selectedIsBinaryPreview && !chunkedReadOnly) modes.push({ id: 'svg-editor', label: 'Edit' })
    if (!selectedIsBinaryPreview || selectedIsSvg) modes.push({ id: 'code', label: selectedIsSvg ? 'SVG' : 'Code' })
    if (selectedIsJson && !selectedIsBinaryPreview && !chunkedReadOnly) modes.push({ id: 'json', label: 'JSON' })
    if (selectedPath) modes.push({ id: 'hex', label: 'Hex' })
    return modes.length ? modes : [{ id: 'code', label: 'Code' }]
  }, [chunkedReadOnly, selectedIsBinaryPreview, selectedIsImage, selectedIsJson, selectedIsSvg, selectedPath])
  const editorStyle = {
    '--changes-editor-sidebar-width': `${sidebarWidth}px`
  } as CSSProperties

  const openFileContextMenu = (event: ReactMouseEvent, path: string) => {
    if (!path) return
    event.preventDefault()
    event.stopPropagation()
    setFileMenu({ x: event.clientX, y: event.clientY, path })
  }

  const renderFileRow = (file: RepositoryFileEntry, displayName: string) => {
    const change = changeByPath.get(file.path)
    const fileTypeIcon = fileTypeIconForPath(file.path)
    const fileIsDirty = selectedPath === file.path && dirty
    const statusClassName = fileIsDirty ? 'status-edited' : change ? `status-${change.status}` : ''
    const statusLabel = fileIsDirty ? 'E' : change ? fileStatusToken(change.status) : ''
    const statusTitle = fileIsDirty ? 'Edited since load' : change ? change.status : ''

    return (
      <button
        type="button"
        className={[
          'changes-editor-file-row',
          selectedPath === file.path ? 'selected' : '',
          fileIsDirty ? 'edited' : '',
          change ? 'changed' : 'clean'
        ].filter(Boolean).join(' ')}
        key={file.path}
        onClick={() => setSelectedPath(file.path)}
        onContextMenu={(event) => openFileContextMenu(event, file.path)}
        title={file.path}
      >
        <span className={`file-type-icon file-type-${fileTypeIcon.tone}`} title={fileTypeIcon.title} aria-hidden="true">
          {fileTypeIcon.label}
        </span>
        <span className="file-name">{displayName}</span>
        {statusLabel && (
          <span className={`file-status ${statusClassName}`} title={statusTitle} aria-label={statusTitle}>
            {statusLabel}
          </span>
        )}
      </button>
    )
  }

  const renderFolderTree = (folder: FileTreeFolder, depth: number) => (
    <div className={`changes-editor-tree-folder rail-${depth % 4}`} key={folder.path}>
      <div className="changes-editor-folder-row" title={folder.path}>
        <Folder size={13} />
        <span className="changes-editor-folder-path">{folder.name}</span>
      </div>
      {folder.files.map((file) => renderFileRow(file, fileDisplayName(file.path, folder.path)))}
      {folder.children.map((child) => renderFolderTree(child, depth + 1))}
    </div>
  )

  const persistSidebarWidth = (width: number) => {
    try {
      window.localStorage.setItem(EDITOR_SIDEBAR_STORAGE_KEY, String(width))
    } catch {
      /* ignore unavailable storage */
    }
  }

  const resizeSidebar = (clientX: number) => {
    const editor = editorRef.current
    if (!editor) return sidebarWidth

    const rect = editor.getBoundingClientRect()
    const nextWidth = clampEditorSidebarWidth(clientX - rect.left, rect.width)
    setSidebarWidth(nextWidth)
    return nextWidth
  }

  const nudgeSidebar = (delta: number) => {
    const editor = editorRef.current
    const containerWidth = editor?.getBoundingClientRect().width
    setSidebarWidth((width) => {
      const nextWidth = clampEditorSidebarWidth(width + delta, containerWidth)
      persistSidebarWidth(nextWidth)
      return nextWidth
    })
  }

  const startSidebarResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return

    event.preventDefault()
    let latestWidth = resizeSidebar(event.clientX)
    document.body.classList.add('is-resizing-editor-sidebar')

    const handlePointerMove = (moveEvent: PointerEvent) => {
      latestWidth = resizeSidebar(moveEvent.clientX)
    }

    const stopResize = () => {
      document.body.classList.remove('is-resizing-editor-sidebar')
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', stopResize)
      window.removeEventListener('pointercancel', stopResize)
      persistSidebarWidth(latestWidth)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', stopResize)
    window.addEventListener('pointercancel', stopResize)
  }

  const handleSidebarResizeKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      nudgeSidebar(event.shiftKey ? -72 : -24)
    } else if (event.key === 'ArrowRight') {
      event.preventDefault()
      nudgeSidebar(event.shiftKey ? 72 : 24)
    } else if (event.key === 'Home') {
      event.preventDefault()
      setSidebarWidth(EDITOR_SIDEBAR_MIN_WIDTH)
      persistSidebarWidth(EDITOR_SIDEBAR_MIN_WIDTH)
    } else if (event.key === 'End') {
      event.preventDefault()
      const editor = editorRef.current
      const nextWidth = clampEditorSidebarWidth(EDITOR_SIDEBAR_MAX_WIDTH, editor?.getBoundingClientRect().width)
      setSidebarWidth(nextWidth)
      persistSidebarWidth(nextWidth)
    }
  }

  const syncEditorOverlays = (scrollLeft: number, scrollTop: number, viewportHeight = editorViewportHeight) => {
    const lineWindow = editorLineWindowForScroll(draftLines.length, scrollTop, viewportHeight)
    const translateY = lineWindow.offsetTop - scrollTop

    if (highlightInnerRef.current) {
      highlightInnerRef.current.style.transform = `translate(${-scrollLeft}px, ${translateY}px)`
    }
    if (lineNumbersInnerRef.current) {
      lineNumbersInnerRef.current.style.transform = `translateY(${translateY}px)`
    }
    if (colorSwatchesInnerRef.current) {
      colorSwatchesInnerRef.current.style.transform = `translate(${-scrollLeft}px, ${translateY}px)`
    }
  }

  const updateEditorLineWindowState = (scrollTop: number, viewportHeight: number) => {
    const nextLineWindow = editorLineWindowForScroll(draftLines.length, scrollTop, viewportHeight)
    const viewportChanged = Math.abs(viewportHeight - editorViewportHeight) > 1
    if (
      viewportChanged ||
      nextLineWindow.start !== editorLineWindow.start ||
      nextLineWindow.end !== editorLineWindow.end
    ) {
      setEditorScrollTop(scrollTop)
      setEditorViewportHeight(viewportHeight)
    }
  }

  const focusEditorPosition = (lineNumber: number, column = 0, length = 0) => {
    const textarea = textareaRef.current
    if (!textarea) return

    const firstLineNumber = activeEditorLineBase
    const lastLineNumber = activeEditorLineBase + Math.max(0, draftLines.length - 1)
    const safeLineNumber = Math.max(firstLineNumber, Math.min(lineNumber, Math.max(firstLineNumber, lastLineNumber)))
    const relativeLineIndex = Math.max(0, safeLineNumber - activeEditorLineBase)
    const safeColumn = Math.max(0, column)
    const offset = (lineOffsets[relativeLineIndex] ?? 0) + safeColumn

    window.requestAnimationFrame(() => {
      textarea.focus()
      textarea.setSelectionRange(offset, offset + Math.max(0, length))
      const top = Math.max(0, relativeLineIndex * EDITOR_LINE_HEIGHT - textarea.clientHeight * 0.32)
      updateEditorLineWindowState(top, textarea.clientHeight)
      textarea.scrollTop = top
      syncEditorOverlays(textarea.scrollLeft, textarea.scrollTop, textarea.clientHeight)
    })
  }

  const focusSearchMatch = (match: FileSearchMatch) => {
    focusEditorPosition(match.lineNumber, match.column, match.length)
  }

  const updateLintSettings = (patch: Partial<EditorLintSettings>) => {
    setLintSettings((current) => {
      const next = { ...current, ...patch }
      persistLintSettings(next)
      return next
    })
  }

  const runLint = (focusFirst = true) => {
    if (lintBlocked || !selectedLintSupported) return
    const nextDiagnostics = validateEditorText(selectedPath, draftText, lintSettings)
    setDiagnostics(nextDiagnostics)
    if (focusFirst && nextDiagnostics[0]) {
      focusEditorPosition(nextDiagnostics[0].lineNumber, nextDiagnostics[0].column - 1, 1)
    }
  }

  const activateSearchMatch = (index: number) => {
    if (fileSearchMatches.length === 0) return
    const nextIndex = ((index % fileSearchMatches.length) + fileSearchMatches.length) % fileSearchMatches.length
    setActiveSearchIndex(nextIndex)
    focusSearchMatch(fileSearchMatches[nextIndex])
  }

  const handleFileSearchKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return
    event.preventDefault()
    activateSearchMatch(activeSearchIndex < 0 ? (event.shiftKey ? -1 : 0) : activeSearchIndex + (event.shiftKey ? -1 : 1))
  }

  const updateEditorCssColor = (request: CssColorEditDraft) => {
    setDraftText((current) => {
      const lines = current.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
      const lineIndex = request.lineNumber - 1
      const line = lines[lineIndex]
      if (line === undefined) return current

      const directMatch = line.slice(request.columnStart, request.columnStart + request.oldValue.length) === request.oldValue
      const columnStart = directMatch ? request.columnStart : line.indexOf(request.oldValue)
      if (columnStart < 0) return current

      const nextLine = `${line.slice(0, columnStart)}${request.newValue}${line.slice(columnStart + request.oldValue.length)}`
      return updateLineInText(current, request.lineNumber, nextLine)
    })
  }

  const loadChunkedTextPage = async (direction: 'next' | 'previous') => {
    const current = chunkedTextPreview
    if (!api || !currentRepoPath || !selectedPath || !current || current.loading || chunkPageRequestRef.current) return

    const previous = [...current.previous]
    let offset = current.endOffset
    let startLine = current.startLine + lineBreakCount(current.text)
    let nextPrevious = [...previous, { offset: current.startOffset, lineNumber: current.startLine }]

    if (direction === 'previous') {
      const marker = previous.pop()
      if (!marker) return
      offset = marker.offset
      startLine = marker.lineNumber
      nextPrevious = previous
    } else if (!current.hasMore) {
      return
    }

    chunkPageRequestRef.current = true
    setChunkedTextPreview({ ...current, loading: true, error: null })
    setFileLoading(true)
    try {
      const result = await api.getRepositoryFileChunk({
        repoPath: currentRepoPath,
        filePath: selectedPath,
        offset,
        maxBytes: EDITOR_FILE_CHUNK_BYTES
      })
      if (!result.ok) {
        const message = friendlyIpcErrorMessage(result.error.message, 'Failed to load file chunk.')
        setChunkedTextPreview((latest) => latest ? { ...latest, loading: false, error: message } : latest)
        setNotice(message)
        return
      }
      if (result.data.binary) {
        const message = 'Binary file - Hex editor available.'
        setChunkedTextPreview(null)
        setTextUnavailableMessage(message)
        setViewMode('hex')
        setNotice(message)
        return
      }

      setChunkedTextPreview(chunkedTextPreviewFromResult(result.data, {
        startLine,
        previous: nextPrevious
      }))
      setOriginalText(result.data.text)
      setDraftText(result.data.text)
      setEditorScrollTop(0)
      if (textareaRef.current) {
        textareaRef.current.scrollTop = 0
        textareaRef.current.scrollLeft = 0
      }
      window.requestAnimationFrame(() => syncEditorOverlays(0, 0))
    } catch (error) {
      const message = friendlyIpcErrorMessage(error instanceof Error ? error.message : '', 'Failed to load file chunk.')
      setChunkedTextPreview((latest) => latest ? { ...latest, loading: false, error: message } : latest)
      setNotice(message)
    } finally {
      chunkPageRequestRef.current = false
      setFileLoading(false)
    }
  }

  const renderCodeEditor = () => {
    if (textUnavailableMessage) {
      return (
        <div className="changes-editor-mode-message">
          <FileImage size={28} />
          <strong>{textUnavailableMessage}</strong>
          <span>Use Preview for this file.</span>
        </div>
      )
    }

    return (
      <div className={[dirty ? 'changes-editor-code-shell is-dirty' : 'changes-editor-code-shell', chunkedReadOnly ? 'is-chunked' : ''].filter(Boolean).join(' ')}>
        {chunkedTextPreview && (
          <div className="changes-editor-chunk-banner">
            <strong>Chunk preview</strong>
            <span>
              {formatBytes(chunkedTextPreview.startOffset)}-{formatBytes(chunkedTextPreview.endOffset)} of {formatBytes(chunkedTextPreview.byteSize)}
            </span>
            {chunkedTextPreview.error && <em>{chunkedTextPreview.error}</em>}
            <button type="button" onClick={() => void loadChunkedTextPage('previous')} disabled={chunkedTextPreview.loading || chunkedTextPreview.previous.length === 0}>
              Previous chunk
            </button>
            <button type="button" onClick={() => void loadChunkedTextPage('next')} disabled={chunkedTextPreview.loading || !chunkedTextPreview.hasMore}>
              {chunkedTextPreview.loading ? 'Loading...' : 'Next chunk'}
            </button>
          </div>
        )}
        <pre className="changes-editor-line-numbers" aria-hidden="true">
          <div className="changes-editor-line-numbers-inner" ref={lineNumbersInnerRef}>
            {visibleDraftLines.map((_, index) => {
              const lineNumber = activeEditorLineBase + editorLineWindow.start + index
              const diagnostic = diagnosticByLine.get(lineNumber)

              return (
                <span
                  className={diagnostic ? 'line-diagnostic-error' : undefined}
                  key={lineNumber}
                  title={diagnostic ? `${diagnostic.source}: ${diagnostic.message}` : undefined}
                >
                  {lineNumber}
                </span>
              )
            })}
          </div>
        </pre>
        <pre className="changes-editor-highlight" aria-hidden="true">
          <div className="changes-editor-highlight-inner" ref={highlightInnerRef}>
            {visibleDraftLines.map((line, index) => {
              const lineNumber = activeEditorLineBase + editorLineWindow.start + index
              const changeKind = changeKindByLine.get(lineNumber)
              const diagnostic = diagnosticByLine.get(lineNumber)

              return (
                <code
                  className={[
                    'changes-editor-highlight-line',
                    changeKind ? `line-${changeKind}` : '',
                    diagnostic ? 'line-diagnostic-error' : ''
                  ].filter(Boolean).join(' ')}
                  key={`${lineNumber}-${line.slice(0, 20)}`}
                  title={diagnostic ? `${diagnostic.source}: ${diagnostic.message}` : undefined}
                >
                  {highlightedLineContent(line || ' ', selectedLang, fileSearchQuery, activeSearchMatch, lineNumber)}
                </code>
              )
            })}
          </div>
        </pre>
        <textarea
          ref={textareaRef}
          className={dirty ? 'changes-editor-textarea is-dirty' : 'changes-editor-textarea'}
          spellCheck={false}
          wrap="off"
          value={activeEditorText}
          onChange={(event) => {
            if (!chunkedReadOnly) setDraftText(event.target.value)
          }}
          onScroll={syncHighlightScroll}
          readOnly={chunkedReadOnly}
          disabled={fileLoading}
        />
        {editorCssColorTokens.length > 0 && (
          <div className="changes-editor-color-layer" aria-label="CSS color controls">
            <div className="changes-editor-color-layer-inner" ref={colorSwatchesInnerRef}>
              {editorCssColorTokens.map((token) => (
                <EditorCssColorSwatch
                  key={`${token.lineNumber}-${token.columnStart}-${token.value}`}
                  filePath={selectedPath}
                  token={token}
                  onUpdateCssColor={updateEditorCssColor}
                />
              ))}
            </div>
          </div>
        )}
        {diagnostics.length > 0 && !fileLoading && (
          <div className="changes-editor-diagnostics" aria-live="polite">
            <header>
              <strong>{diagnostics.length} lint issue{diagnostics.length === 1 ? '' : 's'}</strong>
              <span>{selectedPath}</span>
            </header>
            {diagnostics.slice(0, 4).map((diagnostic, index) => (
              <button
                type="button"
                key={`${diagnostic.lineNumber}-${diagnostic.column}-${index}`}
                onClick={() => focusEditorPosition(diagnostic.lineNumber, diagnostic.column - 1, 1)}
              >
                <span>{diagnostic.source}</span>
                <code>{diagnostic.lineNumber}:{diagnostic.column}</code>
                <strong>{diagnostic.message}</strong>
              </button>
            ))}
          </div>
        )}
      </div>
    )
  }

  const renderImagePreview = () => (
    <div className="changes-editor-media-shell">
      {activeImagePreviewUrl ? (
        <div className="changes-editor-image-stage">
          <img src={activeImagePreviewUrl} alt={selectedPath} />
          <span>
            {selectedIsSvg && draftText ? 'Live SVG preview' : imagePreview ? `${formatBytes(imagePreview.byteSize)} - ${imagePreview.mimeType}` : 'Image preview'}
          </span>
        </div>
      ) : imagePreviewError ? (
        <div className="changes-editor-mode-message danger-text">
          <FileImage size={28} />
          <strong>Preview unavailable</strong>
          <span>{imagePreviewError}</span>
        </div>
      ) : (
        <SignalStatus
          className="changes-editor-file-curtain changes-editor-file-curtain-static"
          label={imagePreviewLoading ? 'Loading image preview' : 'Preparing preview'}
          detail={selectedPath}
        />
      )}
      {imagePreviewLoading && activeImagePreviewUrl && (
        <SignalStatus
          compact
          className="changes-editor-file-curtain changes-editor-media-loading"
          label="Refreshing preview"
          detail={selectedPath}
        />
      )}
    </div>
  )

  const renderHexEditor = () => {
    if (hexLoading && !hexBytes) {
      return (
        <SignalStatus
          className="changes-editor-file-curtain changes-editor-file-curtain-static"
          label="Loading hex"
          detail={selectedPath}
        />
      )
    }

    if (hexError) {
      return (
        <div className="changes-editor-mode-message danger-text">
          <FileCode2 size={28} />
          <strong>Hex unavailable</strong>
          <span>{hexError}</span>
        </div>
      )
    }

    if (hexBytes?.tooLarge) {
      return (
        <div className="changes-editor-mode-message danger-text">
          <FileCode2 size={28} />
          <strong>Binary file is too large</strong>
          <span>{formatBytes(hexBytes.byteSize)} exceeds the {formatBytes(hexBytes.maxBytes)} hex editor limit.</span>
        </div>
      )
    }

    return (
      <div className="changes-editor-hex-shell">
        <div className="changes-editor-hex-meta">
          <strong>{hexBytes ? `${formatBytes(hexBytes.byteSize)} loaded` : 'Hex bytes not loaded yet'}</strong>
          <span>edit byte pairs, spaces and new lines are ignored</span>
          {parsedHexDraft.bytes && <em>{parsedHexDraft.bytes.length} bytes in draft</em>}
        </div>
        {parsedHexDraft.error && (
          <div className="changes-editor-hex-error">{parsedHexDraft.error}</div>
        )}
        <div className="changes-editor-hex-grid">
          <section className="changes-editor-hex-input">
            <header>
              <strong>Editable HEX bytes</strong>
              <span>Paste or edit byte pairs here</span>
            </header>
            <textarea
              value={hexDraftText}
              onChange={(event) => setHexDraftText(event.target.value)}
              spellCheck={false}
              aria-label="Editable hex bytes"
              placeholder="00 01 02 ff"
            />
          </section>
          <section className="changes-editor-hex-preview" aria-label="Decoded hex preview">
            <header>
              <span>offset</span>
              <span>hex preview</span>
              <span>ascii preview</span>
            </header>
            {hexPreviewRows.map((row) => (
              <div className="changes-editor-hex-row" key={row.offset}>
                <code>{row.offset}</code>
                <code>{row.hex}</code>
                <code>{row.ascii}</code>
              </div>
            ))}
            {parsedHexDraft.bytes && hexPreviewRows.length * 16 < parsedHexDraft.bytes.length && (
              <p>{parsedHexDraft.bytes.length - hexPreviewRows.length * 16} more bytes hidden for preview performance.</p>
            )}
          </section>
        </div>
      </div>
    )
  }

  const updateSvgRootAttribute = (attr: string, value: string) => {
    const parsed = parseSvgDocument(draftText)
    if (!parsed.document) {
      setNotice(parsed.error || 'SVG edit failed.')
      return
    }

    const nextValue = value.trim()
    if (nextValue) parsed.document.documentElement.setAttribute(attr, nextValue)
    else parsed.document.documentElement.removeAttribute(attr)
    setDraftText(serializeSvgDocument(parsed.document))
  }

  const updateSvgColorAttribute = (target: SvgColorTarget, value: string) => {
    const parsed = parseSvgDocument(draftText)
    if (!parsed.document) {
      setNotice(parsed.error || 'SVG edit failed.')
      return
    }

    const element = svgElements(parsed.document)[target.index]
    if (!element) {
      setNotice('SVG element no longer exists.')
      return
    }

    const nextValue = value.trim()
    if (nextValue) element.setAttribute(target.attr, nextValue)
    else element.removeAttribute(target.attr)
    setDraftText(serializeSvgDocument(parsed.document))
  }

  const renderSvgEditor = () => {
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

  const toggleJsonNode = (path: string) => {
    setCollapsedJsonPaths((current) => {
      const next = new Set(current)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  const expandAllJson = () => setCollapsedJsonPaths(new Set())

  const collapseAllJson = () => {
    setCollapsedJsonPaths(new Set(jsonParseResult.expandablePaths))
  }

  const formatJsonDraft = () => {
    try {
      const formatted = `${JSON.stringify(JSON.parse(draftText), null, 2)}\n`
      setDraftText(formatted)
      setCollapsedJsonPaths(new Set())
      setJsonEdit(null)
    } catch (error) {
      setNotice(error instanceof Error ? `JSON format failed: ${error.message}` : 'JSON format failed.')
    }
  }

  const beginJsonEdit = (row: JsonTreeNode) => {
    const kind = jsonEditableKind(row.value)
    if (!kind) return
    setJsonEdit({
      path: row.path,
      kind,
      value: jsonEditInitialValue(row.value)
    })
  }

  const cancelJsonEdit = () => {
    skipJsonEditBlurRef.current = true
    setJsonEdit(null)
  }

  const commitJsonEdit = (edit = jsonEdit) => {
    if (!edit) return

    try {
      const rootValue = JSON.parse(draftText)
      const nextValue = parseJsonEditValue(edit.kind, edit.value)
      const nextRootValue = updateJsonValueAtPath(rootValue, edit.path, nextValue)
      setDraftText(`${JSON.stringify(nextRootValue, null, 2)}\n`)
      setJsonEdit(null)
    } catch (error) {
      setNotice(error instanceof Error ? `JSON edit failed: ${error.message}` : 'JSON edit failed.')
    }
  }

  const renderJsonViewer = () => {
    if (textUnavailableMessage) {
      return (
        <div className="changes-editor-mode-message">
          <FileCode2 size={28} />
          <strong>{textUnavailableMessage}</strong>
          <span>JSON text is not available for this file.</span>
        </div>
      )
    }

    if (jsonParseResult.error) {
      return (
        <div className="changes-editor-mode-message danger-text">
          <FileCode2 size={28} />
          <strong>Invalid JSON</strong>
          <span>{jsonParseResult.error}</span>
        </div>
      )
    }

    if (!draftText.trim()) {
      return (
        <div className="changes-editor-mode-message">
          <FileCode2 size={28} />
          <strong>Empty JSON</strong>
          <span>Switch to Code to add content.</span>
        </div>
      )
    }

    const rows = jsonParseResult.rows.slice(0, 2500)

    return (
      <div className="changes-editor-json-viewer">
        <div className="changes-editor-json-toolbar">
          <strong>{jsonParseResult.rows.length} visible node{jsonParseResult.rows.length === 1 ? '' : 's'}</strong>
          <span>{jsonParseResult.expandablePaths.length} collapsible</span>
          <button type="button" onClick={expandAllJson} disabled={collapsedJsonPaths.size === 0}>Expand all</button>
          <button type="button" onClick={collapseAllJson} disabled={jsonParseResult.expandablePaths.length === 0}>Collapse all</button>
          <button type="button" onClick={formatJsonDraft}>Format JSON</button>
        </div>
        <div className="changes-editor-json-tree">
          {rows.map((row) => {
            const summary = jsonValueSummary(row.value)
            const collapsed = collapsedJsonPaths.has(row.path)
            const editableKind = jsonEditableKind(row.value)
            const editing = jsonEdit?.path === row.path

            return (
              <div className="changes-editor-json-row" key={row.path || '$'} style={{ '--json-indent': `${row.depth * 18}px` } as CSSProperties}>
                <span className="changes-editor-json-line-number">{row.lineNumber ?? ''}</span>
                <button
                  type="button"
                  className="changes-editor-json-toggle"
                  aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${row.keyName ?? 'root'}`}
                  disabled={!row.expandable}
                  onClick={() => toggleJsonNode(row.path)}
                >
                  {row.expandable ? (collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />) : null}
                </button>
                <span className="changes-editor-json-key">{row.keyName ?? '$'}</span>
                <span className={`changes-editor-json-type type-${summary.type}`}>{summary.type}</span>
                <span className="changes-editor-json-value">
                  {editing && jsonEdit ? (
                    jsonEdit.kind === 'boolean' ? (
                      <select
                        className="changes-editor-json-edit"
                        autoFocus
                        value={jsonEdit.value}
                        onChange={(event) => {
                          const nextEdit = { ...jsonEdit, value: event.target.value }
                          setJsonEdit(nextEdit)
                          window.requestAnimationFrame(() => commitJsonEdit(nextEdit))
                        }}
                        onBlur={() => {
                          if (skipJsonEditBlurRef.current) {
                            skipJsonEditBlurRef.current = false
                            return
                          }
                          commitJsonEdit()
                        }}
                        onKeyDown={(event) => {
                          if (event.key === 'Escape') {
                            event.preventDefault()
                            cancelJsonEdit()
                          }
                        }}
                      >
                        <option value="true">true</option>
                        <option value="false">false</option>
                      </select>
                    ) : (
                      <input
                        className="changes-editor-json-edit"
                        autoFocus
                        value={jsonEdit.value}
                        inputMode={jsonEdit.kind === 'number' ? 'decimal' : 'text'}
                        onChange={(event) => setJsonEdit({ ...jsonEdit, value: event.target.value })}
                        onBlur={() => {
                          if (skipJsonEditBlurRef.current) {
                            skipJsonEditBlurRef.current = false
                            return
                          }
                          commitJsonEdit()
                        }}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault()
                            commitJsonEdit()
                          } else if (event.key === 'Escape') {
                            event.preventDefault()
                            cancelJsonEdit()
                          }
                        }}
                      />
                    )
                  ) : editableKind ? (
                    <button type="button" className="changes-editor-json-value-button" onClick={() => beginJsonEdit(row)} title="Edit JSON value">
                      {summary.preview}
                    </button>
                  ) : (
                    summary.preview
                  )}
                  {row.expandable && collapsed && <small>{row.childCount} hidden</small>}
                </span>
              </div>
            )
          })}
          {jsonParseResult.rows.length > rows.length && (
            <div className="changes-editor-json-more">{jsonParseResult.rows.length - rows.length} more JSON nodes hidden for performance.</div>
          )}
        </div>
      </div>
    )
  }

  const renderActiveView = () => {
    if (viewMode === 'image') return renderImagePreview()
    if (viewMode === 'svg-editor') return renderSvgEditor()
    if (viewMode === 'json') return renderJsonViewer()
    if (viewMode === 'hex') return renderHexEditor()
    return renderCodeEditor()
  }

  const renderViewModeTabs = () => {
    if (availableViewModes.length <= 1) return null

    return (
      <div className="changes-editor-view-tabs" role="tablist" aria-label="File view mode">
        {availableViewModes.map((mode) => (
          <button
            type="button"
            role="tab"
            aria-selected={viewMode === mode.id}
            className={viewMode === mode.id ? 'active' : ''}
            key={mode.id}
            onClick={() => setViewMode(mode.id)}
          >
            {mode.label}
          </button>
        ))}
      </div>
    )
  }

  useEffect(() => {
    setSelectedPath(initialFilePath ?? '')
  }, [initialFilePath])

  useEffect(() => {
    chunkPageRequestRef.current = false
    setViewMode(defaultViewModeForPath(selectedPath))
    setImagePreview(null)
    setImagePreviewError(null)
    setImagePreviewLoading(false)
    setHexBytes(null)
    setHexError(null)
    setHexLoading(false)
    setHexOriginalText('')
    setHexDraftText('')
    setChunkedTextPreview(null)
    setTextUnavailableMessage(null)
    setCollapsedJsonPaths(new Set())
    setJsonEdit(null)
    setDiagnostics([])
    setEditorScrollTop(0)
    setEditorViewportHeight(0)
    if (textareaRef.current) {
      textareaRef.current.scrollTop = 0
      textareaRef.current.scrollLeft = 0
    }
    syncEditorOverlays(0, 0)
  }, [selectedPath])

  useEffect(() => {
    if (!lintSettings.autoValidate || lintBlocked || !selectedLintSupported) {
      setDiagnostics([])
      return
    }

    const handle = window.setTimeout(() => {
      setDiagnostics(validateEditorText(selectedPath, draftText, lintSettings))
    }, 160)

    return () => window.clearTimeout(handle)
  }, [
    draftText,
    lintBlocked,
    lintSettings,
    selectedLintSupported,
    selectedPath
  ])

  useEffect(() => {
    if (!fileMenu) return

    const close = () => setFileMenu(null)
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }

    window.addEventListener('click', close)
    window.addEventListener('scroll', close, true)
    window.addEventListener('keydown', onKeyDown)

    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [fileMenu])

  useEffect(() => {
    if (!api || !currentRepoPath || !selectedPath || !PREVIEWABLE_IMAGE_RE.test(selectedPath)) return
    let cancelled = false
    setImagePreviewLoading(true)
    setImagePreviewError(null)
    void api.getImagePreview({ repoPath: currentRepoPath, filePath: selectedPath })
      .then((result) => {
        if (cancelled) return
        setImagePreviewLoading(false)
        if (result.ok) {
          setImagePreview(result.data)
          return
        }
        setImagePreview(null)
        setImagePreviewError(friendlyIpcErrorMessage(result.error.message, 'Failed to load image preview.'))
      })
      .catch((error) => {
        if (cancelled) return
        setImagePreviewLoading(false)
        setImagePreview(null)
        setImagePreviewError(friendlyIpcErrorMessage(error instanceof Error ? error.message : '', 'Failed to load image preview.'))
      })

    return () => {
      cancelled = true
    }
  }, [api, currentRepoPath, selectedPath])

  useEffect(() => {
    if (!api || !currentRepoPath || !selectedPath) return
    if (viewMode !== 'hex' && !textUnavailableMessage) return

    let cancelled = false
    setHexLoading(true)
    setHexError(null)
    void api.getRepositoryFileBytes({ repoPath: currentRepoPath, filePath: selectedPath })
      .then((result) => {
        if (cancelled) return
        setHexLoading(false)
        if (!result.ok) {
          setHexBytes(null)
          setHexError(friendlyIpcErrorMessage(result.error.message, 'Failed to load hex bytes.'))
          return
        }
        setHexBytes(result.data)
        if (result.data.tooLarge) {
          setHexOriginalText('')
          setHexDraftText('')
          return
        }
        const hexText = bytesToHexText(bytesFromBase64(result.data.base64))
        setHexOriginalText(hexText)
        setHexDraftText(hexText)
      })
      .catch((error) => {
        if (cancelled) return
        setHexLoading(false)
        setHexBytes(null)
        setHexError(friendlyIpcErrorMessage(error instanceof Error ? error.message : '', 'Failed to load hex bytes.'))
      })

    return () => {
      cancelled = true
    }
  }, [api, currentRepoPath, selectedPath, textUnavailableMessage, viewMode])

  useEffect(() => {
    setActiveSearchIndex(-1)
  }, [fileSearchQuery, selectedPath])

  useEffect(() => {
    if (activeSearchIndex >= fileSearchMatches.length && fileSearchMatches.length > 0) {
      setActiveSearchIndex(Math.max(0, fileSearchMatches.length - 1))
    }
  }, [activeSearchIndex, fileSearchMatches.length])

  useEffect(() => {
    if (fileLoading || fileError) return

    let frame = window.requestAnimationFrame(() => {
      const textarea = textareaRef.current
      if (!textarea) return

      setEditorViewportHeight(textarea.clientHeight)
      setEditorScrollTop(textarea.scrollTop)
      syncEditorOverlays(textarea.scrollLeft, textarea.scrollTop, textarea.clientHeight)
    })

    return () => {
      window.cancelAnimationFrame(frame)
    }
  }, [draftLines.length, fileError, fileLoading, selectedPath, viewMode])

  useEffect(() => {
    const clampToEditor = () => {
      const editor = editorRef.current
      if (!editor) return
      setSidebarWidth((width) => clampEditorSidebarWidth(width, editor.getBoundingClientRect().width))
    }

    let frame = window.requestAnimationFrame(() => {
      frame = window.requestAnimationFrame(clampToEditor)
    })
    window.addEventListener('resize', clampToEditor)

    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('resize', clampToEditor)
    }
  }, [])

  useEffect(() => {
    if (!api || !currentRepoPath) return
    let cancelled = false
    setFilesLoading(true)
    setFilesError(null)
    void api.listRepositoryFiles(currentRepoPath)
      .then((result) => {
        if (cancelled) return
        setFilesLoading(false)
        if (result.ok) {
          setFiles(result.data)
          setSelectedPath((current) => current || result.data[0]?.path || '')
          return
        }

        const message = friendlyIpcErrorMessage(result.error.message, 'Failed to load repository files.')
        setFilesError(message)
        setNotice(message)
      })
      .catch((error) => {
        if (cancelled) return
        setFilesLoading(false)
        const message = friendlyIpcErrorMessage(error instanceof Error ? error.message : '', 'Failed to load repository files.')
        setFilesError(message)
        setNotice(message)
      })

    return () => {
      cancelled = true
    }
  }, [api, currentRepoPath, setNotice])

  useEffect(() => {
    if (!api || !currentRepoPath || !selectedPath) return
    let cancelled = false
    setFileLoading(true)
    setFileError(null)
    setTextUnavailableMessage(null)
    void api.getRepositoryFileChunk({
      repoPath: currentRepoPath,
      filePath: selectedPath,
      offset: 0,
      maxBytes: EDITOR_FILE_CHUNK_BYTES
    })
      .then((result) => {
        if (cancelled) return
        setFileLoading(false)
        if (!result.ok) {
          setFileError(friendlyIpcErrorMessage(result.error.message, 'Failed to load file.'))
          setOriginalText('')
          setDraftText('')
          return
        }
        if (result.data.binary) {
          if (PREVIEWABLE_IMAGE_RE.test(selectedPath)) {
            setTextUnavailableMessage('Binary image preview only.')
            setOriginalText('')
            setDraftText('')
            return
          }
          setTextUnavailableMessage('Binary file - Hex editor available.')
          setViewMode('hex')
          setOriginalText('')
          setDraftText('')
          return
        }
        if (result.data.hasMore) {
          const preview = chunkedTextPreviewFromResult(result.data, {
            startLine: 1,
            previous: []
          })
          setChunkedTextPreview(preview)
          setOriginalText(result.data.text)
          setDraftText(result.data.text)
          setViewMode('code')
          return
        }
        setChunkedTextPreview(null)
        setOriginalText(result.data.text)
        setDraftText(result.data.text)
      })
      .catch((error) => {
        if (cancelled) return
        setFileLoading(false)
        setFileError(friendlyIpcErrorMessage(error instanceof Error ? error.message : '', 'Failed to load file.'))
        setOriginalText('')
        setDraftText('')
      })

    return () => {
      cancelled = true
    }
  }, [api, currentRepoPath, selectedPath])

  const stageFileFromMenu = () => {
    const path = fileMenu?.path
    const change = contextMenuChange
    setFileMenu(null)
    if (!path || !change || !currentRepoPath || !api) return
    void runSnapshotAction('File staged.', () => api.stageFile({ repoPath: currentRepoPath, filePath: path }))
  }

  const unstageFileFromMenu = () => {
    const path = fileMenu?.path
    const change = contextMenuChange
    setFileMenu(null)
    if (!path || !change || !currentRepoPath || !api) return
    void runSnapshotAction('File unstaged.', () => api.unstageFile({ repoPath: currentRepoPath, filePath: path }))
  }

  const openInEditorFromMenu = () => {
    const path = fileMenu?.path
    setFileMenu(null)
    if (!path || !currentRepoPath || !api) return
    void api.openInEditor({ targetPath: buildRepoFilePath(currentRepoPath, path) }).then((result) => {
      setNotice(result.ok ? result.data.message || 'File opened in editor.' : result.error.message)
    })
  }

  const openTerminalFromMenu = () => {
    const path = fileMenu?.path
    setFileMenu(null)
    if (!path || !currentRepoPath || !api) return
    void api.openTerminal(buildRepoFileDirectory(currentRepoPath, path)).then((result) => {
      setNotice(result.ok ? result.data.message || 'Terminal opened.' : result.error.message)
    })
  }

  const showInFileManagerFromMenu = () => {
    const path = fileMenu?.path
    setFileMenu(null)
    if (!path || !currentRepoPath || !api) return
    void api.showItemInFolder(buildRepoFilePath(currentRepoPath, path)).then((result) => {
      setNotice(result.ok ? result.data.message || 'Shown in file manager.' : result.error.message)
    })
  }

  const copyPathFromMenu = () => {
    const path = fileMenu?.path
    setFileMenu(null)
    if (!path || !currentRepoPath) return
    void navigator.clipboard.writeText(buildRepoFilePath(currentRepoPath, path))
  }

  const copyNameFromMenu = () => {
    const path = fileMenu?.path
    setFileMenu(null)
    if (!path) return
    void navigator.clipboard.writeText(path.split('/').pop() ?? path)
  }

  const reloadEditorFiles = async (preferredPath?: string) => {
    if (!api || !currentRepoPath) return []
    setFilesLoading(true)
    setFilesError(null)
    try {
      const result = await api.listRepositoryFiles(currentRepoPath)
      setFilesLoading(false)
      if (!result.ok) {
        const message = friendlyIpcErrorMessage(result.error.message, 'Failed to load repository files.')
        setFilesError(message)
        setNotice(message)
        return []
      }

      setFiles(result.data)
      setSelectedPath((current) => {
        if (preferredPath && result.data.some((file) => file.path === preferredPath)) return preferredPath
        if (current && result.data.some((file) => file.path === current)) return current
        return result.data[0]?.path || ''
      })
      return result.data
    } catch (error) {
      setFilesLoading(false)
      const message = friendlyIpcErrorMessage(error instanceof Error ? error.message : '', 'Failed to load repository files.')
      setFilesError(message)
      setNotice(message)
      return []
    }
  }

  const renameFileFromMenu = async () => {
    const path = fileMenu?.path
    setFileMenu(null)
    if (!path || !currentRepoPath || !api) return
    if (path === selectedPath && dirty && !window.confirm('Rename this file and discard unsaved editor edits?')) return

    const nextPath = window.prompt('Rename file inside this repository:', path)?.trim().replace(/\\/g, '/')
    if (!nextPath || nextPath === path) return

    const result = await runSnapshotAction('File renamed.', () => api.renameRepositoryFile({
      repoPath: currentRepoPath,
      filePath: path,
      newFilePath: nextPath
    }))
    if (result !== false) {
      await reloadEditorFiles(nextPath)
    }
  }

  const deleteFileFromMenu = async () => {
    const path = fileMenu?.path
    setFileMenu(null)
    if (!path || !currentRepoPath || !api) return
    const dirtyWarning = path === selectedPath && dirty ? '\n\nUnsaved editor edits will be discarded.' : ''
    if (!window.confirm(`Delete ${path}?${dirtyWarning}`)) return

    const result = await runSnapshotAction('File deleted.', () => api.deleteRepositoryFile({
      repoPath: currentRepoPath,
      filePath: path,
      confirmed: true
    }))
    if (result !== false) {
      await reloadEditorFiles()
    }
  }

  const saveFile = async () => {
    if (!api || !currentRepoPath || !selectedPath || textSaveBlocked || !dirty || fileError) return
    setSaving(true)
    try {
      if (hexDirty || viewMode === 'hex') {
        const parsed = parseHexText(hexDraftText)
        if (!parsed.bytes || parsed.error) {
          setNotice(parsed.error || 'Hex byte stream is invalid.')
          return
        }
        const bytes = parsed.bytes
        const result = await runSnapshotAction('File saved.', () => api.writeRepositoryFileBytes({
          repoPath: currentRepoPath,
          filePath: selectedPath,
          base64: base64FromBytes(bytes)
        }))
        if (result !== false) {
          const nextHexText = bytesToHexText(bytes)
          setHexOriginalText(nextHexText)
          setHexDraftText(nextHexText)
          setHexBytes((current) => current ? {
            ...current,
            base64: base64FromBytes(bytes),
            byteSize: bytes.length,
            tooLarge: false
          } : current)
        }
        return
      }

      const result = await runSnapshotAction('File saved.', () => api.writeRepositoryFile({
        repoPath: currentRepoPath,
        filePath: selectedPath,
        text: draftText
      }))
      if (result !== false) {
        setOriginalText(draftText)
      }
    } finally {
      setSaving(false)
    }
  }

  const resetAfterBeautify = (nextText: string) => {
    setDraftText(nextText)
    setViewMode('code')
    setCollapsedJsonPaths(new Set())
    setJsonEdit(null)
    window.requestAnimationFrame(() => {
      if (textareaRef.current) {
        updateEditorLineWindowState(textareaRef.current.scrollTop, textareaRef.current.clientHeight)
        syncEditorOverlays(textareaRef.current.scrollLeft, textareaRef.current.scrollTop, textareaRef.current.clientHeight)
      }
    })
  }

  const beautifyFile = () => {
    if (!selectedPath || chunkedReadOnly || fileLoading || fileError || textUnavailableMessage || viewMode === 'image') return
    setBeautifying(true)
    try {
      const nextText = beautifyTextLocally(selectedPath, draftText)
      if (!beautifyPreservesTokens(draftText, nextText)) {
        setNotice('Beautify was rejected because it changed code tokens. No changes applied.')
        return
      }

      if (nextText === draftText) {
        setNotice('Beautify made no changes.')
        return
      }

      resetAfterBeautify(nextText)
    } catch (error) {
      setNotice(error instanceof Error ? `Beautify failed: ${error.message}` : 'Beautify failed.')
    } finally {
      setBeautifying(false)
    }
  }

  const beautifyFileWithAi = async () => {
    if (!api || !currentRepoPath || !selectedPath || chunkedReadOnly || fileLoading || fileError || textUnavailableMessage || viewMode === 'image') return
    setAiBeautifying(true)
    try {
      const result = await api.beautifyFileWithAssistant({
        repoPath: currentRepoPath,
        assistant: selectedAssistant,
        filePath: selectedPath,
        text: draftText
      })

      if (!result.ok) {
        setNotice(friendlyIpcErrorMessage(result.error.message, 'AI beautify failed.'))
        return
      }

      const nextText = normalizeTextForEditor(result.data.content)
      if (!beautifyPreservesTokens(draftText, nextText)) {
        setNotice('AI Beautify was rejected because it changed code tokens. No changes applied.')
        return
      }

      if (nextText === draftText) {
        setNotice('AI Beautify made no changes.')
        return
      }

      resetAfterBeautify(nextText)
    } catch (error) {
      setNotice(friendlyIpcErrorMessage(error instanceof Error ? error.message : '', 'AI beautify failed.'))
    } finally {
      setAiBeautifying(false)
    }
  }

  const revertLiveChange = (change: LiveLineChange) => {
    const nextLine = change.kind === 'added' ? null : change.before
    setDraftText((current) => updateLineInText(current, change.lineNumber, nextLine))
    setJsonEdit(null)
  }

  const syncHighlightScroll = (event: ReactUIEvent<HTMLTextAreaElement>) => {
    updateEditorLineWindowState(event.currentTarget.scrollTop, event.currentTarget.clientHeight)
    syncEditorOverlays(event.currentTarget.scrollLeft, event.currentTarget.scrollTop, event.currentTarget.clientHeight)
    const remainingScroll = event.currentTarget.scrollHeight - event.currentTarget.scrollTop - event.currentTarget.clientHeight
    if (chunkedTextPreview?.hasMore && !chunkedTextPreview.loading && remainingScroll < 64) {
      void loadChunkedTextPage('next')
    }
  }

  return (
    <section className="changes-internal-editor" ref={editorRef} style={editorStyle}>
      <aside className="changes-editor-sidebar">
        <button type="button" className="secondary changes-editor-back" onClick={onBack}>
          <ArrowLeft size={16} />
          Back to diff
        </button>
        <label className="changes-editor-search">
          <Search size={15} />
          <input value={fileQuery} onChange={(event) => setFileQuery(event.target.value)} placeholder="Search repository files" />
        </label>
        <div className="changes-editor-file-list">
          {filesLoading ? (
            <div className="quiet-box">Loading files.</div>
          ) : filesError ? (
            <div className="quiet-box danger-text">{filesError}</div>
          ) : visibleFiles.length === 0 ? (
            <div className="quiet-box">No files match this search.</div>
          ) : (
            <div className="changes-editor-tree-root">
              {visibleFileTree.files.map((file) => renderFileRow(file, file.path))}
              {visibleFileTree.children.map((folder) => renderFolderTree(folder, 0))}
            </div>
          )}
        </div>
      </aside>

      <div
        className="changes-editor-splitter"
        role="separator"
        aria-label="Resize file list and editor"
        aria-orientation="vertical"
        aria-valuemin={EDITOR_SIDEBAR_MIN_WIDTH}
        aria-valuemax={EDITOR_SIDEBAR_MAX_WIDTH}
        aria-valuenow={sidebarWidth}
        tabIndex={0}
        onPointerDown={startSidebarResize}
        onKeyDown={handleSidebarResizeKeyDown}
      >
        <span />
      </div>

      <div className="changes-editor-main">
        <header className="changes-editor-header">
          <div className="changes-editor-header-main">
            <h3>
              <FileCode2 size={16} />
              {selectedPath || 'Select a file'}
            </h3>
            <p>
              <span className={`file-type-icon file-type-${selectedIcon.tone}`} title={selectedIcon.title} aria-hidden="true">
                {selectedIcon.label}
              </span>
              {hexDirty
                ? `${parsedHexDraft.bytes?.length ?? 0} edited byte${parsedHexDraft.bytes?.length === 1 ? '' : 's'} since load`
                : chunkedTextPreview
                  ? `Read-only chunk ${formatBytes(chunkedTextPreview.startOffset)}-${formatBytes(chunkedTextPreview.endOffset)} of ${formatBytes(chunkedTextPreview.byteSize)}`
                : textUnavailableMessage ? textUnavailableMessage : textDirty ? `${editedLines} edited line${editedLines === 1 ? '' : 's'} since load` : 'No edits since load'}
            </p>
            {renderViewModeTabs()}
          </div>
          <div className="changes-editor-header-actions">
            <label className="changes-editor-file-search">
              <Search size={15} />
              <input
                value={fileSearchQuery}
                onChange={(event) => setFileSearchQuery(event.target.value)}
                onKeyDown={handleFileSearchKeyDown}
                placeholder="Search in file"
                disabled={!selectedPath || fileLoading || Boolean(fileError) || Boolean(textUnavailableMessage) || viewMode === 'image' || viewMode === 'hex'}
              />
              {fileSearchQuery && (
                <button type="button" title="Clear file search" aria-label="Clear file search" onClick={() => setFileSearchQuery('')}>
                  <X size={14} />
                </button>
              )}
              <span className="changes-editor-search-count">
                {fileSearchQuery.trim()
                  ? `${activeSearchIndex >= 0 ? activeSearchIndex + 1 : 0}/${fileSearchMatches.length}${fileSearchOverflow ? '+' : ''}`
                  : '0/0'}
              </span>
              <button type="button" title="Previous match" aria-label="Previous match" disabled={fileSearchMatches.length === 0} onClick={() => activateSearchMatch(activeSearchIndex < 0 ? -1 : activeSearchIndex - 1)}>
                <ChevronUp size={14} />
              </button>
              <button type="button" title="Next match" aria-label="Next match" disabled={fileSearchMatches.length === 0} onClick={() => activateSearchMatch(activeSearchIndex < 0 ? 0 : activeSearchIndex + 1)}>
                <ChevronDown size={14} />
              </button>
            </label>
            <details className={['changes-editor-lint-menu', diagnostics.length > 0 ? 'has-issues' : '', (!selectedLintSupported || lintBlocked) ? 'disabled' : ''].filter(Boolean).join(' ')}>
              <summary
                title={selectedLintSupported ? 'Lint current file' : 'Lint supports JSON, JSONC, JS, TS, JSX, and TSX files'}
                onClick={(event) => {
                  if (!selectedLintSupported || lintBlocked) event.preventDefault()
                }}
              >
                <Code2 size={15} />
                Lint
                {diagnostics.length > 0 && <span>{diagnostics.length}</span>}
              </summary>
              <div className="changes-editor-lint-popover">
                <button
                  type="button"
                  onClick={(event) => {
                    event.preventDefault()
                    runLint(true)
                  }}
                  disabled={!selectedLintSupported || lintBlocked}
                >
                  Run lint now
                </button>
                <label>
                  <input
                    type="checkbox"
                    checked={lintSettings.autoValidate}
                    onChange={(event) => updateLintSettings({ autoValidate: event.currentTarget.checked })}
                  />
                  Auto validate on open/edit
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={lintSettings.validateJson}
                    onChange={(event) => updateLintSettings({ validateJson: event.currentTarget.checked })}
                  />
                  JSON syntax
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={lintSettings.allowJsonComments}
                    onChange={(event) => updateLintSettings({ allowJsonComments: event.currentTarget.checked })}
                    disabled={!lintSettings.validateJson}
                  />
                  JSONC comments for config files
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={lintSettings.allowJsonTrailingCommas}
                    onChange={(event) => updateLintSettings({ allowJsonTrailingCommas: event.currentTarget.checked })}
                    disabled={!lintSettings.validateJson}
                  />
                  JSONC trailing commas
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={lintSettings.validateScripts}
                    onChange={(event) => updateLintSettings({ validateScripts: event.currentTarget.checked })}
                  />
                  JS/TS brackets and strings
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={lintSettings.validateRegexLiterals}
                    onChange={(event) => updateLintSettings({ validateRegexLiterals: event.currentTarget.checked })}
                    disabled={!lintSettings.validateScripts}
                  />
                  JS/TS regex literals
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={lintSettings.validateJsxTsx}
                    onChange={(event) => updateLintSettings({ validateJsxTsx: event.currentTarget.checked })}
                  />
                  JSX/TSX safe checks
                </label>
              </div>
            </details>
            <button
              type="button"
              className="changes-editor-tool-button"
              onClick={beautifyFile}
              disabled={!selectedPath || chunkedReadOnly || beautifying || aiBeautifying || fileLoading || Boolean(fileError) || Boolean(textUnavailableMessage) || viewMode === 'image'}
              title={chunkedReadOnly ? 'Beautify is disabled for chunked previews' : 'Beautify locally'}
            >
              <Sparkles size={15} />
              {beautifying ? 'Beautifying...' : 'Beautify'}
            </button>
            <button
              type="button"
              className="changes-editor-tool-button ai"
              onClick={beautifyFileWithAi}
              disabled={!api || !currentRepoPath || !selectedPath || chunkedReadOnly || beautifying || aiBeautifying || fileLoading || Boolean(fileError) || Boolean(textUnavailableMessage) || viewMode === 'image'}
              title={chunkedReadOnly ? 'AI Beautify is disabled for chunked previews' : 'Beautify with assistant'}
            >
              <WandSparkles size={15} />
              {aiBeautifying ? 'AI...' : 'AI Beautify'}
            </button>
            <button
              type="button"
              className="changes-editor-save-button"
              onClick={saveFile}
              disabled={!selectedPath || textSaveBlocked || !dirty || saving || fileLoading || hexLoading || Boolean(fileError) || Boolean(parsedHexDraft.error) || (Boolean(textUnavailableMessage) && !hexDirty)}
            >
              <Save size={16} />
              {saving ? 'Saving...' : 'Save file'}
            </button>
          </div>
        </header>

        {fileError ? (
          <div className="quiet-box danger-text">{fileError}</div>
        ) : (
          <div
            className={textDirty && viewMode === 'code' && !textUnavailableMessage ? 'changes-editor-body has-live-diff' : 'changes-editor-body'}
            onContextMenuCapture={(event) => {
              if (selectedPath) openFileContextMenu(event, selectedPath)
            }}
          >
            {renderActiveView()}
            {fileLoading && (
              <SignalStatus
                className="changes-editor-file-curtain changes-editor-body-curtain"
                label="Loading file"
                detail={selectedPath}
              />
            )}
            {textDirty && !fileLoading && viewMode === 'code' && !textUnavailableMessage && (
              <aside className="changes-editor-live-diff" aria-label="Live file changes">
                <header>
                  <strong>Live changes</strong>
                  <span>{editedLines}</span>
                </header>
                <div>
                  {liveChanges.slice(0, 120).map((change) => (
                    <article className={`changes-editor-live-row ${change.kind}`} key={`${change.lineNumber}-${change.kind}`}>
                      <span>{change.lineNumber}</span>
                      <code>{highlight(change.after || change.before || ' ', selectedLang)}</code>
                      <button
                        type="button"
                        className="changes-editor-live-revert"
                        onClick={() => revertLiveChange(change)}
                        title={change.kind === 'added' ? 'Remove this added line' : 'Revert this line'}
                        aria-label={change.kind === 'added' ? `Remove added line ${change.lineNumber}` : `Revert line ${change.lineNumber}`}
                      >
                        <RotateCcw size={13} />
                      </button>
                      {change.kind === 'modified' && <small>{highlight(change.before || ' ', selectedLang)}</small>}
                    </article>
                  ))}
                  {liveChanges.length > 120 && <p>{liveChanges.length - 120} more changed lines.</p>}
                </div>
              </aside>
            )}
          </div>
        )}
      </div>

      {fileMenu && (
        <div className="context-menu changes-editor-context-menu" role="menu" style={{ top: fileMenu.y, left: fileMenu.x }}>
          <button
            type="button"
            role="menuitem"
            title="Stage this file"
            onClick={stageFileFromMenu}
            disabled={!contextMenuChange || (!contextMenuChange.unstaged && !contextMenuChange.untracked) || !api || !currentRepoPath}
          >
            <PlusSquare size={15} />
            Stage file
          </button>
          <button
            type="button"
            role="menuitem"
            title="Unstage this file"
            onClick={unstageFileFromMenu}
            disabled={!contextMenuChange?.staged || !api || !currentRepoPath}
          >
            <MinusSquare size={15} />
            Unstage file
          </button>
          <div className="context-menu-separator" role="separator" />
          <button type="button" role="menuitem" title="Rename this file" onClick={renameFileFromMenu} disabled={!api || !currentRepoPath}>
            <Pencil size={15} />
            Rename file
          </button>
          <button type="button" role="menuitem" title="Delete this file from the working tree" onClick={deleteFileFromMenu} disabled={!api || !currentRepoPath}>
            <Trash2 size={15} />
            Delete file
          </button>
          <div className="context-menu-separator" role="separator" />
          <button type="button" role="menuitem" title="Open this file in your editor" onClick={openInEditorFromMenu} disabled={!api || !currentRepoPath}>
            <Code2 size={15} />
            Open in editor
          </button>
          <button type="button" role="menuitem" title="Open a terminal in this file's folder" onClick={openTerminalFromMenu} disabled={!api || !currentRepoPath}>
            <Terminal size={15} />
            Open in terminal
          </button>
          <button type="button" role="menuitem" title="Show this file in the file manager" onClick={showInFileManagerFromMenu} disabled={!api || !currentRepoPath}>
            <FolderOpen size={15} />
            Show in file manager
          </button>
          <div className="context-menu-separator" role="separator" />
          <button type="button" role="menuitem" title="Copy the absolute file path" onClick={copyPathFromMenu}>
            <Copy size={15} />
            Copy path
          </button>
          <button type="button" role="menuitem" title="Copy the file name" onClick={copyNameFromMenu}>
            <Copy size={15} />
            Copy file name
          </button>
        </div>
      )}
    </section>
  )
}
