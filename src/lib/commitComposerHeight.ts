export const COMMIT_COMPOSER_STORAGE_KEY = 'branchpilot:commit-composer-height'
export const COMMIT_COMPOSER_DEFAULT_HEIGHT = 184
export const COMMIT_COMPOSER_MIN_HEIGHT = 132
export const COMMIT_COMPOSER_MAX_HEIGHT = 420

export function clampCommitComposerHeight(value: number): number {
  return Math.min(Math.max(Math.round(value), COMMIT_COMPOSER_MIN_HEIGHT), COMMIT_COMPOSER_MAX_HEIGHT)
}

export function readStoredCommitComposerHeight(): number {
  try {
    const raw = window.localStorage.getItem(COMMIT_COMPOSER_STORAGE_KEY)
    if (raw === null) return COMMIT_COMPOSER_DEFAULT_HEIGHT
    const height = Number(raw)
    return Number.isFinite(height) ? clampCommitComposerHeight(height) : COMMIT_COMPOSER_DEFAULT_HEIGHT
  } catch {
    return COMMIT_COMPOSER_DEFAULT_HEIGHT
  }
}
