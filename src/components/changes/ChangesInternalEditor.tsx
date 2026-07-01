import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type ChangeEvent as ReactChangeEvent,
  type ClipboardEvent as ReactClipboardEvent,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type UIEvent as ReactUIEvent
} from 'react'
import { ArrowLeft, ChevronDown, ChevronRight, ChevronUp, Code2, Copy, FileCode2, FileImage, Folder, FolderOpen, MinusSquare, Pencil, PlusSquare, RotateCcw, Save, Search, Sparkles, Terminal, Trash2, WandSparkles, X } from 'lucide-react'
import type { ApiResult, AssistantId, BranchPilotApi, DiffLine, DiffResult, ImagePreview, RepositoryFileChunkResult, RepositoryFileEntry, RepositorySnapshot } from '../../shared/branchPilot'
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
const EDITOR_FILE_CONTENT_SEARCH_MIN_LENGTH = 2
const EDITOR_FILE_CONTENT_SEARCH_FILE_LIMIT = 120
const EDITOR_FILE_CONTENT_SEARCH_RESULT_LIMIT = 80
const EDITOR_FILE_CONTENT_SEARCH_BATCH_SIZE = 6
const EDITOR_FILE_CONTENT_SEARCH_DEBOUNCE_MS = 260
const EDITOR_LINE_HEIGHT = 20.4
const EDITOR_FILE_CHUNK_BYTES = 48_000
const EDITOR_LIVE_DIFF_LCS_CELL_LIMIT = 240_000
const EDITOR_TEXT_HISTORY_LIMIT = 200
const HEX_BYTES_PER_ROW = 16
const HEX_CHUNK_BYTES = 16 * 1024
const HEX_SEARCH_MATCH_LIMIT = 500
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

function isNativeEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  return target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
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

interface LiveLineChange {
  lineNumber: number
  kind: 'added' | 'removed' | 'modified'
  before: string
  after: string
}

interface EditorOverviewMarker {
  lineNumber: number
  kind: 'added' | 'removed' | 'modified' | 'search' | 'diagnostic'
  title: string
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

interface HexEditorRow {
  offset: number
  bytes: number[]
}

interface HexBytePreview {
  filePath: string
  byteSize: number
  startOffset: number
  endOffset: number
  hasMore: boolean
  fullFileLoaded: boolean
}

interface HexSearchMatch {
  offset: number
  length: number
}

interface EditorTextHistoryEntry {
  text: string
  selectionStart: number
  selectionEnd: number
}

interface EditorTextRange {
  start: number
  end: number
}

interface EditableTextLines {
  lines: string[]
  hasTrailingNewline: boolean
}

interface FileSearchMatch {
  lineNumber: number
  column: number
  length: number
}

interface FileLineSearchTarget {
  lineNumber: number
  column: number
}

interface RepositoryContentSearchMatch {
  filePath: string
  lineNumber: number
  column: number
  length: number
  byteOffset: number
  preview: string
}

interface RepositoryContentSearchState {
  status: 'idle' | 'searching' | 'done'
  scanned: number
  truncated: boolean
  error: string | null
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
  markers: ChunkedTextMarker[]
  pageIndex: number
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

type EditorLintRunStatus = 'idle' | 'running' | 'clean' | 'issues' | 'blocked'

interface EditorLintRunState {
  status: EditorLintRunStatus
  message: string
  detail: string
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
  options: { startLine: number; markers: ChunkedTextMarker[]; pageIndex: number }
): ChunkedTextPreview {
  return {
    filePath: result.filePath,
    text: result.text,
    byteSize: result.byteSize,
    startOffset: result.startOffset,
    endOffset: result.endOffset,
    startLine: options.startLine,
    hasMore: result.hasMore,
    markers: options.markers,
    pageIndex: options.pageIndex,
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

function utf8ByteOffset(text: string, charOffset: number): number {
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

function parseEditorJsonText(filePath: string, text: string, settings: EditorLintSettings): { value: unknown; preparedText: string; source: EditorDiagnostic['source'] } {
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

function validateEditorText(filePath: string, text: string, settings: EditorLintSettings): EditorDiagnostic[] {
  if (settings.validateJson && JSON_RE.test(filePath)) return validateJsonText(filePath, text, settings)
  if (settings.validateJsxTsx && JSX_TSX_RE.test(filePath)) return validateScriptStructure(text, { source: 'JSX/TSX', validateRegexLiterals: false })
  if (settings.validateScripts && PLAIN_SCRIPT_RE.test(filePath)) {
    return validateScriptStructure(text, { source: 'JS/TS', validateRegexLiterals: settings.validateRegexLiterals })
  }
  return []
}

function lintRulesEnabledForFile(filePath: string, settings: EditorLintSettings): boolean {
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

function lintStateFromDiagnostics(diagnostics: EditorDiagnostic[], filePath: string, source: 'Manual' | 'Auto'): EditorLintRunState {
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
  for (let offset = 0; offset < bytes.length; offset += HEX_BYTES_PER_ROW) {
    rows.push(Array.from(bytes.subarray(offset, offset + HEX_BYTES_PER_ROW), byteToHex).join(' '))
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

function byteToHex(byte: number): string {
  return byte.toString(16).padStart(2, '0')
}

function normalizeHexByteDraft(rawDraft: string): string {
  return rawDraft.trim().replace(/[^0-9a-f]/gi, '').slice(0, 2).toLowerCase()
}

function asciiFromByte(byte: number): string {
  return byte >= 32 && byte <= 126 ? String.fromCharCode(byte) : '.'
}

function hexEditorRows(bytes: Uint8Array, startOffset = 0): HexEditorRow[] {
  const rows: HexEditorRow[] = []
  for (let offset = 0; offset < bytes.length; offset += HEX_BYTES_PER_ROW) {
    rows.push({
      offset: startOffset + offset,
      bytes: Array.from(bytes.subarray(offset, offset + HEX_BYTES_PER_ROW))
    })
  }
  return rows
}

function offsetToHex(offset: number): string {
  return Math.max(0, Math.floor(offset)).toString(16).padStart(8, '0')
}

function alignHexOffset(offset: number): number {
  return Math.floor(Math.max(0, offset) / HEX_BYTES_PER_ROW) * HEX_BYTES_PER_ROW
}

function parseHexOffsetDraft(rawDraft: string): number | null {
  const draft = rawDraft.trim()
  if (!draft) return null
  if (/^0x[0-9a-f]+$/i.test(draft)) return Number.parseInt(draft.slice(2), 16)
  if (/[a-f]/i.test(draft) && /^[0-9a-f]+$/i.test(draft)) return Number.parseInt(draft, 16)
  if (/^\d+$/.test(draft)) return Number.parseInt(draft, 10)
  return null
}

function selectedTextRange(text: string, start: number, end: number): EditorTextRange | null {
  const safeStart = clamp(Math.min(start, end), 0, text.length)
  const safeEnd = clamp(Math.max(start, end), 0, text.length)
  if (safeStart !== safeEnd) return { start: safeStart, end: safeEnd }

  const isWord = (char: string) => /[\p{L}\p{N}_$-]/u.test(char)
  let wordStart = safeStart
  let wordEnd = safeEnd
  while (wordStart > 0 && isWord(text[wordStart - 1] ?? '')) wordStart -= 1
  while (wordEnd < text.length && isWord(text[wordEnd] ?? '')) wordEnd += 1
  return wordStart === wordEnd ? null : { start: wordStart, end: wordEnd }
}

function rangesOverlap(a: EditorTextRange, b: EditorTextRange): boolean {
  return a.start < b.end && b.start < a.end
}

function normalizeTextRanges(ranges: EditorTextRange[]): EditorTextRange[] {
  return [...ranges]
    .map((range) => ({ start: Math.min(range.start, range.end), end: Math.max(range.start, range.end) }))
    .sort((a, b) => a.start - b.start || a.end - b.end)
}

function bytesForHexSearch(rawQuery: string): Uint8Array | null {
  const query = rawQuery.trim()
  if (!query) return null
  const compactHex = query.replace(/(?:0x|[\s,_-])/gi, '')
  if (compactHex.length >= 2 && compactHex.length % 2 === 0 && /^[0-9a-f]+$/i.test(compactHex)) {
    const bytes = new Uint8Array(compactHex.length / 2)
    for (let index = 0; index < compactHex.length; index += 2) {
      bytes[index / 2] = Number.parseInt(compactHex.slice(index, index + 2), 16)
    }
    return bytes
  }

  const asciiBytes = new Uint8Array(query.length)
  for (let index = 0; index < query.length; index += 1) {
    const code = query.charCodeAt(index)
    if (code > 0xff) return null
    asciiBytes[index] = code
  }
  return asciiBytes
}

function findHexSearchMatches(bytes: Uint8Array | null, query: string, startOffset: number): HexSearchMatch[] {
  const needle = bytesForHexSearch(query)
  if (!bytes || !needle || needle.length === 0 || needle.length > bytes.length) return []

  const matches: HexSearchMatch[] = []
  for (let index = 0; index <= bytes.length - needle.length; index += 1) {
    let matched = true
    for (let needleIndex = 0; needleIndex < needle.length; needleIndex += 1) {
      if (bytes[index + needleIndex] !== needle[needleIndex]) {
        matched = false
        break
      }
    }
    if (!matched) continue
    matches.push({ offset: startOffset + index, length: needle.length })
    if (matches.length >= HEX_SEARCH_MATCH_LIMIT) break
  }
  return matches
}

function hexByteInMatch(offset: number, matches: HexSearchMatch[]): boolean {
  return matches.some((match) => offset >= match.offset && offset < match.offset + match.length)
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

function parseFileLineSearchQuery(query: string): FileLineSearchTarget | null {
  const match = query.trim().match(/^(?:(?:line|ln|l)\s*)?(?:[:#])?\s*(\d+)(?::(\d+))?$/i)
  if (!match) return null

  const lineNumber = Number(match[1])
  const column = match[2] ? Number(match[2]) : 1
  if (!Number.isInteger(lineNumber) || lineNumber < 1 || !Number.isInteger(column) || column < 1) return null
  return { lineNumber, column: column - 1 }
}

function isLikelyContentSearchFile(filePath: string): boolean {
  return !/\.(?:png|jpe?g|gif|webp|bmp|ico|icns|avif|pdf|zip|7z|rar|gz|tgz|bz2|xz|exe|dll|so|dylib|bin|lockb|woff2?|ttf|otf)$/i.test(filePath)
}

function findRepositoryContentMatch(filePath: string, text: string, query: string): RepositoryContentSearchMatch | null {
  const needle = query.trim().toLowerCase()
  if (!needle) return null

  const lines = textLines(text)
  let lineStartOffset = 0
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const column = line.toLowerCase().indexOf(needle)
    if (column < 0) {
      lineStartOffset += line.length + 1
      continue
    }

    const previewStart = Math.max(0, column - 36)
    const previewEnd = Math.min(line.length, column + query.length + 72)
    const prefix = previewStart > 0 ? '...' : ''
    const suffix = previewEnd < line.length ? '...' : ''
    return {
      filePath,
      lineNumber: index + 1,
      column,
      length: query.length,
      byteOffset: utf8ByteOffset(text, lineStartOffset),
      preview: `${prefix}${line.slice(previewStart, previewEnd).trim()}${suffix}`
    }
  }

  return null
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
    chunks.push(<span key={`tail-${key}`}>{highlight(line.slice(last), lang)}</span>)
  }

  return chunks.length ? chunks : highlight(line || ' ', lang)
}

function buildLiveLineChanges(originalText: string, draftText: string): LiveLineChange[] {
  const original = textLines(originalText)
  const draft = textLines(draftText)
  let prefixLength = 0

  while (
    prefixLength < original.length &&
    prefixLength < draft.length &&
    original[prefixLength] === draft[prefixLength]
  ) {
    prefixLength += 1
  }

  let suffixLength = 0
  while (
    suffixLength + prefixLength < original.length &&
    suffixLength + prefixLength < draft.length &&
    original[original.length - 1 - suffixLength] === draft[draft.length - 1 - suffixLength]
  ) {
    suffixLength += 1
  }

  const originalMiddle = original.slice(prefixLength, original.length - suffixLength)
  const draftMiddle = draft.slice(prefixLength, draft.length - suffixLength)

  return compactLiveLineChanges(
    buildMiddleLiveLineChanges(originalMiddle, draftMiddle, prefixLength)
  )
}

function putLineChange(map: Map<number, LiveLineChange>, change: LiveLineChange) {
  const current = map.get(change.lineNumber)
  if (!current) {
    map.set(change.lineNumber, change)
    return
  }

  if (current.kind === 'modified' || change.kind === current.kind) return
  map.set(change.lineNumber, { ...change, kind: 'modified' })
}

function buildGitLineChanges(diffs: DiffResult[], filePath: string): LiveLineChange[] {
  const byLine = new Map<number, LiveLineChange>()

  for (const diff of diffs) {
    for (const file of diff.files) {
      if (file.newPath !== filePath && file.oldPath !== filePath) continue

      for (const hunk of file.hunks) {
        for (let index = 0; index < hunk.lines.length;) {
          const line = hunk.lines[index]

          if (line.type === 'remove') {
            const removed: DiffLine[] = []
            while (hunk.lines[index]?.type === 'remove') {
              removed.push(hunk.lines[index])
              index += 1
            }

            const added: DiffLine[] = []
            while (hunk.lines[index]?.type === 'add') {
              added.push(hunk.lines[index])
              index += 1
            }

            const pairCount = Math.min(removed.length, added.length)
            for (let pairIndex = 0; pairIndex < pairCount; pairIndex += 1) {
              const addedLine = added[pairIndex]
              const removedLine = removed[pairIndex]
              putLineChange(byLine, {
                lineNumber: addedLine.newLineNumber ?? removedLine.oldLineNumber ?? hunk.newStart,
                kind: 'modified',
                before: removedLine.content,
                after: addedLine.content
              })
            }
            for (let addIndex = pairCount; addIndex < added.length; addIndex += 1) {
              const addedLine = added[addIndex]
              putLineChange(byLine, {
                lineNumber: addedLine.newLineNumber ?? hunk.newStart,
                kind: 'added',
                before: '',
                after: addedLine.content
              })
            }
            for (let removeIndex = pairCount; removeIndex < removed.length; removeIndex += 1) {
              const removedLine = removed[removeIndex]
              putLineChange(byLine, {
                lineNumber: removedLine.oldLineNumber ?? hunk.newStart,
                kind: 'removed',
                before: removedLine.content,
                after: ''
              })
            }
            continue
          }

          if (line.type === 'add') {
            putLineChange(byLine, {
              lineNumber: line.newLineNumber ?? hunk.newStart,
              kind: 'added',
              before: '',
              after: line.content
            })
          }

          index += 1
        }
      }
    }
  }

  return [...byLine.values()].sort((a, b) => a.lineNumber - b.lineNumber)
}

function buildMiddleLiveLineChanges(original: string[], draft: string[], startIndex: number): LiveLineChange[] {
  const changes: LiveLineChange[] = []

  if (original.length * draft.length > EDITOR_LIVE_DIFF_LCS_CELL_LIMIT) {
    const pairedCount = Math.min(original.length, draft.length)
    for (let index = 0; index < pairedCount; index += 1) {
      if (original[index] === draft[index]) continue
      changes.push({
        lineNumber: startIndex + index + 1,
        kind: 'modified',
        before: original[index],
        after: draft[index]
      })
    }
    for (let index = pairedCount; index < draft.length; index += 1) {
      changes.push({
        lineNumber: startIndex + index + 1,
        kind: 'added',
        before: '',
        after: draft[index]
      })
    }
    for (let index = pairedCount; index < original.length; index += 1) {
      changes.push({
        lineNumber: startIndex + pairedCount + 1,
        kind: 'removed',
        before: original[index],
        after: ''
      })
    }
    return changes
  }

  const table = Array.from({ length: original.length + 1 }, () => new Uint32Array(draft.length + 1))
  for (let left = original.length - 1; left >= 0; left -= 1) {
    for (let right = draft.length - 1; right >= 0; right -= 1) {
      table[left][right] = original[left] === draft[right]
        ? table[left + 1][right + 1] + 1
        : Math.max(table[left + 1][right], table[left][right + 1])
    }
  }

  let left = 0
  let right = 0
  while (left < original.length || right < draft.length) {
    if (left < original.length && right < draft.length && original[left] === draft[right]) {
      left += 1
      right += 1
    } else if (left < original.length && (right >= draft.length || table[left + 1][right] >= table[left][right + 1])) {
      changes.push({
        lineNumber: startIndex + right + 1,
        kind: 'removed',
        before: original[left],
        after: ''
      })
      left += 1
    } else if (right < draft.length) {
      changes.push({
        lineNumber: startIndex + right + 1,
        kind: 'added',
        before: '',
        after: draft[right]
      })
      right += 1
    }
  }

  return changes
}

function compactLiveLineChanges(changes: LiveLineChange[]): LiveLineChange[] {
  const compacted: LiveLineChange[] = []

  for (let index = 0; index < changes.length; index += 1) {
    const change = changes[index]
    const next = changes[index + 1]

    if (change.kind === 'removed' && next?.kind === 'added' && change.lineNumber === next.lineNumber) {
      compacted.push({
        lineNumber: next.lineNumber,
        kind: 'modified',
        before: change.before,
        after: next.after
      })
      index += 1
      continue
    }

    compacted.push(change)
  }

  return compacted
}

function editableTextLines(text: string): EditableTextLines {
  const hasTrailingNewline = /\r?\n$/.test(text)
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  if (hasTrailingNewline && lines[lines.length - 1] === '') lines.pop()

  return { lines, hasTrailingNewline }
}

function joinEditableTextLines({ lines, hasTrailingNewline }: EditableTextLines): string {
  return `${lines.join('\n')}${hasTrailingNewline ? '\n' : ''}`
}

function nearestLineIndex(lines: string[], targetIndex: number, expectedLine: string): number {
  if (lines.length === 0) return -1
  const safeTarget = clamp(targetIndex, 0, lines.length - 1)
  if (lines[safeTarget] === expectedLine) return safeTarget

  for (let distance = 1; distance < lines.length; distance += 1) {
    const before = safeTarget - distance
    const after = safeTarget + distance
    if (before >= 0 && lines[before] === expectedLine) return before
    if (after < lines.length && lines[after] === expectedLine) return after
  }

  return -1
}

function updateLineInText(text: string, lineNumber: number, nextLine: string | null): string {
  const editable = editableTextLines(text)
  const lines = editable.lines
  const index = lineNumber - 1

  if (index < 0 || index > lines.length) return text

  if (nextLine === null) {
    lines.splice(index, 1)
  } else if (index === lines.length) {
    lines.push(nextLine)
  } else {
    lines[index] = nextLine
  }

  return joinEditableTextLines(editable)
}

function revertLiveChangeInText(text: string, change: LiveLineChange): string {
  const editable = editableTextLines(text)
  const lines = editable.lines
  const targetIndex = Math.max(0, change.lineNumber - 1)

  if (change.kind === 'added') {
    const index = nearestLineIndex(lines, targetIndex, change.after)
    if (index === -1) return text
    lines.splice(index, 1)
    return joinEditableTextLines(editable)
  }

  if (change.kind === 'modified') {
    const index = nearestLineIndex(lines, targetIndex, change.after)
    if (index === -1) return updateLineInText(text, change.lineNumber, change.before)
    lines[index] = change.before
    return joinEditableTextLines(editable)
  }

  const insertIndex = Math.max(0, Math.min(targetIndex, lines.length))
  if (lines[insertIndex] === change.before || lines[insertIndex - 1] === change.before) return text
  lines.splice(insertIndex, 0, change.before)
  return joinEditableTextLines(editable)
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
  const fileSearchInputRef = useRef<HTMLInputElement | null>(null)
  const highlightInnerRef = useRef<HTMLDivElement | null>(null)
  const lineNumbersInnerRef = useRef<HTMLDivElement | null>(null)
  const colorSwatchesInnerRef = useRef<HTMLDivElement | null>(null)
  const hexTableBodyRef = useRef<HTMLDivElement | null>(null)
  const selectedFileRowRef = useRef<HTMLButtonElement | null>(null)
  const skipJsonEditBlurRef = useRef(false)
  const chunkPageRequestRef = useRef(false)
  const hexChunkRequestRef = useRef(0)
  const fileContentSearchRequestRef = useRef(0)
  const pendingEditorFocusRef = useRef<{ filePath: string; lineNumber: number; column: number; length: number; byteOffset?: number } | null>(null)
  const lastEditorScrollTopRef = useRef(0)
  const lastHexScrollTopRef = useRef(0)
  const suppressAutoChunkUntilRef = useRef(0)
  const suppressAutoHexChunkUntilRef = useRef(0)
  const editorUndoStackRef = useRef<EditorTextHistoryEntry[]>([])
  const editorRedoStackRef = useRef<EditorTextHistoryEntry[]>([])
  const pendingEditorHistoryRef = useRef<EditorTextHistoryEntry | null>(null)
  const pendingHexOffsetRef = useRef<number | null>(null)
  const [sidebarWidth, setSidebarWidth] = useState(readStoredEditorSidebarWidth)
  const [files, setFiles] = useState<RepositoryFileEntry[]>([])
  const [filesLoading, setFilesLoading] = useState(false)
  const [fileQuery, setFileQuery] = useState('')
  const [fileContentMatches, setFileContentMatches] = useState<Record<string, RepositoryContentSearchMatch>>({})
  const [fileContentSearchState, setFileContentSearchState] = useState<RepositoryContentSearchState>({
    status: 'idle',
    scanned: 0,
    truncated: false,
    error: null
  })
  const [fileSearchQuery, setFileSearchQuery] = useState('')
  const [activeSearchIndex, setActiveSearchIndex] = useState(-1)
  const [multiEditRanges, setMultiEditRanges] = useState<EditorTextRange[]>([])
  const [fileMenu, setFileMenu] = useState<EditorFileMenu | null>(null)
  const [viewMode, setViewMode] = useState<EditorViewMode>(() => defaultViewModeForPath(initialFilePath ?? ''))
  const [selectedPath, setSelectedPath] = useState(initialFilePath ?? '')
  const [originalText, setOriginalText] = useState('')
  const [draftText, setDraftText] = useState('')
  const [chunkedTextPreview, setChunkedTextPreview] = useState<ChunkedTextPreview | null>(null)
  const [imagePreview, setImagePreview] = useState<ImagePreview | null>(null)
  const [imagePreviewLoading, setImagePreviewLoading] = useState(false)
  const [imagePreviewError, setImagePreviewError] = useState<string | null>(null)
  const [hexBytes, setHexBytes] = useState<HexBytePreview | null>(null)
  const [hexLoading, setHexLoading] = useState(false)
  const [hexError, setHexError] = useState<string | null>(null)
  const [hexOriginalText, setHexOriginalText] = useState('')
  const [hexDraftText, setHexDraftText] = useState('')
  const [activeHexByteIndex, setActiveHexByteIndex] = useState(0)
  const [hexByteDraft, setHexByteDraft] = useState('')
  const [hexOffsetDraft, setHexOffsetDraft] = useState('')
  const [hexSearchQuery, setHexSearchQuery] = useState('')
  const [activeHexSearchIndex, setActiveHexSearchIndex] = useState(-1)
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
  const [gitLineChanges, setGitLineChanges] = useState<LiveLineChange[]>([])
  const [gitDiffLoading, setGitDiffLoading] = useState(false)
  const [lintRunState, setLintRunState] = useState<EditorLintRunState>({
    status: 'idle',
    message: 'Lint has not run yet.',
    detail: 'Open a supported file and run lint.'
  })
  const changeByPath = useMemo(() => new Map((snapshot?.status.changes ?? []).map((change) => [change.path, change])), [snapshot])
  const selectedChange = selectedPath ? changeByPath.get(selectedPath) ?? null : null
  const query = fileQuery.trim().toLowerCase()
  const contentMatchedPaths = useMemo(() => new Set(Object.keys(fileContentMatches)), [fileContentMatches])
  const fileContentMatchCount = contentMatchedPaths.size
  const visibleFiles = useMemo(() => (
    query ? files.filter((file) => file.path.toLowerCase().includes(query) || contentMatchedPaths.has(file.path)) : files
  ), [contentMatchedPaths, files, query])
  const visibleFileTree = useMemo(() => buildRepositoryFileTree(visibleFiles), [visibleFiles])
  const chunkedTextActive = Boolean(chunkedTextPreview)
  const activeEditorText = chunkedTextPreview?.text ?? draftText
  const activeEditorLineBase = chunkedTextPreview?.startLine ?? 1
  const textDirty = draftText !== originalText
  const liveChanges = useMemo(() => (textDirty ? buildLiveLineChanges(originalText, draftText) : []), [textDirty, originalText, draftText])
  const editedLines = liveChanges.length
  const changeKindByLine = useMemo(() => {
    const next = new Map<number, LiveLineChange['kind']>()
    for (const change of gitLineChanges) {
      if (change.kind !== 'removed') next.set(change.lineNumber, change.kind)
    }
    for (const change of liveChanges) {
      if (change.kind !== 'removed') next.set(change.lineNumber, change.kind)
    }
    return next
  }, [gitLineChanges, liveChanges])
  const gitChangedLines = gitLineChanges.length
  const draftLines = useMemo(() => textLines(activeEditorText), [activeEditorText])
  const lineOffsets = useMemo(() => buildLineOffsets(draftLines), [draftLines])
  const multiEditLineNumbers = useMemo(() => {
    const lines = new Set<number>()
    if (multiEditRanges.length === 0) return lines

    for (let index = 0; index < draftLines.length; index += 1) {
      const lineStart = lineOffsets[index] ?? 0
      const lineEnd = lineStart + draftLines[index].length
      if (multiEditRanges.some((range) => (
        range.start === range.end
          ? range.start >= lineStart && range.start <= lineEnd
          : rangesOverlap(range, { start: lineStart, end: Math.max(lineStart + 1, lineEnd) })
      ))) {
        lines.add(activeEditorLineBase + index)
      }
    }

    return lines
  }, [activeEditorLineBase, draftLines, lineOffsets, multiEditRanges])
  const fileLineSearchTarget = useMemo(() => parseFileLineSearchQuery(fileSearchQuery), [fileSearchQuery])
  const effectiveFileSearchQuery = fileLineSearchTarget ? '' : fileSearchQuery
  const fileSearchMatches = useMemo(() => (
    fileLineSearchTarget ? [] : findFileSearchMatches(draftLines, fileSearchQuery).map((match) => ({
      ...match,
      lineNumber: activeEditorLineBase + match.lineNumber - 1
    }))
  ), [activeEditorLineBase, draftLines, fileLineSearchTarget, fileSearchQuery])
  const parsedHexDraft = useMemo(() => parseHexText(hexDraftText), [hexDraftText])
  const parsedHexOriginal = useMemo(() => parseHexText(hexOriginalText), [hexOriginalText])
  const hexStartOffset = hexBytes?.startOffset ?? 0
  const hexEndOffset = hexBytes?.endOffset ?? hexStartOffset
  const hexFullFileLoaded = Boolean(hexBytes?.fullFileLoaded)
  const hexPreviewRows = useMemo(
    () => (parsedHexDraft.bytes ? hexEditorRows(parsedHexDraft.bytes, hexStartOffset) : []),
    [hexStartOffset, parsedHexDraft.bytes]
  )
  const activeHexLocalIndex = activeHexByteIndex - hexStartOffset
  const activeHexByte = activeHexLocalIndex >= 0 ? parsedHexDraft.bytes?.[activeHexLocalIndex] ?? null : null
  const activeHexAscii = activeHexByte === null ? '' : asciiFromByte(activeHexByte)
  const activeHexRowOffset = Math.floor(activeHexByteIndex / HEX_BYTES_PER_ROW) * HEX_BYTES_PER_ROW
  const hexSearchMatches = useMemo(
    () => findHexSearchMatches(parsedHexDraft.bytes, hexSearchQuery, hexStartOffset),
    [hexSearchQuery, hexStartOffset, parsedHexDraft.bytes]
  )
  const normalizedActiveHexByteDraft = normalizeHexByteDraft(hexByteDraft)
  const activeHexByteDraftValue = normalizedActiveHexByteDraft
    ? Number.parseInt(normalizedActiveHexByteDraft.padStart(2, '0'), 16)
    : null
  const activeHexByteDraftDirty = hexFullFileLoaded && activeHexByte !== null && activeHexByteDraftValue !== null && activeHexByteDraftValue !== activeHexByte
  const hexDirty = hexFullFileLoaded && (hexDraftText !== hexOriginalText || activeHexByteDraftDirty)
  const dirty = textDirty || hexDirty
  const diagnosticByLine = useMemo(() => new Map(diagnostics.map((diagnostic) => [diagnostic.lineNumber, diagnostic])), [diagnostics])
  const fileSearchOverflow = fileSearchMatches.length >= EDITOR_SEARCH_MATCH_LIMIT
  const activeSearchMatch = activeSearchIndex >= 0 ? fileSearchMatches[activeSearchIndex] ?? null : null
  const editorOverviewMarkers = useMemo<EditorOverviewMarker[]>(() => {
    const firstLine = activeEditorLineBase
    const lastLine = activeEditorLineBase + Math.max(0, draftLines.length - 1)
    const markers: EditorOverviewMarker[] = []
    const seen = new Set<string>()
    const addMarker = (marker: EditorOverviewMarker) => {
      if (marker.lineNumber < firstLine || marker.lineNumber > lastLine) return
      const key = `${marker.kind}:${marker.lineNumber}`
      if (seen.has(key)) return
      seen.add(key)
      markers.push(marker)
    }

    for (const change of gitLineChanges) {
      addMarker({ lineNumber: change.lineNumber, kind: change.kind, title: `Git ${change.kind} line ${change.lineNumber}` })
    }
    for (const change of liveChanges) {
      addMarker({ lineNumber: change.lineNumber, kind: change.kind, title: `Unsaved ${change.kind} line ${change.lineNumber}` })
    }
    for (const diagnostic of diagnostics) {
      addMarker({ lineNumber: diagnostic.lineNumber, kind: 'diagnostic', title: `${diagnostic.source}: ${diagnostic.message}` })
    }
    for (const match of fileSearchMatches) {
      addMarker({ lineNumber: match.lineNumber, kind: 'search', title: `Search match on line ${match.lineNumber}` })
    }

    return markers.sort((a, b) => a.lineNumber - b.lineNumber).slice(0, 1200)
  }, [activeEditorLineBase, diagnostics, draftLines.length, fileSearchMatches, gitLineChanges, liveChanges])
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
  const svgPreviewUrl = selectedIsSvg && !chunkedTextActive && draftText ? safeSvgDataUrl(draftText) : ''
  const activeImagePreviewUrl = selectedIsSvg ? (svgPreviewUrl || imagePreview?.dataUrl || '') : imagePreview?.dataUrl ?? ''
  const svgAnalysis = useMemo(() => (selectedIsSvg && !chunkedTextActive ? analyzeSvgText(draftText) : null), [chunkedTextActive, draftText, selectedIsSvg])
  const jsonParseResult = useMemo(() => {
    if (chunkedTextActive || !selectedIsJson || !draftText.trim()) {
      return { rows: [] as JsonTreeNode[], expandablePaths: [] as string[], error: null as string | null }
    }
    try {
      const parsed = parseEditorJsonText(selectedPath, draftText, lintSettings)
      const lineNumbers = buildJsonLineNumberMap(parsed.preparedText)
      return {
        rows: flattenJsonTree(parsed.value, collapsedJsonPaths, lineNumbers),
        expandablePaths: collectJsonExpandablePaths(parsed.value),
        error: null
      }
    } catch (error) {
      return {
        rows: [] as JsonTreeNode[],
        expandablePaths: [] as string[],
        error: error instanceof Error ? error.message : 'Invalid JSON.'
      }
    }
  }, [chunkedTextActive, collapsedJsonPaths, draftText, lintSettings, selectedIsJson, selectedPath])
  const selectedIcon = fileTypeIconForPath(selectedPath)
  const selectedLang = langFromPath(selectedPath)
  const selectedLintSupported = !chunkedTextActive && (selectedIsJson || SCRIPT_RE.test(selectedPath))
  const selectedHexOnly = Boolean(textUnavailableMessage)
  const lintBlocked = !selectedPath || fileLoading || Boolean(fileError) || selectedHexOnly || chunkedTextActive || viewMode === 'image' || viewMode === 'hex'
  const selectedLintRulesEnabled = selectedLintSupported && lintRulesEnabledForFile(selectedPath, lintSettings)
  const textSaveBlocked = false
  const contextMenuChange = fileMenu ? changeByPath.get(fileMenu.path) : null
  const availableViewModes = useMemo<Array<{ id: EditorViewMode; label: string }>>(() => {
    const modes: Array<{ id: EditorViewMode; label: string }> = []
    if (selectedIsImage) modes.push({ id: 'image', label: 'Preview' })
    if (selectedIsSvg && !selectedIsBinaryPreview && !chunkedTextActive) modes.push({ id: 'svg-editor', label: 'Edit' })
    if (!selectedIsBinaryPreview || selectedIsSvg) modes.push({ id: 'code', label: selectedIsSvg ? 'SVG' : 'Code' })
    if (selectedIsJson && !selectedIsBinaryPreview && !chunkedTextActive) modes.push({ id: 'json', label: 'JSON' })
    if (selectedPath) modes.push({ id: 'hex', label: 'Hex' })
    return modes.length ? modes : [{ id: 'code', label: 'Code' }]
  }, [chunkedTextActive, selectedIsBinaryPreview, selectedIsImage, selectedIsJson, selectedIsSvg, selectedPath])
  const editorStyle = {
    '--changes-editor-sidebar-width': `${sidebarWidth}px`
  } as CSSProperties
  const lintBadgeLabel = diagnostics.length > 0
    ? String(diagnostics.length)
    : lintRunState.status === 'clean'
      ? 'OK'
      : lintRunState.status === 'blocked'
        ? '!'
        : lintRunState.status === 'running'
          ? '...'
          : ''
  const lintMenuClassName = [
    'changes-editor-lint-menu',
    diagnostics.length > 0 ? 'has-issues' : '',
    lintRunState.status === 'clean' ? 'is-clean' : '',
    lintRunState.status === 'blocked' ? 'is-blocked' : '',
    lintRunState.status === 'running' ? 'is-running' : '',
    (!selectedLintSupported || lintBlocked) ? 'disabled' : ''
  ].filter(Boolean).join(' ')
  const gitStatusText = selectedChange
    ? `${selectedChange.status} in git${gitChangedLines > 0 ? ` - ${gitChangedLines} marked line${gitChangedLines === 1 ? '' : 's'}` : ''}`
    : null
  const editorStatusText = hexDirty
    ? `${parsedHexDraft.bytes?.length ?? 0} edited byte${parsedHexDraft.bytes?.length === 1 ? '' : 's'} since load`
    : viewMode === 'hex' && hexBytes && !hexFullFileLoaded
      ? `Read-only hex chunk ${formatBytes(hexBytes.startOffset)}-${formatBytes(hexBytes.endOffset)} of ${formatBytes(hexBytes.byteSize)}`
      : chunkedTextPreview
        ? `Editable chunk ${formatBytes(chunkedTextPreview.startOffset)}-${formatBytes(chunkedTextPreview.endOffset)} of ${formatBytes(chunkedTextPreview.byteSize)}`
        : textUnavailableMessage
          ? textUnavailableMessage
          : textDirty
            ? `${editedLines} edited line${editedLines === 1 ? '' : 's'} since load${gitStatusText ? ` - ${gitStatusText}` : ''}`
            : gitDiffLoading
              ? 'Loading git changes...'
              : gitStatusText ?? 'No edits since load'

  const openFileContextMenu = (event: ReactMouseEvent, path: string) => {
    if (!path) return
    event.preventDefault()
    event.stopPropagation()
    setFileMenu({ x: event.clientX, y: event.clientY, path })
  }

  const openRepositoryFileRow = (file: RepositoryFileEntry, contentMatch?: RepositoryContentSearchMatch) => {
    if (contentMatch) {
      pendingEditorFocusRef.current = {
        filePath: file.path,
        lineNumber: contentMatch.lineNumber,
        column: contentMatch.column,
        length: contentMatch.length,
        byteOffset: contentMatch.byteOffset
      }
      setFileSearchQuery(fileQuery.trim())
      setViewMode('code')
    }

    setSelectedPath(file.path)
    if (contentMatch && selectedPath === file.path && !fileLoading) {
      pendingEditorFocusRef.current = null
      focusCodePosition(contentMatch.lineNumber, contentMatch.column, contentMatch.length)
    }
  }

  const renderFileRow = (file: RepositoryFileEntry, displayName: string) => {
    const change = changeByPath.get(file.path)
    const fileTypeIcon = fileTypeIconForPath(file.path)
    const selected = selectedPath === file.path
    const contentMatch = fileContentMatches[file.path]
    const fileIsDirty = selected && dirty
    const statusClassName = fileIsDirty ? 'status-edited' : change ? `status-${change.status}` : ''
    const statusLabel = fileIsDirty ? 'E' : change ? fileStatusToken(change.status) : ''
    const statusTitle = fileIsDirty ? 'Edited since load' : change ? change.status : ''

    return (
      <button
        type="button"
        ref={selected ? selectedFileRowRef : undefined}
        className={[
          'changes-editor-file-row',
          selected ? 'selected' : '',
          fileIsDirty ? 'edited' : '',
          change ? 'changed' : 'clean'
        ].filter(Boolean).join(' ')}
        key={file.path}
        onClick={() => openRepositoryFileRow(file, contentMatch)}
        onContextMenu={(event) => openFileContextMenu(event, file.path)}
        title={contentMatch ? `${file.path}\nContent match at ${contentMatch.lineNumber}:${contentMatch.column + 1}` : file.path}
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
        {contentMatch && (
          <small className="changes-editor-file-content-match">
            L{contentMatch.lineNumber}: {contentMatch.preview}
          </small>
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

  const editorTextSnapshot = (textarea = textareaRef.current): EditorTextHistoryEntry => {
    const text = textarea?.value ?? draftText
    const selectionStart = Math.min(text.length, textarea?.selectionStart ?? text.length)
    const selectionEnd = Math.min(text.length, textarea?.selectionEnd ?? selectionStart)
    return { text, selectionStart, selectionEnd }
  }

  const pushEditorHistoryEntry = (stack: EditorTextHistoryEntry[], entry: EditorTextHistoryEntry) => {
    const last = stack[stack.length - 1]
    if (
      last &&
      last.text === entry.text &&
      last.selectionStart === entry.selectionStart &&
      last.selectionEnd === entry.selectionEnd
    ) {
      return
    }

    stack.push(entry)
    if (stack.length > EDITOR_TEXT_HISTORY_LIMIT) stack.shift()
  }

  const pushEditorUndoEntry = (entry: EditorTextHistoryEntry) => {
    pushEditorHistoryEntry(editorUndoStackRef.current, entry)
    editorRedoStackRef.current = []
  }

  const clearEditorTextHistory = () => {
    editorUndoStackRef.current = []
    editorRedoStackRef.current = []
    pendingEditorHistoryRef.current = null
  }

  const applyEditorTextChange = (
    nextText: string,
    options: {
      selectionStart?: number
      selectionEnd?: number
      viewMode?: EditorViewMode
      resetJsonCollapse?: boolean
    } = {}
  ) => {
    const snapshot = editorTextSnapshot()
    if (snapshot.text === nextText) return false

    pushEditorUndoEntry(snapshot)
    pendingEditorHistoryRef.current = null
    setDraftText(nextText)
    setJsonEdit(null)
    setMultiEditRanges([])
    if (options.resetJsonCollapse) setCollapsedJsonPaths(new Set())
    if (options.viewMode) setViewMode(options.viewMode)

    const selectionStart = clamp(options.selectionStart ?? snapshot.selectionStart, 0, nextText.length)
    const selectionEnd = clamp(options.selectionEnd ?? selectionStart, 0, nextText.length)
    window.requestAnimationFrame(() => {
      const textarea = textareaRef.current
      if (!textarea) return
      textarea.focus()
      textarea.setSelectionRange(selectionStart, selectionEnd)
      updateEditorLineWindowState(textarea.scrollTop, textarea.clientHeight)
      syncEditorOverlays(textarea.scrollLeft, textarea.scrollTop, textarea.clientHeight)
    })
    return true
  }

  const restoreEditorTextSnapshot = (entry: EditorTextHistoryEntry) => {
    setDraftText(entry.text)
    setJsonEdit(null)
    setMultiEditRanges([])
    window.requestAnimationFrame(() => {
      const textarea = textareaRef.current
      if (!textarea) return
      const selectionStart = Math.min(entry.selectionStart, textarea.value.length)
      const selectionEnd = Math.min(entry.selectionEnd, textarea.value.length)
      textarea.focus()
      textarea.setSelectionRange(selectionStart, selectionEnd)
      updateEditorLineWindowState(textarea.scrollTop, textarea.clientHeight)
      syncEditorOverlays(textarea.scrollLeft, textarea.scrollTop, textarea.clientHeight)
    })
  }

  const undoEditorText = () => {
    const previous = editorUndoStackRef.current.pop()
    if (!previous) return

    pushEditorHistoryEntry(editorRedoStackRef.current, editorTextSnapshot())
    restoreEditorTextSnapshot(previous)
  }

  const redoEditorText = () => {
    const next = editorRedoStackRef.current.pop()
    if (!next) return

    pushEditorHistoryEntry(editorUndoStackRef.current, editorTextSnapshot())
    restoreEditorTextSnapshot(next)
  }

  const capturePendingEditorHistory = () => {
    if (fileLoading) return
    pendingEditorHistoryRef.current = editorTextSnapshot()
  }

  const setEditorSelection = (start: number, end = start) => {
    window.requestAnimationFrame(() => {
      const textarea = textareaRef.current
      if (!textarea) return
      textarea.focus()
      textarea.setSelectionRange(clamp(start, 0, textarea.value.length), clamp(end, 0, textarea.value.length))
    })
  }

  const activateNextMultiEditOccurrence = () => {
    const textarea = textareaRef.current
    if (!textarea || viewMode !== 'code' || textUnavailableMessage || fileLoading) return

    const text = textarea.value
    const primaryRange = multiEditRanges[0] ?? selectedTextRange(text, textarea.selectionStart, textarea.selectionEnd)
    if (!primaryRange) {
      setNotice('Select text or place the caret on a word before pressing Ctrl+D.')
      return
    }

    const queryText = text.slice(primaryRange.start, primaryRange.end)
    if (!queryText) return

    const ranges = normalizeTextRanges(multiEditRanges.length ? multiEditRanges : [primaryRange])
    const lastRange = ranges[ranges.length - 1]
    let nextIndex = text.indexOf(queryText, lastRange.end)
    if (nextIndex === -1) nextIndex = text.indexOf(queryText)

    while (nextIndex !== -1) {
      const nextRange = { start: nextIndex, end: nextIndex + queryText.length }
      if (!ranges.some((range) => rangesOverlap(range, nextRange) || (range.start === nextRange.start && range.end === nextRange.end))) {
        const nextRanges = normalizeTextRanges([...ranges, nextRange])
        setMultiEditRanges(nextRanges)
        setEditorSelection(nextRange.start, nextRange.end)
        setNotice(`${nextRanges.length} selections in this chunk.`)
        return
      }
      nextIndex = text.indexOf(queryText, nextIndex + Math.max(1, queryText.length))
    }

    setNotice(`No more "${queryText}" matches in this chunk.`)
  }

  const applyTextToMultiEditRanges = (replacement: string, mode: 'replace' | 'backspace' | 'delete' = 'replace') => {
    const textarea = textareaRef.current
    const sourceText = textarea?.value ?? draftText
    const sourceRanges = normalizeTextRanges(multiEditRanges)
    if (sourceRanges.length === 0) return false

    const editableRanges = sourceRanges.map((range) => {
      if (mode === 'backspace' && range.start === range.end) {
        return { start: Math.max(0, range.start - 1), end: range.end }
      }
      if (mode === 'delete' && range.start === range.end) {
        return { start: range.start, end: Math.min(sourceText.length, range.end + 1) }
      }
      return range
    })

    if (editableRanges.every((range) => range.start === range.end) && replacement === '') return true

    let cursor = 0
    let nextText = ''
    const nextRanges: EditorTextRange[] = []
    for (const range of editableRanges) {
      nextText += sourceText.slice(cursor, range.start)
      const nextStart = nextText.length
      nextText += replacement
      const nextEnd = nextStart + replacement.length
      nextRanges.push({ start: nextEnd, end: nextEnd })
      cursor = range.end
    }
    nextText += sourceText.slice(cursor)

    pushEditorUndoEntry(editorTextSnapshot(textarea))
    pendingEditorHistoryRef.current = null
    setDraftText(nextText)
    setJsonEdit(null)
    setMultiEditRanges(nextRanges)
    setEditorSelection(nextRanges[nextRanges.length - 1].start)
    return true
  }

  const handleEditorTextChange = (event: ReactChangeEvent<HTMLTextAreaElement>) => {
    if (multiEditRanges.length > 0) {
      setMultiEditRanges([])
    }

    const nextText = event.currentTarget.value
    const previous = pendingEditorHistoryRef.current ?? {
      text: draftText,
      selectionStart: Math.min(draftText.length, event.currentTarget.selectionStart),
      selectionEnd: Math.min(draftText.length, event.currentTarget.selectionEnd)
    }
    pendingEditorHistoryRef.current = null

    if (previous.text !== nextText) {
      pushEditorUndoEntry(previous)
    }
    setDraftText(nextText)
  }

  const handleEditorTextKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    const key = event.key.toLowerCase()
    if ((event.ctrlKey || event.metaKey) && !event.altKey && key === 'd') {
      event.preventDefault()
      activateNextMultiEditOccurrence()
      return
    }

    if (multiEditRanges.length > 0 && !(event.ctrlKey || event.metaKey) && !event.altKey) {
      if (event.key.length === 1) {
        event.preventDefault()
        applyTextToMultiEditRanges(event.key)
        return
      }
      if (event.key === 'Enter') {
        event.preventDefault()
        applyTextToMultiEditRanges('\n')
        return
      }
      if (event.key === 'Tab') {
        event.preventDefault()
        applyTextToMultiEditRanges('\t')
        return
      }
      if (event.key === 'Backspace') {
        event.preventDefault()
        applyTextToMultiEditRanges('', 'backspace')
        return
      }
      if (event.key === 'Delete') {
        event.preventDefault()
        applyTextToMultiEditRanges('', 'delete')
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        setMultiEditRanges([])
        return
      }
    }

    if (!(event.ctrlKey || event.metaKey) || event.altKey) {
      if (
        event.key.length === 1 ||
        event.key === 'Enter' ||
        event.key === 'Backspace' ||
        event.key === 'Delete' ||
        event.key === 'Tab'
      ) {
        capturePendingEditorHistory()
      }
      return
    }

    const undo = key === 'z' && !event.shiftKey
    const redo = key === 'y' || (key === 'z' && event.shiftKey)
    if (!undo && !redo) return
    if (undo && editorUndoStackRef.current.length === 0) return
    if (redo && editorRedoStackRef.current.length === 0) return

    event.preventDefault()
    pendingEditorHistoryRef.current = null
    if (undo) undoEditorText()
    else redoEditorText()
  }

  const handleEditorPaste = (event: ReactClipboardEvent<HTMLTextAreaElement>) => {
    if (multiEditRanges.length === 0) return
    event.preventDefault()
    applyTextToMultiEditRanges(event.clipboardData.getData('text/plain'))
  }

  const focusSearchMatch = (match: FileSearchMatch) => {
    focusEditorPosition(match.lineNumber, match.column, match.length)
  }

  const focusCodePosition = (lineNumber: number, column = 0, length = 0) => {
    setViewMode('code')
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => focusEditorPosition(lineNumber, column, length))
    })
  }

  const focusFileLineSearchTarget = () => {
    if (!fileLineSearchTarget) return false
    const firstLineNumber = activeEditorLineBase
    const lastLineNumber = activeEditorLineBase + Math.max(0, draftLines.length - 1)
    if (chunkedTextActive && (fileLineSearchTarget.lineNumber < firstLineNumber || fileLineSearchTarget.lineNumber > lastLineNumber)) {
      setNotice(`Line ${fileLineSearchTarget.lineNumber} is outside the loaded chunk (${firstLineNumber}-${lastLineNumber}).`)
      return true
    }

    focusCodePosition(fileLineSearchTarget.lineNumber, fileLineSearchTarget.column, 1)
    return true
  }

  const goToDiagnostic = (diagnostic: EditorDiagnostic) => {
    focusCodePosition(diagnostic.lineNumber, diagnostic.column - 1, 1)
  }

  const updateLintSettings = (patch: Partial<EditorLintSettings>) => {
    setLintSettings((current) => {
      const next = { ...current, ...patch }
      persistLintSettings(next)
      return next
    })
    setLintRunState({
      status: 'idle',
      message: 'Lint settings changed.',
      detail: 'Run lint again to refresh the result.'
    })
  }

  const runLint = (focusFirst = true) => {
    if (lintBlocked) {
      const message = selectedPath ? 'Lint is unavailable for the current editor mode.' : 'Select a file before running lint.'
      setLintRunState({ status: 'blocked', message, detail: selectedPath || 'No file selected' })
      setNotice(message)
      return
    }
    if (!selectedLintSupported) {
      const message = 'Lint supports JSON, JSONC, JS, TS, JSX, and TSX files.'
      setLintRunState({ status: 'blocked', message, detail: selectedPath || 'Unsupported file' })
      setNotice(message)
      return
    }
    if (!selectedLintRulesEnabled) {
      const message = 'No active lint rules for this file type.'
      setLintRunState({ status: 'blocked', message, detail: 'Enable a matching lint rule below.' })
      setNotice(message)
      return
    }

    const lintFilePath = selectedPath
    const lintText = draftText
    const lintSettingsSnapshot = lintSettings
    setLintRunState({ status: 'running', message: 'Running lint...', detail: lintFilePath })
    window.requestAnimationFrame(() => {
      const nextDiagnostics = validateEditorText(lintFilePath, lintText, lintSettingsSnapshot)
      setDiagnostics(nextDiagnostics)
      setLintRunState(lintStateFromDiagnostics(nextDiagnostics, lintFilePath, 'Manual'))
      setNotice(nextDiagnostics.length > 0
        ? `Lint found ${nextDiagnostics.length} issue${nextDiagnostics.length === 1 ? '' : 's'}.`
        : 'Lint passed. No issues found.')
      if (focusFirst && nextDiagnostics[0]) {
        goToDiagnostic(nextDiagnostics[0])
      }
    })
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
    if (focusFileLineSearchTarget()) return
    activateSearchMatch(activeSearchIndex < 0 ? (event.shiftKey ? -1 : 0) : activeSearchIndex + (event.shiftKey ? -1 : 1))
  }

  const focusFileSearchInput = () => {
    if (!selectedPath || fileLoading || fileError || textUnavailableMessage) return false
    if (viewMode === 'hex' || viewMode === 'image') setViewMode('code')

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const input = fileSearchInputRef.current
        if (!input || input.disabled) return
        input.focus()
        input.select()
      })
    })
    return true
  }

  const updateEditorCssColor = (request: CssColorEditDraft) => {
    const snapshot = editorTextSnapshot()
    const current = snapshot.text
    const lines = current.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
    const lineIndex = request.lineNumber - 1
    const line = lines[lineIndex]
    if (line === undefined) return

    const directMatch = line.slice(request.columnStart, request.columnStart + request.oldValue.length) === request.oldValue
    const columnStart = directMatch ? request.columnStart : line.indexOf(request.oldValue)
    if (columnStart < 0) return

    const nextLine = `${line.slice(0, columnStart)}${request.newValue}${line.slice(columnStart + request.oldValue.length)}`
    const nextText = updateLineInText(current, request.lineNumber, nextLine)
    applyEditorTextChange(nextText)
  }

  const loadChunkedTextPage = async (direction: 'next' | 'previous', scrollPlacement: 'start' | 'end' = 'start') => {
    const current = chunkedTextPreview
    if (!api || !currentRepoPath || !selectedPath || !current || current.loading || chunkPageRequestRef.current) return

    const markers = [...current.markers]
    let targetIndex = direction === 'previous' ? current.pageIndex - 1 : current.pageIndex + 1

    if (direction === 'previous' && targetIndex < 0) return
    if (direction === 'next' && targetIndex >= markers.length) {
      if (!current.hasMore) return
      markers.push({
        offset: current.endOffset,
        lineNumber: current.startLine + lineBreakCount(current.text)
      })
      targetIndex = markers.length - 1
    }

    const marker = markers[targetIndex]
    if (!marker) {
      return
    }

    chunkPageRequestRef.current = true
    setChunkedTextPreview({ ...current, loading: true, error: null })
    setFileLoading(true)
    try {
      const result = await api.getRepositoryFileChunk({
        repoPath: currentRepoPath,
        filePath: selectedPath,
        offset: marker.offset,
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
        startLine: marker.lineNumber,
        markers,
        pageIndex: targetIndex
      }))
      setOriginalText(result.data.text)
      setDraftText(result.data.text)
      suppressAutoChunkUntilRef.current = window.performance.now() + 250
      window.requestAnimationFrame(() => {
        const textarea = textareaRef.current
        if (!textarea) return
        const nextScrollTop = scrollPlacement === 'end'
          ? Math.max(0, textarea.scrollHeight - textarea.clientHeight - EDITOR_LINE_HEIGHT * 2)
          : 0
        textarea.scrollTop = nextScrollTop
        textarea.scrollLeft = 0
        lastEditorScrollTopRef.current = nextScrollTop
        setEditorScrollTop(nextScrollTop)
        syncEditorOverlays(0, nextScrollTop, textarea.clientHeight)
      })
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
      <div className={[dirty ? 'changes-editor-code-shell is-dirty' : 'changes-editor-code-shell', chunkedTextActive ? 'is-chunked' : ''].filter(Boolean).join(' ')}>
        {chunkedTextPreview && (
          <div className="changes-editor-chunk-banner">
            <strong>Chunk editor</strong>
            <span>
              {formatBytes(chunkedTextPreview.startOffset)}-{formatBytes(chunkedTextPreview.endOffset)} of {formatBytes(chunkedTextPreview.byteSize)}
            </span>
            {chunkedTextPreview.error && <em>{chunkedTextPreview.error}</em>}
            <button type="button" onClick={() => void loadChunkedTextPage('previous')} disabled={chunkedTextPreview.loading || chunkedTextPreview.pageIndex === 0}>
              Previous chunk
            </button>
            <button
              type="button"
              onClick={() => void loadChunkedTextPage('next')}
              disabled={chunkedTextPreview.loading || (!chunkedTextPreview.hasMore && chunkedTextPreview.pageIndex >= chunkedTextPreview.markers.length - 1)}
            >
              {chunkedTextPreview.loading ? 'Loading...' : 'Next chunk'}
            </button>
          </div>
        )}
        <pre className="changes-editor-line-numbers" aria-hidden="true">
          <div className="changes-editor-line-numbers-inner" ref={lineNumbersInnerRef}>
            {visibleDraftLines.map((_, index) => {
              const lineNumber = activeEditorLineBase + editorLineWindow.start + index
              const diagnostic = diagnosticByLine.get(lineNumber)
              const changeKind = changeKindByLine.get(lineNumber)

              return (
                <span
                  className={[
                    diagnostic ? 'line-diagnostic-error' : '',
                    changeKind ? `line-${changeKind}` : '',
                    multiEditLineNumbers.has(lineNumber) ? 'line-multi-edit' : ''
                  ].filter(Boolean).join(' ') || undefined}
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
                    diagnostic ? 'line-diagnostic-error' : '',
                    multiEditLineNumbers.has(lineNumber) ? 'line-multi-edit' : ''
                  ].filter(Boolean).join(' ')}
                  key={`${lineNumber}-${line.slice(0, 20)}`}
                  title={diagnostic ? `${diagnostic.source}: ${diagnostic.message}` : undefined}
                >
                  {highlightedLineContent(line || ' ', selectedLang, effectiveFileSearchQuery, activeSearchMatch, lineNumber)}
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
          onBeforeInput={capturePendingEditorHistory}
          onChange={handleEditorTextChange}
          onKeyDown={handleEditorTextKeyDown}
          onPaste={handleEditorPaste}
          onScroll={syncHighlightScroll}
          readOnly={false}
          disabled={fileLoading}
        />
        {editorOverviewMarkers.length > 0 && (
          <div className="changes-editor-overview" aria-label="File overview markers">
            {editorOverviewMarkers.map((marker, index) => {
              const denominator = Math.max(1, draftLines.length - 1)
              const top = clamp(((marker.lineNumber - activeEditorLineBase) / denominator) * 100, 0, 100)

              return (
                <button
                  type="button"
                  className={`changes-editor-overview-marker marker-${marker.kind}`}
                  style={{ top: `${top}%` } as CSSProperties}
                  key={`${marker.kind}-${marker.lineNumber}-${index}`}
                  title={marker.title}
                  aria-label={marker.title}
                  onClick={() => focusEditorPosition(marker.lineNumber)}
                />
              )
            })}
          </div>
        )}
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
                onClick={() => goToDiagnostic(diagnostic)}
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

  const scrollHexTable = (placement: 'start' | 'end') => {
    window.requestAnimationFrame(() => {
      const body = hexTableBodyRef.current
      if (!body) return
      const nextScrollTop = placement === 'end'
        ? Math.max(0, body.scrollHeight - body.clientHeight)
        : 0
      body.scrollTop = nextScrollTop
      lastHexScrollTopRef.current = nextScrollTop
    })
  }

  const codeViewHexOffset = () => {
    if (chunkedTextPreview) {
      return chunkedTextPreview.startOffset
    }

    const selectionStart = textareaRef.current?.selectionStart
    if (selectionStart !== undefined && draftText) {
      return utf8ByteOffset(draftText, selectionStart)
    }

    return 0
  }

  const loadHexChunk = async (
    requestedOffset: number,
    selectOffset = requestedOffset,
    options: { scrollPlacement?: 'start' | 'end' } = {}
  ) => {
    if (!api || !currentRepoPath || !selectedPath) return

    const knownMaxOffset = hexBytes ? Math.max(0, hexBytes.byteSize - 1) : Number.POSITIVE_INFINITY
    const safeOffset = Number.isFinite(requestedOffset)
      ? alignHexOffset(clamp(Math.floor(requestedOffset), 0, knownMaxOffset))
      : 0
    const requestId = hexChunkRequestRef.current + 1
    hexChunkRequestRef.current = requestId
    setHexLoading(true)
    setHexError(null)

    try {
      const result = await api.getRepositoryFileChunk({
        repoPath: currentRepoPath,
        filePath: selectedPath,
        offset: safeOffset,
        maxBytes: HEX_CHUNK_BYTES,
        mode: 'bytes'
      })
      if (hexChunkRequestRef.current !== requestId) return
      setHexLoading(false)
      if (!result.ok) {
        setHexBytes(null)
        setHexOriginalText('')
        setHexDraftText('')
        setHexError(friendlyIpcErrorMessage(result.error.message, 'Failed to load hex bytes.'))
        return
      }

      const bytes = bytesFromBase64(result.data.base64 ?? '')
      const hexText = bytesToHexText(bytes)
      const nextStart = result.data.startOffset
      const nextEnd = result.data.endOffset
      const fullFileLoaded = nextStart === 0 && nextEnd >= result.data.byteSize
      const selectedOffset = bytes.length > 0
        ? clamp(selectOffset, nextStart, Math.max(nextStart, nextEnd - 1))
        : nextStart

      setHexBytes({
        filePath: result.data.filePath,
        byteSize: result.data.byteSize,
        startOffset: nextStart,
        endOffset: nextEnd,
        hasMore: result.data.hasMore,
        fullFileLoaded
      })
      setHexOriginalText(hexText)
      setHexDraftText(hexText)
      setActiveHexByteIndex(selectedOffset)
      setHexByteDraft(bytes.length > 0 ? byteToHex(bytes[selectedOffset - nextStart]) : '')
      setHexOffsetDraft(bytes.length > 0 ? offsetToHex(selectedOffset) : '')
      setActiveHexSearchIndex(-1)
      suppressAutoHexChunkUntilRef.current = window.performance.now() + 250
      if (options.scrollPlacement) scrollHexTable(options.scrollPlacement)
    } catch (error) {
      if (hexChunkRequestRef.current !== requestId) return
      setHexLoading(false)
      setHexBytes(null)
      setHexOriginalText('')
      setHexDraftText('')
      setHexError(friendlyIpcErrorMessage(error instanceof Error ? error.message : '', 'Failed to load hex bytes.'))
    }
  }

  const goToHexOffset = () => {
    const offset = parseHexOffsetDraft(hexOffsetDraft)
    if (offset === null) {
      setNotice('Offset must be decimal, hex, or 0x-prefixed hex.')
      return
    }

    const safeOffset = hexBytes ? clamp(offset, 0, Math.max(0, hexBytes.byteSize - 1)) : offset
    if (safeOffset >= hexStartOffset && safeOffset < hexEndOffset) {
      selectHexByte(safeOffset)
      return
    }

    void loadHexChunk(safeOffset, safeOffset, { scrollPlacement: 'start' })
  }

  const jumpHexChunk = (direction: 'previous' | 'next') => {
    if (!hexBytes) return
    const offset = direction === 'previous'
      ? Math.max(0, hexBytes.startOffset - HEX_CHUNK_BYTES)
      : hexBytes.endOffset
    const selectOffset = direction === 'previous'
      ? Math.max(0, hexBytes.startOffset - 1)
      : offset
    void loadHexChunk(offset, selectOffset, { scrollPlacement: direction === 'previous' ? 'end' : 'start' })
  }

  function selectHexByte(index: number) {
    const bytes = parsedHexDraft.bytes
    if (!bytes || bytes.length === 0) return

    const nextIndex = clamp(index, hexStartOffset, Math.max(hexStartOffset, hexEndOffset - 1))
    setActiveHexByteIndex(nextIndex)
    setHexByteDraft(byteToHex(bytes[nextIndex - hexStartOffset]))
    setHexOffsetDraft(offsetToHex(nextIndex))
  }

  const updateHexByteAt = (index: number, value: number) => {
    const bytes = parsedHexDraft.bytes
    if (!hexFullFileLoaded || !bytes) return
    const localIndex = index - hexStartOffset
    if (localIndex < 0 || localIndex >= bytes.length) return

    const nextBytes = new Uint8Array(bytes)
    nextBytes[localIndex] = value
    setHexDraftText(bytesToHexText(nextBytes))
  }

  const commitHexByteDraft = (index: number, rawDraft: string): boolean => {
    const normalized = normalizeHexByteDraft(rawDraft)
    const currentByte = parsedHexDraft.bytes?.[index - hexStartOffset]
    if (!hexFullFileLoaded || !normalized) {
      if (currentByte !== undefined) setHexByteDraft(byteToHex(currentByte))
      return false
    }

    const value = Number.parseInt(normalized.padStart(2, '0'), 16)
    updateHexByteAt(index, value)
    setHexByteDraft(byteToHex(value))
    return true
  }

  const updateHexByteDraft = (index: number, rawDraft: string) => {
    const normalized = normalizeHexByteDraft(rawDraft)
    setHexByteDraft(normalized)

    if (!hexFullFileLoaded || normalized.length !== 2) return

    const value = Number.parseInt(normalized, 16)
    updateHexByteAt(index, value)
    const bytes = parsedHexDraft.bytes
    if (!bytes) return

    if (hexFullFileLoaded && index < hexEndOffset - 1) {
      setActiveHexByteIndex(index + 1)
    } else {
      setHexByteDraft(byteToHex(value))
    }
  }

  const moveHexSelection = (event: ReactKeyboardEvent<HTMLInputElement>, fromIndex: number, toIndex: number) => {
    event.preventDefault()
    commitHexByteDraft(fromIndex, event.currentTarget.value)
    selectHexByte(toIndex)
  }

  const handleHexByteInputKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>, index: number) => {
    if (event.key === 'ArrowRight') {
      moveHexSelection(event, index, index + 1)
      return
    }
    if (event.key === 'ArrowLeft') {
      moveHexSelection(event, index, index - 1)
      return
    }
    if (event.key === 'ArrowDown') {
      moveHexSelection(event, index, index + HEX_BYTES_PER_ROW)
      return
    }
    if (event.key === 'ArrowUp') {
      moveHexSelection(event, index, index - HEX_BYTES_PER_ROW)
      return
    }
    if (event.key === 'Home') {
      moveHexSelection(event, index, Math.floor(index / HEX_BYTES_PER_ROW) * HEX_BYTES_PER_ROW)
      return
    }
    if (event.key === 'End') {
      moveHexSelection(event, index, Math.floor(index / HEX_BYTES_PER_ROW) * HEX_BYTES_PER_ROW + HEX_BYTES_PER_ROW - 1)
      return
    }
    if (event.key === 'PageDown') {
      moveHexSelection(event, index, index + HEX_BYTES_PER_ROW * 16)
      return
    }
    if (event.key === 'PageUp') {
      moveHexSelection(event, index, index - HEX_BYTES_PER_ROW * 16)
      return
    }
    if (event.key === 'Enter') {
      moveHexSelection(event, index, index + 1)
      return
    }
    if (event.key === 'Tab') {
      moveHexSelection(event, index, index + (event.shiftKey ? -1 : 1))
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      const byte = parsedHexDraft.bytes?.[index - hexStartOffset]
      if (byte !== undefined) {
        setHexByteDraft(byteToHex(byte))
        event.currentTarget.select()
      }
    }
  }

  const hexByteChanged = (index: number, byte: number): boolean => {
    const originalBytes = parsedHexOriginal.bytes
    if (!hexFullFileLoaded || !originalBytes) return false
    const localIndex = index - hexStartOffset
    return localIndex >= 0 && originalBytes[localIndex] !== byte
  }

  const hexDraftTextForSave = (): string => {
    if (!hexFullFileLoaded || !activeHexByteDraftDirty || activeHexByteDraftValue === null || !parsedHexDraft.bytes) return hexDraftText
    const localIndex = activeHexByteIndex - hexStartOffset
    if (localIndex < 0 || localIndex >= parsedHexDraft.bytes.length) return hexDraftText

    const nextBytes = new Uint8Array(parsedHexDraft.bytes)
    nextBytes[localIndex] = activeHexByteDraftValue
    return bytesToHexText(nextBytes)
  }

  const goToHexSearchMatch = (direction: 'previous' | 'next') => {
    if (hexSearchMatches.length === 0) return
    const nextIndex = direction === 'previous'
      ? (activeHexSearchIndex <= 0 ? hexSearchMatches.length - 1 : activeHexSearchIndex - 1)
      : (activeHexSearchIndex < 0 || activeHexSearchIndex >= hexSearchMatches.length - 1 ? 0 : activeHexSearchIndex + 1)
    setActiveHexSearchIndex(nextIndex)
    selectHexByte(hexSearchMatches[nextIndex].offset)
  }

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

    return (
      <div className="changes-editor-hex-shell">
        <div className="changes-editor-hex-meta">
          <strong>
            {hexBytes
              ? `${formatBytes(hexBytes.startOffset)}-${formatBytes(hexBytes.endOffset)} of ${formatBytes(hexBytes.byteSize)}`
              : 'Hex bytes not loaded yet'}
          </strong>
          {activeHexByte === null ? (
            <span>No byte selected</span>
          ) : (
            <span className="changes-editor-hex-selection">
              <b>Offset</b>
              <code>{offsetToHex(activeHexByteIndex)}</code>
              <b>Hex</b>
              <code>{byteToHex(activeHexByte)}</code>
              <b>Dec</b>
              <code>{activeHexByte}</code>
              <b>ASCII</b>
              <code>{activeHexAscii}</code>
            </span>
          )}
          {parsedHexDraft.bytes && (
            <em>{hexLoading ? 'loading chunk...' : hexFullFileLoaded ? `${parsedHexDraft.bytes.length} bytes in draft` : 'read-only chunk'}</em>
          )}
        </div>
        <div className="changes-editor-hex-controls">
          <button
            type="button"
            onClick={() => jumpHexChunk('previous')}
            disabled={hexLoading || !hexBytes || hexBytes.startOffset <= 0}
          >
            Previous chunk
          </button>
          <button
            type="button"
            onClick={() => jumpHexChunk('next')}
            disabled={hexLoading || !hexBytes || !hexBytes.hasMore}
          >
            Next chunk
          </button>
          <label>
            <span>Offset</span>
            <input
              value={hexOffsetDraft}
              placeholder="00000000"
              spellCheck={false}
              onChange={(event) => setHexOffsetDraft(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  goToHexOffset()
                }
              }}
            />
          </label>
          <button type="button" onClick={goToHexOffset} disabled={hexLoading || !hexBytes}>
            Go
          </button>
          <label className="changes-editor-hex-search">
            <Search size={14} />
            <input
              value={hexSearchQuery}
              placeholder="Search hex / ASCII"
              spellCheck={false}
              onChange={(event) => {
                setHexSearchQuery(event.currentTarget.value)
                setActiveHexSearchIndex(-1)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  goToHexSearchMatch(event.shiftKey ? 'previous' : 'next')
                }
              }}
            />
            <small>
              {hexSearchQuery.trim()
                ? `${activeHexSearchIndex >= 0 ? activeHexSearchIndex + 1 : 0}/${hexSearchMatches.length}${hexSearchMatches.length >= HEX_SEARCH_MATCH_LIMIT ? '+' : ''}`
                : '0/0'}
            </small>
          </label>
          <button type="button" onClick={() => goToHexSearchMatch('previous')} disabled={hexSearchMatches.length === 0}>
            Prev
          </button>
          <button type="button" onClick={() => goToHexSearchMatch('next')} disabled={hexSearchMatches.length === 0}>
            Next
          </button>
        </div>
        {parsedHexDraft.error && (
          <div className="changes-editor-hex-error">{parsedHexDraft.error}</div>
        )}
        <div className="changes-editor-hex-table">
          <header>
            <span>offset</span>
            <span>hex bytes</span>
            <span>ascii</span>
          </header>
          <div className="changes-editor-hex-table-body" ref={hexTableBodyRef} onScroll={syncHexScroll}>
            {hexPreviewRows.length === 0 ? (
              <div className="changes-editor-hex-empty">Empty file</div>
            ) : hexPreviewRows.map((row) => {
              const activeRow = row.offset === activeHexRowOffset && activeHexByteIndex < row.offset + row.bytes.length
              return (
                <div
                  className={['changes-editor-hex-row', activeRow ? 'active' : ''].filter(Boolean).join(' ')}
                  key={row.offset}
                >
                  <button
                    type="button"
                    className="changes-editor-hex-offset"
                    onClick={() => selectHexByte(row.offset)}
                    aria-label={`Select row at offset ${row.offset.toString(16).padStart(8, '0')}`}
                  >
                    {row.offset.toString(16).padStart(8, '0')}
                  </button>
                  <div className="changes-editor-hex-byte-grid" role="row">
                    {Array.from({ length: HEX_BYTES_PER_ROW }, (_, column) => {
                      const byte = row.bytes[column]
                      const byteIndex = row.offset + column
                      if (byte === undefined) {
                        return <span className="changes-editor-hex-byte-cell empty" key={column} aria-hidden="true" />
                      }

                      const active = byteIndex === activeHexByteIndex
                      const changed = hexByteChanged(byteIndex, byte)
                      const matched = hexByteInMatch(byteIndex, hexSearchMatches)
                      const className = [
                        'changes-editor-hex-byte-cell',
                        active ? 'active' : '',
                        matched ? 'search-match' : '',
                        changed ? 'changed' : ''
                      ].filter(Boolean).join(' ')

                      if (active && hexFullFileLoaded) {
                        return (
                          <input
                            className={className}
                            key={column}
                            value={hexByteDraft}
                            maxLength={2}
                            autoFocus
                            spellCheck={false}
                            aria-label={`Byte ${byteIndex.toString(16).padStart(8, '0')} hex value`}
                            onChange={(event) => updateHexByteDraft(byteIndex, event.currentTarget.value)}
                            onBlur={(event) => commitHexByteDraft(byteIndex, event.currentTarget.value)}
                            onFocus={(event) => event.currentTarget.select()}
                            onKeyDown={(event) => handleHexByteInputKeyDown(event, byteIndex)}
                          />
                        )
                      }

                      return (
                        <button
                          type="button"
                          className={className}
                          key={column}
                          onClick={() => selectHexByte(byteIndex)}
                          aria-label={`Select byte ${byteIndex.toString(16).padStart(8, '0')}`}
                        >
                          {byteToHex(byte)}
                        </button>
                      )
                    })}
                  </div>
                  <div className="changes-editor-hex-ascii-grid" aria-label={`ASCII row ${row.offset.toString(16).padStart(8, '0')}`}>
                    {Array.from({ length: HEX_BYTES_PER_ROW }, (_, column) => {
                      const byte = row.bytes[column]
                      const byteIndex = row.offset + column
                      if (byte === undefined) {
                        return <span className="changes-editor-hex-ascii-cell empty" key={column} aria-hidden="true" />
                      }

                      const active = byteIndex === activeHexByteIndex
                      const changed = hexByteChanged(byteIndex, byte)
                      const matched = hexByteInMatch(byteIndex, hexSearchMatches)
                      return (
                        <button
                          type="button"
                          className={[
                            'changes-editor-hex-ascii-cell',
                            active ? 'active' : '',
                            matched ? 'search-match' : '',
                            changed ? 'changed' : ''
                          ].filter(Boolean).join(' ')}
                          key={column}
                          onClick={() => selectHexByte(byteIndex)}
                          aria-label={`Select ASCII byte ${byteIndex.toString(16).padStart(8, '0')}`}
                        >
                          {asciiFromByte(byte)}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
          {hexBytes && !hexFullFileLoaded && (
            <p>
              Viewing {formatBytes(hexBytes.startOffset)}-{formatBytes(hexBytes.endOffset)} of {formatBytes(hexBytes.byteSize)}.
              Jump by offset or load adjacent chunks.
            </p>
          )}
        </div>
        {hexLoading && hexBytes && (
          <SignalStatus
            compact
            className="changes-editor-hex-loading"
            label="Loading hex chunk"
            detail={`${formatBytes(hexBytes.startOffset)}-${formatBytes(hexBytes.endOffset)} of ${formatBytes(hexBytes.byteSize)}`}
          />
        )}
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
    applyEditorTextChange(serializeSvgDocument(parsed.document))
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
    applyEditorTextChange(serializeSvgDocument(parsed.document))
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
      const formatted = isJsoncFilePath(selectedPath)
        ? beautifyJsoncText(draftText)
        : `${JSON.stringify(parseEditorJsonText(selectedPath, draftText, lintSettings).value, null, 2)}\n`
      applyEditorTextChange(formatted, { resetJsonCollapse: true })
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
      const rootValue = parseEditorJsonText(selectedPath, draftText, lintSettings).value
      const nextValue = parseJsonEditValue(edit.kind, edit.value)
      const nextRootValue = updateJsonValueAtPath(rootValue, edit.path, nextValue)
      applyEditorTextChange(`${JSON.stringify(nextRootValue, null, 2)}\n`)
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
            onClick={() => {
              if (mode.id === 'hex') pendingHexOffsetRef.current = codeViewHexOffset()
              setViewMode(mode.id)
            }}
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
    clearEditorTextHistory()
    setViewMode(defaultViewModeForPath(selectedPath))
    setImagePreview(null)
    setImagePreviewError(null)
    setImagePreviewLoading(false)
    setHexBytes(null)
    setHexError(null)
    setHexLoading(false)
    setHexOriginalText('')
    setHexDraftText('')
    setActiveHexByteIndex(0)
    setHexByteDraft('')
    setHexOffsetDraft('')
    setHexSearchQuery('')
    setActiveHexSearchIndex(-1)
    setChunkedTextPreview(null)
    setTextUnavailableMessage(null)
    setCollapsedJsonPaths(new Set())
    setJsonEdit(null)
    setMultiEditRanges([])
    setDiagnostics([])
    setLintRunState({
      status: 'idle',
      message: 'Lint has not run yet.',
      detail: selectedPath ? 'Waiting for file content.' : 'Select a file.'
    })
    setEditorScrollTop(0)
    setEditorViewportHeight(0)
    lastEditorScrollTopRef.current = 0
    lastHexScrollTopRef.current = 0
    suppressAutoChunkUntilRef.current = 0
    suppressAutoHexChunkUntilRef.current = 0
    if (textareaRef.current) {
      textareaRef.current.scrollTop = 0
      textareaRef.current.scrollLeft = 0
    }
    if (hexTableBodyRef.current) {
      hexTableBodyRef.current.scrollTop = 0
    }
    syncEditorOverlays(0, 0)
  }, [selectedPath])

  useEffect(() => {
    if (!selectedPath) return

    const frame = window.requestAnimationFrame(() => {
      const row = selectedFileRowRef.current
      const list = row?.closest('.changes-editor-file-list') as HTMLElement | null
      if (!row || !list) return

      const rowRect = row.getBoundingClientRect()
      const listRect = list.getBoundingClientRect()
      const rowOutsideViewport = rowRect.top < listRect.top || rowRect.bottom > listRect.bottom
      if (rowOutsideViewport) row.scrollIntoView({ block: 'center' })
    })

    return () => window.cancelAnimationFrame(frame)
  }, [selectedPath, fileQuery, visibleFiles.length])

  useEffect(() => {
    const searchText = fileQuery.trim()
    const requestId = fileContentSearchRequestRef.current + 1
    fileContentSearchRequestRef.current = requestId

    if (!api || !currentRepoPath || searchText.length < EDITOR_FILE_CONTENT_SEARCH_MIN_LENGTH || files.length === 0) {
      setFileContentMatches({})
      setFileContentSearchState({ status: 'idle', scanned: 0, truncated: false, error: null })
      return
    }

    let cancelled = false
    const handle = window.setTimeout(() => {
      const eligibleFiles = files.filter((file) => isLikelyContentSearchFile(file.path))
      const searchFiles = eligibleFiles.slice(0, EDITOR_FILE_CONTENT_SEARCH_FILE_LIMIT)
      const truncatedByFileLimit = eligibleFiles.length > searchFiles.length
      const matches: Record<string, RepositoryContentSearchMatch> = {}
      let scanned = 0

      setFileContentMatches({})
      setFileContentSearchState({ status: 'searching', scanned: 0, truncated: truncatedByFileLimit, error: null })

      const run = async () => {
        try {
          for (let index = 0; index < searchFiles.length; index += EDITOR_FILE_CONTENT_SEARCH_BATCH_SIZE) {
            if (cancelled || fileContentSearchRequestRef.current !== requestId) return

            const batch = searchFiles.slice(index, index + EDITOR_FILE_CONTENT_SEARCH_BATCH_SIZE)
            const results = await Promise.all(batch.map(async (file) => {
              try {
                const result = await api.getRepositoryFileContent({
                  repoPath: currentRepoPath,
                  filePath: file.path
                })
                if (!result.ok || result.data.binary || result.data.tooLarge || !result.data.text) return null
                return findRepositoryContentMatch(file.path, result.data.text, searchText)
              } catch {
                return null
              }
            }))

            if (cancelled || fileContentSearchRequestRef.current !== requestId) return

            scanned += batch.length
            for (const match of results) {
              if (!match) continue
              matches[match.filePath] = match
              if (Object.keys(matches).length >= EDITOR_FILE_CONTENT_SEARCH_RESULT_LIMIT) break
            }

            const truncated = truncatedByFileLimit || Object.keys(matches).length >= EDITOR_FILE_CONTENT_SEARCH_RESULT_LIMIT
            setFileContentMatches({ ...matches })
            setFileContentSearchState({ status: 'searching', scanned, truncated, error: null })

            if (Object.keys(matches).length >= EDITOR_FILE_CONTENT_SEARCH_RESULT_LIMIT) break
          }

          if (cancelled || fileContentSearchRequestRef.current !== requestId) return
          setFileContentMatches({ ...matches })
          setFileContentSearchState({
            status: 'done',
            scanned,
            truncated: truncatedByFileLimit || Object.keys(matches).length >= EDITOR_FILE_CONTENT_SEARCH_RESULT_LIMIT,
            error: null
          })
        } catch (error) {
          if (cancelled || fileContentSearchRequestRef.current !== requestId) return
          setFileContentSearchState({
            status: 'done',
            scanned,
            truncated: truncatedByFileLimit,
            error: friendlyIpcErrorMessage(error instanceof Error ? error.message : '', 'Content search failed.')
          })
        }
      }

      void run()
    }, EDITOR_FILE_CONTENT_SEARCH_DEBOUNCE_MS)

    return () => {
      cancelled = true
      window.clearTimeout(handle)
    }
  }, [api, currentRepoPath, fileQuery, files])

  useEffect(() => {
    if (!api || !currentRepoPath || !selectedPath || !selectedChange) {
      setGitLineChanges([])
      setGitDiffLoading(false)
      return
    }

    let cancelled = false
    setGitDiffLoading(true)

    const requests: Array<Promise<ApiResult<DiffResult>>> = []
    if (selectedChange.staged) {
      requests.push(api.getDiff({ repoPath: currentRepoPath, filePath: selectedPath, staged: true, contextLines: 0 }))
    }
    if (selectedChange.unstaged || selectedChange.untracked || !selectedChange.staged) {
      requests.push(api.getDiff({ repoPath: currentRepoPath, filePath: selectedPath, staged: false, contextLines: 0 }))
    }

    void Promise.all(requests)
      .then((results) => {
        if (cancelled) return
        const diffs = results.flatMap((result) => (
          result.ok && !result.data.binary && !result.data.tooLarge ? [result.data] : []
        ))
        setGitLineChanges(buildGitLineChanges(diffs, selectedPath))
        setGitDiffLoading(false)
      })
      .catch(() => {
        if (cancelled) return
        setGitLineChanges([])
        setGitDiffLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [
    api,
    currentRepoPath,
    selectedPath,
    selectedChange?.additions,
    selectedChange?.deletions,
    selectedChange?.stagedStatus,
    selectedChange?.staged,
    selectedChange?.status,
    selectedChange?.unstagedStatus,
    selectedChange?.unstaged,
    selectedChange?.untracked,
    snapshot?.summary.headOid
  ])

  useEffect(() => {
    if (lintBlocked || !selectedLintSupported) {
      setDiagnostics([])
      setLintRunState({
        status: 'idle',
        message: selectedPath ? 'Lint is unavailable here.' : 'Select a file before running lint.',
        detail: selectedPath || 'No file selected'
      })
      return
    }
    if (!selectedLintRulesEnabled) {
      setDiagnostics([])
      setLintRunState({
        status: 'blocked',
        message: 'No active lint rules for this file type.',
        detail: 'Enable a matching lint rule below.'
      })
      return
    }
    if (!lintSettings.autoValidate) {
      setDiagnostics([])
      setLintRunState({
        status: 'idle',
        message: 'Auto validate is off.',
        detail: 'Run lint now to check the current draft.'
      })
      return
    }

    const handle = window.setTimeout(() => {
      const nextDiagnostics = validateEditorText(selectedPath, draftText, lintSettings)
      setDiagnostics(nextDiagnostics)
      setLintRunState(lintStateFromDiagnostics(nextDiagnostics, selectedPath, 'Auto'))
    }, 160)

    return () => window.clearTimeout(handle)
  }, [
    draftText,
    lintBlocked,
    lintSettings,
    selectedLintRulesEnabled,
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

    const preferredOffset = pendingHexOffsetRef.current ?? codeViewHexOffset()
    pendingHexOffsetRef.current = null
    if (
      hexBytes?.filePath === selectedPath &&
      preferredOffset >= hexBytes.startOffset &&
      preferredOffset < hexBytes.endOffset
    ) {
      selectHexByte(preferredOffset)
      return
    }

    void loadHexChunk(preferredOffset, preferredOffset, { scrollPlacement: 'start' })
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
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return

      const key = event.key.toLowerCase()
      if (key === 'f') {
        if (focusFileSearchInput()) {
          event.preventDefault()
          event.stopPropagation()
        }
        return
      }

      if (key === 'd' && event.target === textareaRef.current && !event.defaultPrevented) {
        event.preventDefault()
        activateNextMultiEditOccurrence()
        return
      }

      if (event.defaultPrevented || event.target === textareaRef.current || isNativeEditableTarget(event.target)) return

      const undo = key === 'z' && !event.shiftKey
      const redo = key === 'y' || (key === 'z' && event.shiftKey)
      if (!undo && !redo) return
      if (undo && editorUndoStackRef.current.length === 0) return
      if (redo && editorRedoStackRef.current.length === 0) return

      event.preventDefault()
      pendingEditorHistoryRef.current = null
      if (undo) undoEditorText()
      else redoEditorText()
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [fileError, fileLoading, selectedPath, textUnavailableMessage, viewMode])

  useEffect(() => {
    if (activeHexSearchIndex >= hexSearchMatches.length && hexSearchMatches.length > 0) {
      setActiveHexSearchIndex(Math.max(0, hexSearchMatches.length - 1))
    }
  }, [activeHexSearchIndex, hexSearchMatches.length])

  useEffect(() => {
    const bytes = parsedHexDraft.bytes
    if (!bytes || bytes.length === 0) {
      if (activeHexByteIndex !== hexStartOffset) setActiveHexByteIndex(hexStartOffset)
      setHexByteDraft((current) => current ? '' : current)
      return
    }

    const nextIndex = clamp(activeHexByteIndex, hexStartOffset, Math.max(hexStartOffset, hexEndOffset - 1))
    if (nextIndex !== activeHexByteIndex) {
      setActiveHexByteIndex(nextIndex)
      return
    }

    const nextDraft = byteToHex(bytes[nextIndex - hexStartOffset])
    setHexByteDraft((current) => current === nextDraft ? current : nextDraft)
  }, [activeHexByteIndex, hexEndOffset, hexStartOffset, parsedHexDraft.bytes])

  useEffect(() => {
    if (fileLoading || fileError) return

    const frame = window.requestAnimationFrame(() => {
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
            markers: [{ offset: result.data.startOffset, lineNumber: 1 }],
            pageIndex: 0
          })
          setChunkedTextPreview(preview)
          setOriginalText(result.data.text)
          setDraftText(result.data.text)
          setViewMode('code')
          lastEditorScrollTopRef.current = 0
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

  useEffect(() => {
    const target = pendingEditorFocusRef.current
    if (!target || target.filePath !== selectedPath || fileLoading) return
    if (fileError || textUnavailableMessage) {
      pendingEditorFocusRef.current = null
      return
    }

    const firstLineNumber = activeEditorLineBase
    const lastLineNumber = activeEditorLineBase + Math.max(0, draftLines.length - 1)
    const lineIsLoaded = target.lineNumber >= firstLineNumber && target.lineNumber <= lastLineNumber

    if (lineIsLoaded || !chunkedTextPreview || target.byteOffset === undefined || !api || !currentRepoPath) {
      pendingEditorFocusRef.current = null
      focusCodePosition(target.lineNumber, target.column, target.length)
      return
    }

    pendingEditorFocusRef.current = null
    let cancelled = false
    setFileLoading(true)
    setChunkedTextPreview({ ...chunkedTextPreview, loading: true, error: null })
    void api.getRepositoryFileChunk({
      repoPath: currentRepoPath,
      filePath: selectedPath,
      offset: target.byteOffset,
      maxBytes: EDITOR_FILE_CHUNK_BYTES
    })
      .then((result) => {
        if (cancelled) return
        setFileLoading(false)
        if (!result.ok) {
          const message = friendlyIpcErrorMessage(result.error.message, 'Failed to load search result chunk.')
          setChunkedTextPreview((current) => current ? { ...current, loading: false, error: message } : current)
          setNotice(message)
          return
        }
        if (result.data.binary) {
          setNotice('Search result is in a binary chunk.')
          return
        }

        const markers = result.data.startOffset > 0
          ? [
              { offset: 0, lineNumber: 1 },
              { offset: result.data.startOffset, lineNumber: target.lineNumber }
            ]
          : [{ offset: result.data.startOffset, lineNumber: target.lineNumber }]
        setChunkedTextPreview(chunkedTextPreviewFromResult(result.data, {
          startLine: target.lineNumber,
          markers,
          pageIndex: markers.length - 1
        }))
        setOriginalText(result.data.text)
        setDraftText(result.data.text)
        focusCodePosition(target.lineNumber, target.column, target.length)
      })
      .catch((error) => {
        if (cancelled) return
        setFileLoading(false)
        const message = friendlyIpcErrorMessage(error instanceof Error ? error.message : '', 'Failed to load search result chunk.')
        setChunkedTextPreview((current) => current ? { ...current, loading: false, error: message } : current)
        setNotice(message)
      })

    return () => {
      cancelled = true
    }
  }, [
    activeEditorLineBase,
    api,
    chunkedTextPreview,
    currentRepoPath,
    draftLines.length,
    fileError,
    fileLoading,
    selectedPath,
    setNotice,
    textUnavailableMessage
  ])

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
      if (hexDirty) {
        if (!hexFullFileLoaded) {
          setNotice('Chunked hex preview is read-only. Load a small file fully before saving byte edits.')
          return
        }
        const parsed = parseHexText(hexDraftTextForSave())
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
          setActiveHexByteIndex((current) => clamp(current, hexStartOffset, Math.max(hexStartOffset, hexStartOffset + bytes.length - 1)))
          setHexBytes((current) => current ? {
            ...current,
            byteSize: bytes.length,
            startOffset: 0,
            endOffset: bytes.length,
            hasMore: false,
            fullFileLoaded: true
          } : current)
        }
        return
      }

      if (chunkedTextPreview) {
        const currentChunk = chunkedTextPreview
        const replacementBytes = utf8ByteOffset(draftText, draftText.length)
        const originalBytes = Math.max(0, currentChunk.endOffset - currentChunk.startOffset)
        const nextByteSize = Math.max(0, currentChunk.byteSize + replacementBytes - originalBytes)
        const result = await runSnapshotAction('File chunk saved.', () => api.writeRepositoryFileChunk({
          repoPath: currentRepoPath,
          filePath: selectedPath,
          startOffset: currentChunk.startOffset,
          endOffset: currentChunk.endOffset,
          text: draftText
        }))
        if (result !== false) {
          setOriginalText(draftText)
          setChunkedTextPreview({
            ...currentChunk,
            text: draftText,
            byteSize: nextByteSize,
            endOffset: currentChunk.startOffset + replacementBytes,
            hasMore: currentChunk.startOffset + replacementBytes < nextByteSize,
            markers: currentChunk.markers.slice(0, currentChunk.pageIndex + 1)
          })
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
    applyEditorTextChange(nextText, { viewMode: 'code', resetJsonCollapse: true })
  }

  const beautifyFile = () => {
    if (!selectedPath || chunkedTextActive || fileLoading || fileError || textUnavailableMessage || viewMode === 'image') return
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
    if (!api || !currentRepoPath || !selectedPath || chunkedTextActive || fileLoading || fileError || textUnavailableMessage || viewMode === 'image') return
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
    const snapshot = editorTextSnapshot()
    const nextText = revertLiveChangeInText(snapshot.text, change)
    if (nextText === snapshot.text) return

    applyEditorTextChange(nextText)
  }

  const syncHighlightScroll = (event: ReactUIEvent<HTMLTextAreaElement>) => {
    const nextScrollTop = event.currentTarget.scrollTop
    const scrollingDown = nextScrollTop > lastEditorScrollTopRef.current
    const scrollingUp = nextScrollTop < lastEditorScrollTopRef.current
    lastEditorScrollTopRef.current = nextScrollTop

    updateEditorLineWindowState(nextScrollTop, event.currentTarget.clientHeight)
    syncEditorOverlays(event.currentTarget.scrollLeft, nextScrollTop, event.currentTarget.clientHeight)
    const remainingScroll = event.currentTarget.scrollHeight - nextScrollTop - event.currentTarget.clientHeight
    const canAutoLoadChunk = Boolean(
      chunkedTextPreview &&
      !chunkedTextPreview.loading &&
      window.performance.now() >= suppressAutoChunkUntilRef.current
    )

    if (canAutoLoadChunk && scrollingDown && chunkedTextPreview?.hasMore && remainingScroll < 64) {
      void loadChunkedTextPage('next')
      return
    }

    if (canAutoLoadChunk && scrollingUp && chunkedTextPreview && chunkedTextPreview.pageIndex > 0 && nextScrollTop < 64) {
      void loadChunkedTextPage('previous', 'end')
    }
  }

  const syncHexScroll = (event: ReactUIEvent<HTMLDivElement>) => {
    const nextScrollTop = event.currentTarget.scrollTop
    const scrollingDown = nextScrollTop > lastHexScrollTopRef.current
    const scrollingUp = nextScrollTop < lastHexScrollTopRef.current
    lastHexScrollTopRef.current = nextScrollTop

    if (!hexBytes || hexLoading || window.performance.now() < suppressAutoHexChunkUntilRef.current) return

    const remainingScroll = event.currentTarget.scrollHeight - nextScrollTop - event.currentTarget.clientHeight
    if (scrollingDown && hexBytes.hasMore && remainingScroll < 72) {
      void loadHexChunk(hexBytes.endOffset, hexBytes.endOffset, { scrollPlacement: 'start' })
      return
    }

    if (scrollingUp && hexBytes.startOffset > 0 && nextScrollTop < 72) {
      const previousOffset = Math.max(0, hexBytes.startOffset - HEX_CHUNK_BYTES)
      const selectOffset = Math.max(0, hexBytes.startOffset - 1)
      void loadHexChunk(previousOffset, selectOffset, { scrollPlacement: 'end' })
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
          <input value={fileQuery} onChange={(event) => setFileQuery(event.target.value)} placeholder="Search files and content" />
        </label>
        {query && (
          <div className="changes-editor-content-search-status">
            {fileContentSearchState.error ? (
              <span className="danger-text">{fileContentSearchState.error}</span>
            ) : fileContentSearchState.status === 'searching' ? (
              <span>Searching content... {fileContentSearchState.scanned}/{Math.min(files.length, EDITOR_FILE_CONTENT_SEARCH_FILE_LIMIT)}</span>
            ) : fileContentMatchCount > 0 ? (
              <span>{fileContentMatchCount} content match{fileContentMatchCount === 1 ? '' : 'es'}{fileContentSearchState.truncated ? ' (limited)' : ''}</span>
            ) : (
              <span>Path + content search</span>
            )}
          </div>
        )}
        <div className="changes-editor-file-list">
          {filesLoading ? (
            <div className="quiet-box">Loading files.</div>
          ) : filesError ? (
            <div className="quiet-box danger-text">{filesError}</div>
          ) : visibleFiles.length === 0 ? (
            <div className="quiet-box">{fileContentSearchState.status === 'searching' ? 'Searching file contents.' : 'No files match this search.'}</div>
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
              {editorStatusText}
            </p>
            {renderViewModeTabs()}
          </div>
          <div className="changes-editor-header-actions">
            <label className="changes-editor-file-search">
              <Search size={15} />
              <input
                ref={fileSearchInputRef}
                value={fileSearchQuery}
                onChange={(event) => setFileSearchQuery(event.target.value)}
                onKeyDown={handleFileSearchKeyDown}
                placeholder="Search in file / :line"
                title="Search text, or jump to a line with 120, :120, #120, or :120:5"
                disabled={!selectedPath || fileLoading || Boolean(fileError) || Boolean(textUnavailableMessage) || viewMode === 'image' || viewMode === 'hex'}
              />
              {fileSearchQuery && (
                <button type="button" title="Clear file search" aria-label="Clear file search" onClick={() => setFileSearchQuery('')}>
                  <X size={14} />
                </button>
              )}
              <span className="changes-editor-search-count">
                {fileLineSearchTarget
                  ? `line ${fileLineSearchTarget.lineNumber}${fileLineSearchTarget.column > 0 ? `:${fileLineSearchTarget.column + 1}` : ''}`
                  : fileSearchQuery.trim()
                  ? `${activeSearchIndex >= 0 ? activeSearchIndex + 1 : 0}/${fileSearchMatches.length}${fileSearchOverflow ? '+' : ''}`
                  : '0/0'}
              </span>
              <button type="button" title={fileLineSearchTarget ? 'Go to line' : 'Previous match'} aria-label={fileLineSearchTarget ? 'Go to line' : 'Previous match'} disabled={!fileLineSearchTarget && fileSearchMatches.length === 0} onClick={() => (fileLineSearchTarget ? focusFileLineSearchTarget() : activateSearchMatch(activeSearchIndex < 0 ? -1 : activeSearchIndex - 1))}>
                <ChevronUp size={14} />
              </button>
              <button type="button" title={fileLineSearchTarget ? 'Go to line' : 'Next match'} aria-label={fileLineSearchTarget ? 'Go to line' : 'Next match'} disabled={!fileLineSearchTarget && fileSearchMatches.length === 0} onClick={() => (fileLineSearchTarget ? focusFileLineSearchTarget() : activateSearchMatch(activeSearchIndex < 0 ? 0 : activeSearchIndex + 1))}>
                <ChevronDown size={14} />
              </button>
            </label>
            <details className={lintMenuClassName}>
              <summary
                title={selectedLintSupported ? 'Lint current file' : 'Lint supports JSON, JSONC, JS, TS, JSX, and TSX files'}
                onClick={(event) => {
                  if (!selectedLintSupported || lintBlocked) event.preventDefault()
                }}
              >
                <Code2 size={15} />
                Lint
                {lintBadgeLabel && <span>{lintBadgeLabel}</span>}
              </summary>
              <div className="changes-editor-lint-popover">
                <button
                  type="button"
                  onClick={(event) => {
                    event.preventDefault()
                    runLint(true)
                  }}
                  disabled={!selectedLintSupported || lintBlocked || lintRunState.status === 'running'}
                >
                  {lintRunState.status === 'running' ? 'Running lint...' : 'Run lint now'}
                </button>
                <div className={`changes-editor-lint-status ${lintRunState.status}`} aria-live="polite">
                  <strong>{lintRunState.message}</strong>
                  <span>{lintRunState.detail}</span>
                </div>
                {diagnostics.length > 0 && (
                  <div className="changes-editor-lint-issues">
                    {diagnostics.slice(0, 6).map((diagnostic, index) => (
                      <button
                        type="button"
                        key={`${diagnostic.lineNumber}-${diagnostic.column}-${index}`}
                        onClick={(event) => {
                          event.preventDefault()
                          goToDiagnostic(diagnostic)
                        }}
                      >
                        <code>{diagnostic.lineNumber}:{diagnostic.column}</code>
                        <span>{diagnostic.message}</span>
                      </button>
                    ))}
                    {diagnostics.length > 6 && <small>{diagnostics.length - 6} more issues below.</small>}
                  </div>
                )}
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
              disabled={!selectedPath || chunkedTextActive || beautifying || aiBeautifying || fileLoading || Boolean(fileError) || Boolean(textUnavailableMessage) || viewMode === 'image'}
              title={chunkedTextActive ? 'Beautify is disabled for file chunks' : 'Beautify locally'}
            >
              <Sparkles size={15} />
              {beautifying ? 'Beautifying...' : 'Beautify'}
            </button>
            <button
              type="button"
              className="changes-editor-tool-button ai"
              onClick={beautifyFileWithAi}
              disabled={!api || !currentRepoPath || !selectedPath || chunkedTextActive || beautifying || aiBeautifying || fileLoading || Boolean(fileError) || Boolean(textUnavailableMessage) || viewMode === 'image'}
              title={chunkedTextActive ? 'AI Beautify is disabled for file chunks' : 'Beautify with assistant'}
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
                  {liveChanges.slice(0, 120).map((change, index) => (
                    <article className={`changes-editor-live-row ${change.kind}`} key={`${index}-${change.lineNumber}-${change.kind}`}>
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
