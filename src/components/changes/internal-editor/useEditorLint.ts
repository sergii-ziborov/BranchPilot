import { useEffect, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { EditorDiagnostic } from './editorTypes'
import {
  JSON_RE,
  lintRulesEnabledForFile,
  lintStateFromDiagnostics,
  validateEditorText
} from './editorLintHelpers'
import { SCRIPT_RE } from './editorViewConstants'
import {
  persistLintSettings,
  readStoredLintSettings,
  type EditorLintRunState,
  type EditorLintSettings
} from './lintSettings'
import type { EditorViewMode } from './editorViewHelpers'

interface UseEditorLintParams {
  selectedPath: string
  chunkedTextActive: boolean
  textUnavailableMessage: string | null
  fileLoading: boolean
  fileError: string | null
  viewMode: EditorViewMode
  draftText: string
  diagnostics: EditorDiagnostic[]
  setDiagnostics: Dispatch<SetStateAction<EditorDiagnostic[]>>
  focusCodePosition: (lineNumber: number, column: number, length: number) => void
  flushActiveEditorDraftText: () => string
  setNotice: (message: string) => void
}

export function useEditorLint({
  selectedPath,
  chunkedTextActive,
  textUnavailableMessage,
  fileLoading,
  fileError,
  viewMode,
  draftText,
  diagnostics,
  setDiagnostics,
  focusCodePosition,
  flushActiveEditorDraftText,
  setNotice
}: UseEditorLintParams) {
  const [lintSettings, setLintSettings] = useState(readStoredLintSettings)
  const [lintRunState, setLintRunState] = useState<EditorLintRunState>({
    status: 'idle',
    message: 'Lint has not run yet.',
    detail: 'Open a supported file and run lint.'
  })

  const selectedIsJson = JSON_RE.test(selectedPath)
  const selectedLintSupported = !chunkedTextActive && (selectedIsJson || SCRIPT_RE.test(selectedPath))
  const selectedHexOnly = Boolean(textUnavailableMessage)
  const lintBlocked = !selectedPath || fileLoading || Boolean(fileError) || selectedHexOnly || chunkedTextActive || viewMode === 'image' || viewMode === 'hex'
  const selectedLintRulesEnabled = selectedLintSupported && lintRulesEnabledForFile(selectedPath, lintSettings)

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
    const lintText = flushActiveEditorDraftText()
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

  return {
    lintSettings,
    lintRunState,
    setLintRunState,
    selectedLintSupported,
    lintBlocked,
    selectedLintRulesEnabled,
    lintBadgeLabel,
    lintMenuClassName,
    goToDiagnostic,
    updateLintSettings,
    runLint
  }
}
