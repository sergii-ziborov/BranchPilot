import type { FileChange, RepositoryFileEntry } from '../../../shared/branchPilot'
import { clamp, formatBytes } from './editorPrimitives'
import type { ChunkedTextPreview, EditorDiagnostic } from './editorTypes'
import type { HexBytePreview } from './hexUtils'

const EDITOR_HEALTH_STORAGE_KEY = 'branchpilot:changes-editor-health-enabled'
const HEALTH_LANGUAGE_FILE_RE = /\.(m?[jt]sx?|cts|mts|css|scss|sass|less|html?|jsonc?|ya?ml|md|py|go|rs|java|cs|c|cc|cpp|h|hpp|php|rb|swift|kt|kts|vue|svelte)$/i

export type EditorHealthSeverity = 'healthy' | 'warning' | 'critical'
export type EditorHealthRun = 'live' | 'opened' | 'manual'

export interface EditorHealthIssue {
  severity: EditorHealthSeverity
  run: EditorHealthRun
  category: 'batch' | 'churn' | 'diagnostics' | 'dirty' | 'git' | 'load' | 'preview'
  title: string
  detail: string
}

export interface EditorHealthReport {
  severity: EditorHealthSeverity
  issues: EditorHealthIssue[]
}

export interface EditorHealthScanState {
  status: 'idle' | 'running' | 'done'
  scanned: number
  linted: number
  signals: number
  error: string | null
}

export interface EditorHealthSettings {
  enabled: boolean
  rowSignals: boolean
  mainConflicts: boolean
  mainChurn: boolean
  fileChunkedRanges: boolean
  fileDiagnostics: boolean
  fileDirtyDraft: boolean
  fileLoadLimits: boolean
  fileDenseChunk: boolean
  churnWarning: number
  churnCritical: number
  denseChunkWarning: number
}

export type EditorHealthBooleanSetting = {
  [Key in keyof EditorHealthSettings]: EditorHealthSettings[Key] extends boolean ? Key : never
}[keyof EditorHealthSettings]

export const DEFAULT_EDITOR_HEALTH_SETTINGS: EditorHealthSettings = {
  enabled: true,
  rowSignals: true,
  mainConflicts: true,
  mainChurn: true,
  fileChunkedRanges: true,
  fileDiagnostics: true,
  fileDirtyDraft: true,
  fileLoadLimits: true,
  fileDenseChunk: true,
  churnWarning: 30,
  churnCritical: 80,
  denseChunkWarning: 1200
}

export function readStoredEditorHealthSettings(): EditorHealthSettings {
  try {
    const rawValue = window.localStorage.getItem(EDITOR_HEALTH_STORAGE_KEY)
    if (!rawValue) return DEFAULT_EDITOR_HEALTH_SETTINGS
    if (rawValue === 'false') return { ...DEFAULT_EDITOR_HEALTH_SETTINGS, enabled: false }
    if (rawValue === 'true') return DEFAULT_EDITOR_HEALTH_SETTINGS

    const stored = JSON.parse(rawValue) as Partial<EditorHealthSettings>
    const legacyDefaultChurn = stored.churnWarning === 250 && stored.churnCritical === 900
    return {
      ...DEFAULT_EDITOR_HEALTH_SETTINGS,
      ...stored,
      churnWarning: clamp(Number(legacyDefaultChurn ? DEFAULT_EDITOR_HEALTH_SETTINGS.churnWarning : stored.churnWarning ?? DEFAULT_EDITOR_HEALTH_SETTINGS.churnWarning), 20, 10_000),
      churnCritical: clamp(Number(legacyDefaultChurn ? DEFAULT_EDITOR_HEALTH_SETTINGS.churnCritical : stored.churnCritical ?? DEFAULT_EDITOR_HEALTH_SETTINGS.churnCritical), 40, 20_000),
      denseChunkWarning: clamp(Number(stored.denseChunkWarning ?? DEFAULT_EDITOR_HEALTH_SETTINGS.denseChunkWarning), 100, 20_000)
    }
  } catch {
    return DEFAULT_EDITOR_HEALTH_SETTINGS
  }
}

export function storeEditorHealthSettings(settings: EditorHealthSettings): void {
  try {
    window.localStorage.setItem(EDITOR_HEALTH_STORAGE_KEY, JSON.stringify(settings))
  } catch {
    /* ignore unavailable storage */
  }
}

export function healthSeverityRank(severity: EditorHealthSeverity): number {
  if (severity === 'critical') return 2
  if (severity === 'warning') return 1
  return 0
}

export function healthSeverityFromIssues(issues: EditorHealthIssue[]): EditorHealthSeverity {
  if (issues.some((issue) => issue.severity === 'critical')) return 'critical'
  if (issues.some((issue) => issue.severity === 'warning')) return 'warning'
  return 'healthy'
}

export function healthRunLabel(run: EditorHealthRun): string {
  if (run === 'manual') return 'All files'
  return run === 'live' ? 'Live' : 'On open'
}

export function buildEditorHealthReport(
  filePath: string,
  change: FileChange | null | undefined,
  options: {
    scope?: 'main' | 'file'
    settings?: EditorHealthSettings
    chunkedTextPreview?: ChunkedTextPreview | null
    diagnostics?: EditorDiagnostic[]
    dirty?: boolean
    draftLineCount?: number
    fileError?: string | null
    gitChangedLines?: number
    hexBytes?: HexBytePreview | null
    textUnavailableMessage?: string | null
  } = {}
): EditorHealthReport {
  const settings = options.settings ?? DEFAULT_EDITOR_HEALTH_SETTINGS
  const scope = options.scope ?? 'main'
  const issues: EditorHealthIssue[] = []
  const churn = (change?.additions ?? 0) + (change?.deletions ?? 0)

  if (settings.mainConflicts && change?.conflicted) {
    issues.push({
      severity: 'critical',
      run: 'live',
      category: 'git',
      title: 'Conflicted file',
      detail: 'Git reports this file as conflicted. Resolve it before trusting edits or generated review output.'
    })
  }

  if (settings.mainChurn && churn >= settings.churnCritical) {
    issues.push({
      severity: 'critical',
      run: 'live',
      category: 'churn',
      title: 'Very large change set',
      detail: `${churn} changed lines in git. Review, search, and rollback actions need extra care.`
    })
  } else if (settings.mainChurn && churn >= settings.churnWarning) {
    issues.push({
      severity: 'warning',
      run: 'live',
      category: 'churn',
      title: 'Large change set',
      detail: `${churn} changed lines in git. Prefer focused checks before saving or staging.`
    })
  }

  if (scope !== 'file') {
    return {
      severity: healthSeverityFromIssues(issues),
      issues
    }
  }

  if (settings.fileLoadLimits && options.fileError) {
    issues.push({
      severity: 'critical',
      run: 'opened',
      category: 'load',
      title: 'Load failed',
      detail: options.fileError
    })
  }

  if (settings.fileLoadLimits && options.textUnavailableMessage) {
    issues.push({
      severity: 'warning',
      run: 'opened',
      category: 'preview',
      title: 'Limited editor mode',
      detail: options.textUnavailableMessage
    })
  }

  const chunk = options.chunkedTextPreview
  if (settings.fileChunkedRanges && chunk) {
    const languageFile = HEALTH_LANGUAGE_FILE_RE.test(filePath)
    issues.push({
      severity: languageFile ? 'critical' : 'warning',
      run: 'opened',
      category: 'batch',
      title: languageFile ? 'Language file is chunked' : 'File is chunked',
      detail: `Only ${formatBytes(chunk.startOffset)}-${formatBytes(chunk.endOffset)} of ${formatBytes(chunk.byteSize)} is loaded. Lint, search, live changes, and health are scoped to the current chunk.`
    })
  }

  if (settings.fileChunkedRanges && options.hexBytes && !options.hexBytes.fullFileLoaded) {
    issues.push({
      severity: 'warning',
      run: 'opened',
      category: 'batch',
      title: 'Hex chunk loaded',
      detail: `Hex view is editing ${formatBytes(options.hexBytes.startOffset)}-${formatBytes(options.hexBytes.endOffset)} of ${formatBytes(options.hexBytes.byteSize)}. Save writes only the current byte range.`
    })
  }

  if (settings.fileDiagnostics && (options.diagnostics?.length ?? 0) > 0) {
    issues.push({
      severity: 'critical',
      run: 'opened',
      category: 'diagnostics',
      title: 'Lint issues',
      detail: `${options.diagnostics?.length ?? 0} lint issue(s) in the active file. Click a lint issue to jump to its line.`
    })
  }

  if (settings.mainChurn && (options.gitChangedLines ?? 0) >= Math.max(80, Math.floor(settings.churnWarning / 3))) {
    issues.push({
      severity: 'warning',
      run: 'opened',
      category: 'git',
      title: 'Many marked git lines',
      detail: `${options.gitChangedLines} changed lines are marked in the editor. The overview map is the safer way to navigate this file.`
    })
  }

  if (settings.fileDenseChunk && (options.draftLineCount ?? 0) >= settings.denseChunkWarning) {
    issues.push({
      severity: 'warning',
      run: 'opened',
      category: 'batch',
      title: 'Dense editor chunk',
      detail: `${options.draftLineCount} lines are rendered in this loaded range. Cursor and minimap are using measured line height for this chunk.`
    })
  }

  if (settings.fileDirtyDraft && options.dirty) {
    issues.push({
      severity: 'warning',
      run: 'opened',
      category: 'dirty',
      title: 'Unsaved editor draft',
      detail: 'This file has unsaved edits. Switching chunks is blocked until you save or discard them.'
    })
  }

  return {
    severity: healthSeverityFromIssues(issues),
    issues
  }
}

export function buildLiveHealthReports(
  files: RepositoryFileEntry[],
  changeByPath: Map<string, FileChange>,
  settings: EditorHealthSettings
): Map<string, EditorHealthReport> {
  const reports = new Map<string, EditorHealthReport>()
  for (const file of files) {
    const change = changeByPath.get(file.path)
    reports.set(file.path, buildEditorHealthReport(file.path, change, { scope: 'main', settings }))
  }
  return reports
}

export function mergeHealthReports(left?: EditorHealthReport, right?: EditorHealthReport): EditorHealthReport {
  const issues = [...(left?.issues ?? []), ...(right?.issues ?? [])]
  return {
    severity: healthSeverityFromIssues(issues),
    issues
  }
}

export function countHealthSignalFiles(reports: Map<string, EditorHealthReport>): number {
  let count = 0
  reports.forEach((report) => {
    if (report.issues.length > 0) count += 1
  })
  return count
}
