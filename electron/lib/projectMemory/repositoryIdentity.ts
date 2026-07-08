import { createHash } from 'node:crypto'
import type { ProjectMemoryRepository } from '../../../src/shared/branchPilot.js'
import { normalizeNativePath } from '../platformExecutables.js'

export function repositoryId(repository: ProjectMemoryRepository): string
export function repositoryId(rootPath: string): string
export function repositoryId(input: ProjectMemoryRepository | string): string {
  if (typeof input === 'string') {
    return legacyRepositoryId(input)
  }

  return createHash('sha256').update(repositoryIdentityKey(input)).digest('hex').slice(0, 16)
}

export function legacyRepositoryId(rootPath: string): string {
  return createHash('sha256').update(rootPath).digest('hex').slice(0, 16)
}

function repositoryIdentityKey(repository: ProjectMemoryRepository): string {
  const remoteUrl = normalizeRemoteUrl(repository.remoteUrl)

  return remoteUrl ? `remote:${remoteUrl}` : `path:${normalizeNativePath(repository.rootPath)}`
}

export function normalizeRemoteUrl(remoteUrl?: string): string | null {
  const trimmed = remoteUrl?.trim()

  if (!trimmed) return null

  const sshMatch = trimmed.match(/^git@([^:]+):(.+)$/)

  if (sshMatch) {
    return normalizeRemoteParts(sshMatch[1], sshMatch[2])
  }

  try {
    const parsed = new URL(trimmed)
    return normalizeRemoteParts(parsed.host, parsed.pathname)
  } catch {
    return trimmed.replace(/\.git$/i, '').replace(/\/+$/, '').toLowerCase()
  }
}

function normalizeRemoteParts(host: string, pathname: string): string {
  return `${host.toLowerCase()}/${pathname.replace(/^\/+/, '').replace(/\.git$/i, '').replace(/\/+$/, '')}`.toLowerCase()
}
