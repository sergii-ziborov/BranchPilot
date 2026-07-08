import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { ProjectMemoryRepository, ProjectWikiSnapshot } from '../../../src/shared/branchPilot.js'
import { normalizeNativePath } from '../platformExecutables.js'
import { writeMarkdownPagesToDirectory } from './markdownPageFiles.js'

export const WIKI_VERSION = 1

export class ProjectWikiStore {
  constructor(private readonly directoryPath: string) {}

  async read(repository: ProjectMemoryRepository): Promise<ProjectWikiSnapshot | null> {
    for (const filePath of this.candidateFilePaths(repository)) {
      const wiki = await this.readFile(filePath)

      if (wiki) {
        return wiki
      }
    }

    return this.findMatchingWiki(repository)
  }

  async write(wiki: ProjectWikiSnapshot): Promise<ProjectWikiSnapshot> {
    await fs.mkdir(this.directoryPath, { recursive: true })
    const markdownDir = this.markdownDirectory(wiki.repository)
    const storedWiki: ProjectWikiSnapshot = {
      ...wiki,
      markdownDir
    }

    await fs.writeFile(this.filePath(wiki.repository), JSON.stringify(storedWiki, null, 2), 'utf8')
    await writeMarkdownPagesToDirectory(storedWiki.pages, markdownDir, true)

    return storedWiki
  }

  markdownDirectory(repository: ProjectMemoryRepository): string {
    return path.join(this.directoryPath, `${repositoryId(repository)}-pages`)
  }

  private filePath(repository: ProjectMemoryRepository): string {
    return path.join(this.directoryPath, `${repositoryId(repository)}.json`)
  }

  private legacyFilePath(rootPath: string): string {
    return path.join(this.directoryPath, `${legacyRepositoryId(rootPath)}.json`)
  }

  private candidateFilePaths(repository: ProjectMemoryRepository): string[] {
    return [...new Set([
      this.filePath(repository),
      this.legacyFilePath(repository.rootPath)
    ])]
  }

  private async findMatchingWiki(repository: ProjectMemoryRepository): Promise<ProjectWikiSnapshot | null> {
    const entries = await fs.readdir(this.directoryPath, { withFileTypes: true }).catch(() => [])
    const remoteKey = normalizeRemoteUrl(repository.remoteUrl)
    const matches: ProjectWikiSnapshot[] = []

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue

      const wiki = await this.readFile(path.join(this.directoryPath, entry.name))

      if (!wiki) continue

      const samePath = normalizeNativePath(wiki.repository.rootPath) === normalizeNativePath(repository.rootPath)
      const sameRemote = remoteKey && normalizeRemoteUrl(wiki.repository.remoteUrl) === remoteKey

      if (samePath || sameRemote) {
        matches.push(wiki)
      }
    }

    matches.sort((left, right) => right.generatedAt.localeCompare(left.generatedAt))

    return matches[0] ?? null
  }

  private async readFile(filePath: string): Promise<ProjectWikiSnapshot | null> {
    try {
      const raw = await fs.readFile(filePath, 'utf8')
      const parsed = JSON.parse(raw) as ProjectWikiSnapshot

      return isProjectWikiSnapshot(parsed) ? parsed : null
    } catch {
      return null
    }
  }
}

function isProjectWikiSnapshot(value: ProjectWikiSnapshot): boolean {
  return Boolean(
    value.version === WIKI_VERSION &&
    value.repository?.rootPath &&
    value.generatedAt &&
    value.sourceMemoryScannedAt &&
    Array.isArray(value.pages)
  )
}

function repositoryId(repository: ProjectMemoryRepository): string {
  return createHash('sha256').update(repositoryIdentityKey(repository)).digest('hex').slice(0, 16)
}

function legacyRepositoryId(rootPath: string): string {
  return createHash('sha256').update(rootPath).digest('hex').slice(0, 16)
}

function repositoryIdentityKey(repository: ProjectMemoryRepository): string {
  const remoteUrl = normalizeRemoteUrl(repository.remoteUrl)

  return remoteUrl ? `remote:${remoteUrl}` : `path:${normalizeNativePath(repository.rootPath)}`
}

function normalizeRemoteUrl(remoteUrl?: string): string | null {
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
