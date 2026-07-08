import { Code2 } from 'lucide-react'
import type { EditorDiagnostic } from './editorTypes'
import type { EditorLintRunState, EditorLintSettings } from './lintSettings'

interface EditorLintMenuProps {
  lintMenuClassName: string
  selectedLintSupported: boolean
  lintBlocked: boolean
  lintBadgeLabel: string
  lintRunState: EditorLintRunState
  runLint: (focusFirst?: boolean) => void
  diagnostics: EditorDiagnostic[]
  goToDiagnostic: (diagnostic: EditorDiagnostic) => void
  lintSettings: EditorLintSettings
  updateLintSettings: (patch: Partial<EditorLintSettings>) => void
}

export function EditorLintMenu({
  lintMenuClassName,
  selectedLintSupported,
  lintBlocked,
  lintBadgeLabel,
  lintRunState,
  runLint,
  diagnostics,
  goToDiagnostic,
  lintSettings,
  updateLintSettings
}: EditorLintMenuProps) {
  return (
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
  )
}
