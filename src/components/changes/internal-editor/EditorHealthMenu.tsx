import type { Dispatch, SetStateAction } from 'react'
import { Activity, RefreshCw } from 'lucide-react'
import { clamp } from './editorPrimitives'
import {
  healthRunLabel,
  type EditorHealthBooleanSetting,
  type EditorHealthReport,
  type EditorHealthScanState,
  type EditorHealthSettings,
  type EditorHealthSeverity
} from './editorHealth'

export interface EditorHealthMenuProps {
  healthMenuRef: { current: HTMLDivElement | null }
  healthPanelSeverity: EditorHealthSeverity
  healthEnabled: boolean
  healthSummaryTitle: string
  healthMenuOpen: boolean
  setHealthMenuOpen: Dispatch<SetStateAction<boolean>>
  healthSignalCount: number
  runAllFilesHealthCheck: () => Promise<void>
  healthRunDisabled: boolean
  healthScanState: EditorHealthScanState
  healthScanSummary: string
  healthSettings: EditorHealthSettings
  updateHealthSettings: (patch: Partial<EditorHealthSettings>) => void
  resetHealthSettings: () => void
  selectedPath: string
  selectedHealthReport: EditorHealthReport
  liveHealthReports: Array<{ path: string; report: EditorHealthReport }>
  setSelectedPath: (path: string) => void
}

export function EditorHealthMenu({
  healthMenuRef,
  healthPanelSeverity,
  healthEnabled,
  healthSummaryTitle,
  healthMenuOpen,
  setHealthMenuOpen,
  healthSignalCount,
  runAllFilesHealthCheck,
  healthRunDisabled,
  healthScanState,
  healthScanSummary,
  healthSettings,
  updateHealthSettings,
  resetHealthSettings,
  selectedPath,
  selectedHealthReport,
  liveHealthReports,
  setSelectedPath
}: EditorHealthMenuProps) {
  const setHealthNumberSetting = (key: 'churnWarning' | 'churnCritical' | 'denseChunkWarning', value: string) => {
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return
    const limits = key === 'denseChunkWarning'
      ? { min: 100, max: 20_000 }
      : key === 'churnCritical'
        ? { min: 40, max: 20_000 }
        : { min: 20, max: 10_000 }
    updateHealthSettings({ [key]: Math.round(clamp(parsed, limits.min, limits.max)) } as Partial<EditorHealthSettings>)
  }

  const renderHealthToggle = (key: EditorHealthBooleanSetting, label: string, detail: string) => (
    <label className="changes-editor-health-setting" key={key}>
      <input
        type="checkbox"
        checked={Boolean(healthSettings[key])}
        onChange={(event) => updateHealthSettings({ [key]: event.currentTarget.checked } as Partial<EditorHealthSettings>)}
      />
      <span>
        <b>{label}</b>
        <small>{detail}</small>
      </span>
    </label>
  )

  const renderHealthNumber = (key: 'churnWarning' | 'churnCritical' | 'denseChunkWarning', label: string, detail: string) => (
    <label className="changes-editor-health-number" key={key}>
      <span>
        <b>{label}</b>
        <small>{detail}</small>
      </span>
      <input
        type="number"
        min={key === 'denseChunkWarning' ? 100 : 20}
        max={key === 'churnCritical' ? 20_000 : 10_000}
        step={key === 'denseChunkWarning' ? 100 : 10}
        value={healthSettings[key]}
        onChange={(event) => setHealthNumberSetting(key, event.currentTarget.value)}
      />
    </label>
  )

  return (
    <div
      className={`changes-editor-health-menu health-${healthPanelSeverity}${healthEnabled ? ' is-enabled' : ' is-disabled'}`}
      ref={healthMenuRef}
    >
      <button
        type="button"
        className="changes-editor-health-trigger"
        title={healthSummaryTitle}
        aria-expanded={healthMenuOpen}
        onClick={() => setHealthMenuOpen((open) => !open)}
      >
        <Activity size={15} />
        <span>Health</span>
        <strong>{healthEnabled ? (healthSignalCount || 'OK') : 'off'}</strong>
      </button>
      {healthMenuOpen && (
        <div className="changes-editor-health-panel" role="dialog" aria-label="Module health settings">
          <header>
            <div>
              <strong>Module health</strong>
              <span>Live checks mark file rows from the git snapshot. On-open checks run only after a file is opened.</span>
            </div>
            <div className="changes-editor-health-actions">
              <button type="button" onClick={() => void runAllFilesHealthCheck()} disabled={healthRunDisabled}>
                <RefreshCw className={healthScanState.status === 'running' ? 'spin' : undefined} size={13} />
                Run all files
              </button>
              <button type="button" onClick={() => updateHealthSettings({ enabled: !healthEnabled })}>
                {healthEnabled ? 'Disable' : 'Enable'}
              </button>
            </div>
          </header>
          <section className="changes-editor-health-mode-grid">
            <span>Run model</span>
            <p className="health-mode-card">
              <b>Live, all files</b>
              Runs without opening file contents: conflict status and change pressure from added/deleted git lines. These can show row icons immediately.
            </p>
            <p className="health-mode-card">
              <b>On open / click</b>
              Runs for the active file only: chunked ranges, load limits, lint diagnostics, dirty draft, and dense rendered chunks.
            </p>
          </section>
          <section>
            <span>Last all-files run</span>
            <strong>{healthScanSummary}</strong>
            {healthScanState.error && <p className="danger-text">{healthScanState.error}</p>}
          </section>
          <section className="changes-editor-health-settings">
            <span>Live checks</span>
            {renderHealthToggle('rowSignals', 'File row signals', 'Show problem icons next to files when health is enabled.')}
            {renderHealthToggle('mainConflicts', 'Git conflicts', 'Flag conflicted files from repository status.')}
            {renderHealthToggle('mainChurn', 'Change pressure', 'Flag files with many added/deleted lines.')}
          </section>
          <section className="changes-editor-health-settings">
            <span>On-open checks</span>
            {renderHealthToggle('fileChunkedRanges', 'Chunked ranges', 'Flag language files and hex files loaded by chunks.')}
            {renderHealthToggle('fileDiagnostics', 'Lint diagnostics', 'Promote current lint issues into health.')}
            {renderHealthToggle('fileDirtyDraft', 'Unsaved draft', 'Flag the active file while it has unsaved editor edits.')}
            {renderHealthToggle('fileLoadLimits', 'Load limits', 'Flag binary/preview-only/error states for the opened file.')}
            {renderHealthToggle('fileDenseChunk', 'Dense editor chunks', 'Warn when the currently loaded chunk has many rendered lines.')}
          </section>
          <section className="changes-editor-health-settings">
            <span>Thresholds</span>
            {renderHealthNumber('churnWarning', 'Churn warning', 'Added + deleted lines before a warning.')}
            {renderHealthNumber('churnCritical', 'Churn critical', 'Added + deleted lines before a critical signal.')}
            {renderHealthNumber('denseChunkWarning', 'Dense chunk lines', 'Rendered lines in the opened chunk before warning.')}
            <button type="button" className="secondary" onClick={resetHealthSettings}>
              Reset health settings
            </button>
          </section>
          {healthEnabled ? (
            <>
              <section>
                <span>Selected file</span>
                <strong>{selectedPath || 'No file selected'}</strong>
                {selectedHealthReport.issues.length === 0 ? (
                  <p>No lightweight issues found for this file.</p>
                ) : (
                  selectedHealthReport.issues.map((issue) => (
                    <p className={`health-issue health-${issue.severity}`} key={`${issue.run}-${issue.category}-${issue.title}`}>
                      <span className="health-issue-head">
                        <b>{issue.title}</b>
                        <span className={`health-run-badge health-run-${issue.run}`}>{healthRunLabel(issue.run)}</span>
                      </span>
                      {issue.detail}
                    </p>
                  ))
                )}
              </section>
              {liveHealthReports.length > 0 && (
                <section>
                  <span>Live repository signals</span>
                  {liveHealthReports.map(({ path, report }) => (
                    <button
                      type="button"
                      key={path}
                      onClick={() => {
                        setSelectedPath(path)
                        setHealthMenuOpen(false)
                      }}
                    >
                      <Activity size={12} />
                      <strong>{path}</strong>
                      <small>
                        {report.issues[0] && (
                          <span className={`health-run-badge health-run-${report.issues[0].run}`}>
                            {healthRunLabel(report.issues[0].run)}
                          </span>
                        )}
                        {report.issues[0]?.title}
                      </small>
                    </button>
                  ))}
                </section>
              )}
            </>
          ) : (
            <section>
              <span>Disabled</span>
              <p>Health checks are off. File rows will not show health signals.</p>
            </section>
          )}
        </div>
      )}
    </div>
  )
}
