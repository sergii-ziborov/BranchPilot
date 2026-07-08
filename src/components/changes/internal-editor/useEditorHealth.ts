import { useMemo, useState } from 'react'
import type { BranchPilotApi, FileChange, RepositoryFileEntry } from '../../../shared/branchPilot'
import { friendlyIpcErrorMessage } from '../../../lib/ipcErrorMessage'
import { formatBytes } from './editorPrimitives'
import type { ChunkedTextPreview, EditorDiagnostic } from './editorTypes'
import type { HexBytePreview } from './hexUtils'
import type { EditorViewMode } from './editorViewHelpers'
import {
  EDITOR_FILE_CHUNK_BYTES,
  EDITOR_HEALTH_LINT_CONCURRENCY
} from './editorViewConstants'
import {
  DEFAULT_EDITOR_HEALTH_SETTINGS,
  buildEditorHealthReport,
  buildLiveHealthReports,
  countHealthSignalFiles,
  healthSeverityRank,
  mergeHealthReports,
  readStoredEditorHealthSettings,
  storeEditorHealthSettings,
  type EditorHealthReport,
  type EditorHealthScanState,
  type EditorHealthSettings,
  type EditorHealthSeverity
} from './editorHealth'
import { lintRulesEnabledForFile, validateEditorText } from './editorLintHelpers'
import type { EditorLintSettings } from './lintSettings'

interface UseEditorHealthOptions {
  api: BranchPilotApi | undefined
  currentRepoPath: string | undefined
  setNotice: (message: string) => void
  files: RepositoryFileEntry[]
  filesLoading: boolean
  changeByPath: Map<string, FileChange>
  selectedPath: string
  selectedChange: FileChange | null
  viewMode: EditorViewMode
  chunkedTextPreview: ChunkedTextPreview | null
  diagnostics: EditorDiagnostic[]
  dirty: boolean
  draftLineCount: number
  fileError: string | null
  gitChangedLines: number
  hexBytes: HexBytePreview | null
  textUnavailableMessage: string | null
  lintSettings: EditorLintSettings
  reloadEditorFiles: (preferredPath?: string) => Promise<RepositoryFileEntry[]>
}

export function useEditorHealth({
  api,
  currentRepoPath,
  setNotice,
  files,
  filesLoading,
  changeByPath,
  selectedPath,
  selectedChange,
  viewMode,
  chunkedTextPreview,
  diagnostics,
  dirty,
  draftLineCount,
  fileError,
  gitChangedLines,
  hexBytes,
  textUnavailableMessage,
  lintSettings,
  reloadEditorFiles
}: UseEditorHealthOptions) {
  const [healthSettings, setHealthSettings] = useState(readStoredEditorHealthSettings)
  const [healthMenuOpen, setHealthMenuOpen] = useState(false)
  const [healthScanState, setHealthScanState] = useState<EditorHealthScanState>({
    status: 'idle',
    scanned: 0,
    linted: 0,
    signals: 0,
    error: null
  })
  const [manualHealthByPath, setManualHealthByPath] = useState<Map<string, EditorHealthReport>>(() => new Map())
  const healthEnabled = healthSettings.enabled

  const activeHealthReport = useMemo(() => buildEditorHealthReport(selectedPath, selectedChange, {
    scope: 'file',
    settings: healthSettings,
    chunkedTextPreview,
    diagnostics,
    dirty,
    draftLineCount,
    fileError,
    gitChangedLines,
    hexBytes: viewMode === 'hex' ? hexBytes : null,
    textUnavailableMessage
  }), [
    chunkedTextPreview,
    diagnostics,
    dirty,
    draftLineCount,
    fileError,
    gitChangedLines,
    hexBytes,
    healthSettings,
    selectedChange,
    selectedPath,
    textUnavailableMessage,
    viewMode
  ])
  const liveHealthByPath = useMemo(() => {
    if (!healthEnabled) return new Map<string, EditorHealthReport>()

    return buildLiveHealthReports(files, changeByPath, healthSettings)
  }, [changeByPath, files, healthEnabled, healthSettings])
  const fileHealthByPath = useMemo(() => {
    if (!healthEnabled) return new Map<string, EditorHealthReport>()

    const reports = new Map(liveHealthByPath)
    manualHealthByPath.forEach((report, path) => {
      reports.set(path, mergeHealthReports(reports.get(path), report))
    })
    if (selectedPath) {
      reports.set(selectedPath, mergeHealthReports(reports.get(selectedPath), activeHealthReport))
    }
    return reports
  }, [activeHealthReport, healthEnabled, liveHealthByPath, manualHealthByPath, selectedPath])
  const allHealthReportEntries = useMemo(() => (
    Array.from(fileHealthByPath.entries())
      .map(([path, report]) => ({ path, report }))
      .filter((entry) => entry.report.issues.length > 0)
      .sort((left, right) => healthSeverityRank(right.report.severity) - healthSeverityRank(left.report.severity))
  ), [fileHealthByPath])
  const liveHealthReportEntries = useMemo(
    () => allHealthReportEntries.filter(({ path }) => path !== selectedPath),
    [allHealthReportEntries, selectedPath]
  )
  const liveHealthReports = useMemo(() => liveHealthReportEntries.slice(0, 10), [liveHealthReportEntries])
  const selectedHealthReport = selectedPath ? fileHealthByPath.get(selectedPath) ?? activeHealthReport : activeHealthReport
  const healthIssueCount = healthEnabled ? selectedHealthReport.issues.length : 0
  const healthSignalFileCount = healthEnabled ? allHealthReportEntries.length : 0
  const healthSignalCount = healthSignalFileCount
  const healthPanelSeverity = allHealthReportEntries.reduce(
    (severity, { report }) => healthSeverityRank(report.severity) > healthSeverityRank(severity) ? report.severity : severity,
    healthEnabled ? activeHealthReport.severity : ('healthy' as EditorHealthSeverity)
  )
  const healthSummaryTitle = healthEnabled
    ? healthSignalFileCount > 0
      ? `${healthSignalFileCount} file${healthSignalFileCount === 1 ? '' : 's'} with health signals${healthIssueCount > 0 ? `; ${healthIssueCount} selected-file issue${healthIssueCount === 1 ? '' : 's'}` : ''}`
      : selectedPath
        ? 'Selected file looks healthy by lightweight checks'
        : 'Select a file to inspect health'
    : 'Module health is disabled'
  const healthRunDisabled = healthScanState.status === 'running' || filesLoading || !api || !currentRepoPath
  const healthScanSummary =
    healthScanState.status === 'running'
      ? 'Scanning repository files...'
    : healthScanState.status === 'done'
        ? `${healthScanState.scanned} files checked, ${healthScanState.linted} linted, ${healthScanState.signals} file signal${healthScanState.signals === 1 ? '' : 's'}`
        : `${files.length} files ready for live checks`

  const updateHealthSettings = (patch: Partial<EditorHealthSettings>) => {
    setHealthSettings((settings) => {
      const next = { ...settings, ...patch }
      storeEditorHealthSettings(next)
      return next
    })
  }

  const resetHealthSettings = () => {
    setHealthSettings(DEFAULT_EDITOR_HEALTH_SETTINGS)
    storeEditorHealthSettings(DEFAULT_EDITOR_HEALTH_SETTINGS)
  }

  const runAllFilesHealthCheck = async () => {
    if (!api || !currentRepoPath) {
      setNotice('Open a repository before running health checks.')
      return
    }

    const nextSettings = healthSettings.enabled ? healthSettings : { ...healthSettings, enabled: true }
    if (!healthSettings.enabled) {
      updateHealthSettings({ enabled: true })
    }

    setHealthScanState({ status: 'running', scanned: 0, linted: 0, signals: 0, error: null })
    const refreshedFiles = await reloadEditorFiles(selectedPath)
    const scannedFiles = refreshedFiles.length > 0 ? refreshedFiles : files
    const liveReports = buildLiveHealthReports(scannedFiles, changeByPath, nextSettings)
    const manualReports = new Map<string, EditorHealthReport>()
    const lintCandidates = scannedFiles.filter((file) => lintRulesEnabledForFile(file.path, lintSettings))
    let linted = 0

    const lintFile = async (file: RepositoryFileEntry) => {
      try {
        const result = await api.getRepositoryFileChunk({
          repoPath: currentRepoPath,
          filePath: file.path,
          offset: 0,
          maxBytes: EDITOR_FILE_CHUNK_BYTES
        })
        linted += 1

        if (!result.ok) {
          manualReports.set(file.path, {
            severity: 'critical',
            issues: [{
              severity: 'critical',
              run: 'manual',
              category: 'load',
              title: 'Health read failed',
              detail: friendlyIpcErrorMessage(result.error.message, 'Could not read this file during all-files health.')
            }]
          })
          return
        }

        if (result.data.binary) {
          manualReports.set(file.path, {
            severity: 'warning',
            issues: [{
              severity: 'warning',
              run: 'manual',
              category: 'preview',
              title: 'Binary content',
              detail: 'This file matches a lintable extension but its content is binary, so all-files lint skipped it.'
            }]
          })
          return
        }

        if (result.data.hasMore) {
          manualReports.set(file.path, {
            severity: 'warning',
            issues: [{
              severity: 'warning',
              run: 'manual',
              category: 'batch',
              title: 'Large file skipped',
              detail: `All-files lint read the first ${formatBytes(result.data.endOffset)} of ${formatBytes(result.data.byteSize)}. Open the file to inspect chunks deliberately.`
            }]
          })
          return
        }

        const fileDiagnostics = validateEditorText(file.path, result.data.text, lintSettings)
        if (fileDiagnostics.length > 0) {
          manualReports.set(file.path, {
            severity: 'critical',
            issues: [{
              severity: 'critical',
              run: 'manual',
              category: 'diagnostics',
              title: 'Lint issues',
              detail: `${fileDiagnostics.length} issue${fileDiagnostics.length === 1 ? '' : 's'} found during all-files health. Open the file to inspect line details.`
            }]
          })
        }
      } catch (error) {
        linted += 1
        manualReports.set(file.path, {
          severity: 'critical',
          issues: [{
            severity: 'critical',
            run: 'manual',
            category: 'load',
            title: 'Health read failed',
            detail: friendlyIpcErrorMessage(error instanceof Error ? error.message : '', 'Could not read this file during all-files health.')
          }]
        })
      }
    }

    for (let index = 0; index < lintCandidates.length; index += EDITOR_HEALTH_LINT_CONCURRENCY) {
      await Promise.all(lintCandidates.slice(index, index + EDITOR_HEALTH_LINT_CONCURRENCY).map(lintFile))
    }

    const mergedReports = new Map(liveReports)
    manualReports.forEach((report, path) => {
      mergedReports.set(path, mergeHealthReports(mergedReports.get(path), report))
    })
    const signals = countHealthSignalFiles(mergedReports)
    setManualHealthByPath(manualReports)
    setHealthScanState({
      status: 'done',
      scanned: scannedFiles.length,
      linted,
      signals,
      error: null
    })
    setNotice(
      signals > 0
        ? `Health checked ${scannedFiles.length} file${scannedFiles.length === 1 ? '' : 's'} and linted ${linted}; ${signals} file${signals === 1 ? '' : 's'} need attention.`
        : `Health checked ${scannedFiles.length} file${scannedFiles.length === 1 ? '' : 's'} and linted ${linted}; no signals found.`
    )
  }

  return {
    healthSettings,
    healthMenuOpen,
    setHealthMenuOpen,
    healthScanState,
    setHealthScanState,
    setManualHealthByPath,
    healthEnabled,
    fileHealthByPath,
    liveHealthReports,
    selectedHealthReport,
    healthSignalCount,
    healthPanelSeverity,
    healthSummaryTitle,
    healthRunDisabled,
    healthScanSummary,
    updateHealthSettings,
    resetHealthSettings,
    runAllFilesHealthCheck
  }
}
