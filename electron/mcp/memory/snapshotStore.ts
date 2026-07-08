import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { ProjectMemorySnapshot, ProjectWikiSnapshot } from '../../../src/shared/branchPilot.js'
import { ProjectWikiStore } from '../../lib/projectWikiService.js'
import type { MemoryQueryOptions } from './queryOptions.js'

const SNAPSHOT_VERSION = 1

export async function loadProjectMemorySnapshot(options: MemoryQueryOptions): Promise<ProjectMemorySnapshot> {
  if (!options.memoryDir.trim()) {
    throw new Error('Project Memory directory is required.')
  }

  if (options.repoPath) {
    const legacyFilePath = path.join(options.memoryDir, `${repositoryId(options.repoPath)}.json`)

    try {
      return await readSnapshot(legacyFilePath)
    } catch {
      const snapshots = await readSnapshots(options.memoryDir)
      const normalizedRepoPath = normalizePath(options.repoPath)
      const matchingSnapshots = snapshots.filter((snapshot) => normalizePath(snapshot.repository.rootPath) === normalizedRepoPath)

      matchingSnapshots.sort((left, right) => right.scannedAt.localeCompare(left.scannedAt))

      const match = matchingSnapshots[0]

      if (match) {
        return match
      }

      throw new Error('No Project Memory snapshot found for this repository. Open the repository in BranchPilot and run Memory > Rescan.')
    }
  }

  const snapshots = await readSnapshots(options.memoryDir)

  snapshots.sort((left, right) => right.scannedAt.localeCompare(left.scannedAt))

  const latest = snapshots[0]

  if (!latest) {
    throw new Error('No Project Memory snapshot found. Open the repository in BranchPilot and run Memory > Rescan.')
  }

  return latest
}

export async function loadProjectWikiSnapshot(options: MemoryQueryOptions): Promise<ProjectWikiSnapshot> {
  const snapshot = await loadProjectMemorySnapshot(options)

  if (!options.wikiDir?.trim()) {
    throw new Error('Project Wiki directory is required. Recopy the BranchPilot MCP config from Reports > MCP.')
  }

  const wiki = await new ProjectWikiStore(options.wikiDir).read(snapshot.repository)

  if (!wiki) {
    throw new Error('No Project Wiki snapshot found. Open the repository in BranchPilot and run Memory > Generate wiki.')
  }

  return wiki
}

async function readSnapshot(filePath: string): Promise<ProjectMemorySnapshot> {
  let raw: string

  try {
    raw = await fs.readFile(filePath, 'utf8')
  } catch {
    throw new Error('No Project Memory snapshot found. Open the repository in BranchPilot and run Memory > Rescan.')
  }

  try {
    const parsed = JSON.parse(raw) as ProjectMemorySnapshot

    if (parsed.version !== SNAPSHOT_VERSION || !parsed.repository?.rootPath || !Array.isArray(parsed.files)) {
      throw new Error('Invalid Project Memory snapshot.')
    }

    return parsed
  } catch (error) {
    if (error instanceof Error && error.message === 'Invalid Project Memory snapshot.') {
      throw error
    }

    throw new Error('Project Memory snapshot is malformed. Run Memory > Rescan in BranchPilot.', {
      cause: error
    })
  }
}

async function readSnapshots(directoryPath: string): Promise<ProjectMemorySnapshot[]> {
  const entries = await fs.readdir(directoryPath, { withFileTypes: true }).catch(() => [])
  const snapshots: ProjectMemorySnapshot[] = []
  let firstSnapshotError: Error | undefined

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) {
      continue
    }

    try {
      snapshots.push(await readSnapshot(path.join(directoryPath, entry.name)))
    } catch (error) {
      if (!firstSnapshotError && error instanceof Error && !error.message.startsWith('No Project Memory snapshot found')) {
        firstSnapshotError = error
      }
    }
  }

  if (snapshots.length === 0 && firstSnapshotError) {
    throw firstSnapshotError
  }

  return snapshots
}

function normalizePath(filePath: string): string {
  return path.resolve(filePath)
}

function repositoryId(rootPath: string): string {
  return createHash('sha256').update(rootPath).digest('hex').slice(0, 16)
}
