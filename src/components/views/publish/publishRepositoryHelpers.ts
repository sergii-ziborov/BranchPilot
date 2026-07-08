import type { GitHubAccountSummary, RepositorySnapshot } from '../../../shared/branchPilot'

export type OwnerKind = GitHubAccountSummary['type']

export function sanitizeRepositoryName(value: string): string {
  return value
    .trim()
    .replace(/\.git$/i, '')
    .replace(/[^A-Za-z0-9_.-]+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '')
    .slice(0, 100)
}

export function buildRepositoryNameSuggestions(defaultName: string): string[] {
  const compact = sanitizeRepositoryName(defaultName.replace(/[\s_]+/g, '-'))
  const lower = sanitizeRepositoryName(compact.toLowerCase())
  const dotted = sanitizeRepositoryName(lower.replaceAll('-', '.'))
  return uniqueStrings([compact, lower, dotted]).filter(Boolean).slice(0, 3)
}

export function titleFromRepositoryName(repositoryName: string): string {
  const words = repositoryName
    .replace(/[._-]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)

  return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ') || 'Repository'
}

export function buildLocalReadme(title: string, description: string): string {
  return `# ${title}

${description}

## Development

Install dependencies and run the project using the commands defined by this repository.

## Repository

This repository was published from BranchPilot.
`
}

export function buildLocalGitignore(snapshot: RepositorySnapshot | null): string {
  const paths = snapshot?.status.changes.map((change) => change.path).join('\n') ?? ''
  const patterns = [
    'node_modules/',
    'dist/',
    'build/',
    '.env',
    '.env.local',
    '*.log'
  ]

  if (/\.py\b|pyproject\.toml|requirements\.txt/i.test(paths)) {
    patterns.push('__pycache__/', '*.py[cod]', '.venv/')
  }

  if (/\.rs\b|Cargo\.toml/i.test(paths)) {
    patterns.push('target/')
  }

  return uniqueStrings(patterns).join('\n') + '\n'
}

export function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))]
}

export function normalizeEmailInput(value: string | undefined): string {
  return value?.trim() ?? ''
}

export function isSameEmail(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase()
}

export function createRepositoryBlockedReason({
  apiReady,
  repoPath,
  authenticated,
  authMessage,
  owner,
  name
}: {
  apiReady: boolean
  repoPath?: string
  authenticated: boolean
  authMessage?: string
  owner: string
  name: string
}): string {
  if (!apiReady) return 'BranchPilot API is not available.'
  if (!repoPath) return 'Open a local Git repository first.'
  if (!authenticated) return authMessage || 'Sign in to GitHub with gh or Git credentials first.'
  if (!owner.trim()) return 'Choose a GitHub user or organization.'
  if (!name.trim()) return 'Enter a repository name.'
  return ''
}
