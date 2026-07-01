import type { ReviewMode, ReviewScope } from './branchPilot.gitops.js'

export function reviewPromptModeLabel(mode: ReviewMode): string {
  if (mode === 'security') return 'security'
  if (mode === 'quality') return 'change quality'
  if (mode === 'knip') return 'Knip-style unused code'
  if (mode === 'depcheck') return 'Depcheck-style dependency'
  if (mode === 'osv') return 'OSV vulnerability'
  if (mode === 'gitleaks') return 'Gitleaks secret'
  return 'consistency'
}

export function reviewPromptFocus(mode: ReviewMode): string {
  if (mode === 'knip') {
    return [
      'Inspect only the changed files and exports in the provided diff.',
      'Find newly unused exports, dead files, stale scripts, and dependency references that a Knip scan would likely flag.',
      'Do not report existing project-wide dead code unless this diff introduces or exposes it.'
    ].join(' ')
  }

  if (mode === 'depcheck') {
    return [
      'Inspect changed imports, package manifests, lockfiles, build scripts, and config files.',
      'Find dependencies that look newly unused, missing, misplaced between dependencies/devDependencies, or required by scripts but absent.',
      'Focus on what can be inferred from the provided diff; avoid broad dependency inventory guesses.'
    ].join(' ')
  }

  if (mode === 'osv') {
    return [
      'Inspect changed dependency manifests and lockfiles for vulnerable package additions or version changes.',
      'Flag packages and versions that are likely vulnerable and recommend running OSV Scanner on the changed manifests.',
      'If the diff does not include dependency manifests or lockfiles, return no findings unless a clear vulnerable package/version is visible.'
    ].join(' ')
  }

  if (mode === 'gitleaks') {
    return [
      'Inspect only added or changed lines for secrets and credential-like material.',
      'Look for API keys, tokens, private keys, passwords, connection strings, GitHub tokens, cloud credentials, and high-entropy secret values.',
      'Ignore obvious placeholders and examples unless they are dangerous enough to be copied into production.'
    ].join(' ')
  }

  if (mode === 'security') {
    return 'Look for secrets, token leakage, unsafe shell/process execution, auth risks, destructive operations, and permission expansion.'
  }

  if (mode === 'quality') {
    return 'Look for likely bugs, edge cases, regressions, confusing behavior, compatibility issues, and missing validation.'
  }

  return 'Look for architecture boundary issues, naming problems, duplicated logic, missing tests, unrelated changes, and risky refactors.'
}

export function reviewPromptPreview(mode: ReviewMode, scope: ReviewScope = 'staged'): string {
  return [
    `Run a ${reviewPromptModeLabel(mode)} review for the ${scope} changes below.`,
    'Use only the provided Git context. This is report-only: do not suggest applying changes automatically.',
    'Return JSON only with this shape: {"summary":"...","findings":[{"severity":"medium","title":"...","details":"...","filePath":"optional","line":1,"recommendation":"optional"}]}',
    '',
    'Review focus:',
    reviewPromptFocus(mode)
  ].join('\n')
}
