const EDITOR_LINT_SETTINGS_STORAGE_KEY = 'branchpilot:changes-editor-lint-settings'

export interface EditorLintSettings {
  autoValidate: boolean
  validateJson: boolean
  allowJsonComments: boolean
  allowJsonTrailingCommas: boolean
  validateScripts: boolean
  validateJsxTsx: boolean
  validateRegexLiterals: boolean
}

export type EditorLintRunStatus = 'idle' | 'running' | 'clean' | 'issues' | 'blocked'

export interface EditorLintRunState {
  status: EditorLintRunStatus
  message: string
  detail: string
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

export function readStoredLintSettings(): EditorLintSettings {
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

export function persistLintSettings(settings: EditorLintSettings) {
  try {
    window.localStorage.setItem(EDITOR_LINT_SETTINGS_STORAGE_KEY, JSON.stringify(settings))
  } catch {
    /* ignore unavailable storage */
  }
}
