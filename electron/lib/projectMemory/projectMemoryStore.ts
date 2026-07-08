import { promises as fs } from 'node:fs'
import path from 'node:path'
import type {
  ProjectMemoryRepository,
  ProjectMemorySnapshot
} from '../../../src/shared/branchPilot.js'
import { normalizeNativePath } from '../platformExecutables.js'
import { legacyRepositoryId, normalizeRemoteUrl, repositoryId } from './repositoryIdentity.js'

export const MEMORY_VERSION = 1

export class ProjectMemoryStore {
  constructor(private readonly directoryPath: string) {}

  async read(repository: ProjectMemoryRepository): Promise<ProjectMemorySnapshot | null> {
    for (const filePath of this.candidateFilePaths(repository)) {
      const snapshot = await this.readFile(filePath)

      if (snapshot) {
        return snapshot
      }
    }

    return this.findMatchingSnapshot(repository)
  }

  async write(snapshot: ProjectMemorySnapshot): Promise<void> {
    await fs.mkdir(this.directoryPath, { recursive: true })
    await fs.writeFile(this.filePath(snapshot.repository), JSON.stringify(snapshot, null, 2), 'utf8')
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

  private async findMatchingSnapshot(repository: ProjectMemoryRepository): Promise<ProjectMemorySnapshot | null> {
    const entries = await fs.readdir(this.directoryPath, { withFileTypes: true }).catch(() => [])
    const remoteKey = normalizeRemoteUrl(repository.remoteUrl)
    const matches: ProjectMemorySnapshot[] = []

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue

      const snapshot = await this.readFile(path.join(this.directoryPath, entry.name))

      if (!snapshot) continue

      const samePath = normalizeNativePath(snapshot.repository.rootPath) === normalizeNativePath(repository.rootPath)
      const sameRemote = remoteKey && normalizeRemoteUrl(snapshot.repository.remoteUrl) === remoteKey

      if (samePath || sameRemote) {
        matches.push(snapshot)
      }
    }

    matches.sort((left, right) => right.scannedAt.localeCompare(left.scannedAt))

    return matches[0] ?? null
  }

  private async readFile(filePath: string): Promise<ProjectMemorySnapshot | null> {
    try {
      const raw = await fs.readFile(filePath, 'utf8')
      const parsed = JSON.parse(raw) as ProjectMemorySnapshot

      return parsed.version === MEMORY_VERSION && parsed.repository?.rootPath ? parsed : null
    } catch {
      return null
    }
  }
}
