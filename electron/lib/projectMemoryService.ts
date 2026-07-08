import path from 'node:path'
import type {
  CommitSummary,
  ProjectMemoryRepository,
  ProjectMemoryScanResult,
  ProjectMemorySnapshot,
  RemoteSummary
} from '../../src/shared/branchPilot.js'
import { CommandRunner } from './commandRunner.js'
import { GIT_EXECUTABLE, normalizeNativePath } from './platformExecutables.js'
import { MEMORY_VERSION, ProjectMemoryStore } from './projectMemory/projectMemoryStore.js'
import { scanProject } from './projectMemory/projectScanner.js'
import { repositoryId } from './projectMemory/repositoryIdentity.js'
import { getStackHints } from './projectMemory/stackHints.js'

export { ProjectMemoryStore }

const RECENT_COMMIT_LIMIT = 50

export class ProjectMemoryService {
  constructor(
    private readonly runner: CommandRunner,
    private readonly storage: ProjectMemoryStore
  ) {}

  async getProjectMemory(repoPath: string): Promise<ProjectMemorySnapshot | null> {
    const rootPath = await this.resolveRepositoryRoot(repoPath)
    const repository = await this.getRepository(rootPath)
    const snapshot = await this.storage.read(repository)

    if (!snapshot) {
      return null
    }

    const hydratedSnapshot = { ...snapshot, repository }

    if (snapshot.repository.id !== repository.id || snapshot.repository.rootPath !== repository.rootPath) {
      await this.storage.write(hydratedSnapshot)
    }

    return hydratedSnapshot
  }

  async scanProjectMemory(repoPath: string): Promise<ProjectMemoryScanResult> {
    const startedAt = Date.now()
    const rootPath = await this.resolveRepositoryRoot(repoPath)
    const repository = await this.getRepository(rootPath)
    const scanState = await scanProject(rootPath)
    const recentCommits = await this.getRecentCommits(rootPath)

    const snapshot: ProjectMemorySnapshot = {
      version: MEMORY_VERSION,
      scannedAt: new Date().toISOString(),
      repository,
      files: scanState.files,
      symbols: scanState.symbols,
      imports: scanState.imports,
      stackHints: await getStackHints(rootPath),
      recentCommits
    }

    await this.storage.write(snapshot)

    return {
      snapshot,
      durationMs: Date.now() - startedAt,
      scannedFileCount: scanState.scannedFileCount,
      skippedFileCount: scanState.skippedFileCount
    }
  }

  private async resolveRepositoryRoot(repoPath: string): Promise<string> {
    const result = await this.git(repoPath, ['rev-parse', '--show-toplevel'])
    return normalizeNativePath(result.stdout.trim())
  }

  private async getRepository(rootPath: string): Promise<ProjectMemoryRepository> {
    const branch = await this.git(rootPath, ['branch', '--show-current'], { allowedExitCodes: [0, 1] })
    const remote = await this.getPrimaryRemote(rootPath)
    const currentBranch = branch.stdout.trim() || 'Detached HEAD'
    const remoteUrl = remote?.fetchUrl ?? remote?.pushUrl
    const repository = {
      id: '',
      rootPath,
      name: path.basename(rootPath),
      currentBranch,
      remoteName: remote?.name,
      remoteUrl
    }

    return {
      ...repository,
      id: repositoryId(repository),
      rootPath,
      name: path.basename(rootPath),
      currentBranch
    }
  }

  private async getPrimaryRemote(rootPath: string): Promise<RemoteSummary | undefined> {
    return (await this.listRemotes(rootPath)).find((remote) => remote.fetchUrl || remote.pushUrl)
  }

  private async listRemotes(rootPath: string): Promise<RemoteSummary[]> {
    const result = await this.git(rootPath, ['remote', '-v'], { allowedExitCodes: [0, 1] })
    const remotes = new Map<string, RemoteSummary>()

    for (const line of result.stdout.split('\n').map((entry) => entry.trim()).filter(Boolean)) {
      const match = line.match(/^(\S+)\s+(\S+)\s+\((fetch|push)\)$/)

      if (!match) {
        continue
      }

      const [, name, url, direction] = match
      const remote = remotes.get(name) ?? { name }

      if (direction === 'fetch') {
        remote.fetchUrl = url
      } else {
        remote.pushUrl = url
      }

      remotes.set(name, remote)
    }

    return [...remotes.values()]
  }

  private async getRecentCommits(rootPath: string): Promise<CommitSummary[]> {
    const result = await this.git(rootPath, [
      'log',
      `--max-count=${RECENT_COMMIT_LIMIT}`,
      '--date=iso-strict',
      '--pretty=format:%H%x00%h%x00%s%x00%P%x00%an%x00%ae%x00%ad'
    ], {
      allowedExitCodes: [0, 128]
    })

    if (result.exitCode !== 0 || !result.stdout.trim()) {
      return []
    }

    return result.stdout
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [sha, shortSha, subject, parentShasText, authorName, authorEmail, authoredAt] = line.split('\0')

        return {
          sha,
          shortSha,
          subject,
          parentShas: parentShasText ? parentShasText.split(' ').filter(Boolean) : [],
          authorName,
          authorEmail,
          authoredAt
        }
      })
  }

  private async git(
    cwd: string,
    args: string[],
    options: { allowedExitCodes?: number[] } = {}
  ) {
    return this.runner.run(GIT_EXECUTABLE, args, {
      cwd,
      allowedExitCodes: options.allowedExitCodes
    })
  }
}
