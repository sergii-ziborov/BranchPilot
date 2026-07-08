import path from 'node:path'

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200
const DEFAULT_MAX_BYTES = 120_000

export function resolveRepositoryFilePath(repoPath: string, relativePath: string): string {
  const root = path.resolve(repoPath)
  const absolutePath = path.resolve(root, normalizeRepositoryRelativePath(relativePath))
  const relative = path.relative(root, absolutePath)

  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Path escapes repository root: ${relativePath}`)
  }

  return absolutePath
}

export function normalizeRepositoryRelativePath(value: string): string {
  const normalized = value.replace(/\\/g, '/').replace(/^\/+/, '').trim()

  if (!normalized || normalized.split('/').some((part) => part === '..')) {
    throw new Error(`Invalid repository-relative path: ${value}`)
  }

  return normalized
}

export function normalizeGitRef(value: string): string {
  const normalized = value.trim()

  if (!normalized || normalized.startsWith('-')) {
    throw new Error(`Invalid Git ref: ${value}`)
  }

  return normalized
}

export function normalizeExtension(value: string | undefined): string {
  const normalized = value?.trim().toLowerCase()

  if (!normalized) return ''

  return normalized.startsWith('.') ? normalized : `.${normalized}`
}

export function normalizeQuery(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase()
}

export function normalizeLimit(limit: number | undefined): number {
  if (!limit || !Number.isFinite(limit)) {
    return DEFAULT_LIMIT
  }

  return Math.min(MAX_LIMIT, Math.max(1, Math.floor(limit)))
}

export function normalizeMaxBytes(maxBytes: number | undefined): number {
  if (!maxBytes || !Number.isFinite(maxBytes)) {
    return DEFAULT_MAX_BYTES
  }

  return Math.min(1_000_000, Math.max(4_000, Math.floor(maxBytes)))
}

export function truncateText(text: string, maxBytes: number): string {
  const buffer = Buffer.from(text)

  if (buffer.length <= maxBytes) {
    return text
  }

  return `${buffer.subarray(0, maxBytes).toString('utf8')}\n\n[truncated at ${maxBytes} bytes]`
}
