import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type {
  ProjectMemorySnapshot,
  ProjectWikiGenerationResult,
  ProjectWikiPage,
  ProjectWikiPageUpdateRequest,
  ProjectWikiSyncResult,
  ProjectWikiSnapshot
} from '../../src/shared/branchPilot.js'
import type { ActivityLogService } from './activityLogService.js'
import type { CommandRunner } from './commandRunner.js'
import { BranchPilotUserError } from './errors.js'
import type { ProjectMemoryService } from './projectMemoryService.js'
import { GIT_EXECUTABLE } from './platformExecutables.js'
import { ensureGitIdentity, errorMessage, githubWikiRemoteUrl } from './projectWiki/githubWikiRemote.js'
import { readMarkdownPages, writeMarkdownPagesToDirectory } from './projectWiki/markdownPageFiles.js'
import { buildWikiPages } from './projectWiki/wikiPageBuilders.js'
import { WIKI_VERSION } from './projectWiki/wikiStore.js'
import type { ProjectWikiStore } from './projectWiki/wikiStore.js'
import { summarizeMarkdown, titleFromPageId } from './projectWiki/wikiText.js'

export { ProjectWikiStore } from './projectWiki/wikiStore.js'

const ACTIVITY_LIMIT = 80

export class ProjectWikiService {
  constructor(
    private readonly projectMemoryService: ProjectMemoryService,
    private readonly activityLogService: ActivityLogService,
    private readonly storage: ProjectWikiStore,
    private readonly commandRunner: CommandRunner
  ) {}

  async getProjectWiki(repoPath: string): Promise<ProjectWikiSnapshot | null> {
    const memory = await this.projectMemoryService.getProjectMemory(normalizeRepoPath(repoPath))

    if (!memory) {
      return null
    }

    const wiki = await this.storage.read(memory.repository)

    if (!wiki) {
      return null
    }

    const hydratedWiki = { ...wiki, repository: memory.repository }

    if (
      wiki.repository.id !== memory.repository.id ||
      wiki.repository.rootPath !== memory.repository.rootPath ||
      !wiki.markdownDir
    ) {
      return this.storage.write(hydratedWiki)
    }

    return hydratedWiki
  }

  async generateProjectWiki(repoPath: string): Promise<ProjectWikiGenerationResult> {
    const memory = await this.projectMemoryService.scanProjectMemory(normalizeRepoPath(repoPath))
    const activity = (await this.activityLogService.getActivityLog({
      repoPath: memory.snapshot.repository.rootPath,
      limit: ACTIVITY_LIMIT
    })).entries
    const wiki: ProjectWikiSnapshot = {
      version: WIKI_VERSION,
      generatedAt: new Date().toISOString(),
      sourceMemoryScannedAt: memory.snapshot.scannedAt,
      repository: memory.snapshot.repository,
      pages: buildWikiPages(memory.snapshot, activity)
    }

    const storedWiki = await this.storage.write(wiki)

    return {
      wiki: storedWiki,
      memory
    }
  }

  async saveProjectWikiPage(request: ProjectWikiPageUpdateRequest): Promise<ProjectWikiSnapshot> {
    const memory = await this.requireProjectMemory(request.repoPath)
    const wiki = await this.storage.read(memory.repository)

    if (!wiki) {
      throw new BranchPilotUserError('project_wiki_missing', 'Generate or pull Project Wiki before editing pages.')
    }

    const pageIndex = wiki.pages.findIndex((page) => page.id === request.pageId)
    const existingPage = pageIndex >= 0 ? wiki.pages[pageIndex] : null
    const nextPage: ProjectWikiPage = {
      id: request.pageId,
      title: existingPage?.title ?? titleFromPageId(request.pageId),
      summary: summarizeMarkdown(request.markdown),
      markdown: request.markdown
    }
    const pages = [...wiki.pages]

    if (pageIndex >= 0) {
      pages[pageIndex] = nextPage
    } else {
      pages.push(nextPage)
    }

    return this.storage.write({
      ...wiki,
      repository: memory.repository,
      pages
    })
  }

  async pullFromGitHubWiki(repoPath: string): Promise<ProjectWikiSyncResult> {
    const memory = await this.requireProjectMemory(repoPath)
    const remoteUrl = githubWikiRemoteUrl(memory.repository)
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'branchpilot-github-wiki-'))

    try {
      await this.runGit(['clone', '--depth', '1', '--', remoteUrl, tempDir], undefined, 90_000)
      const pages = await readMarkdownPages(tempDir)

      if (pages.length === 0) {
        throw new BranchPilotUserError('github_wiki_empty', 'GitHub Wiki has no Markdown pages.')
      }

      const wiki = await this.storage.write({
        version: WIKI_VERSION,
        generatedAt: new Date().toISOString(),
        sourceMemoryScannedAt: memory.scannedAt,
        repository: memory.repository,
        pages
      })

      return {
        wiki,
        pageCount: pages.length,
        remoteUrl,
        message: `Loaded ${pages.length} GitHub Wiki pages.`
      }
    } catch (error) {
      if (error instanceof BranchPilotUserError) {
        throw error
      }

      throw new BranchPilotUserError(
        'github_wiki_pull_failed',
        'Unable to load GitHub Wiki pages.',
        errorMessage(error)
      )
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true })
    }
  }

  async pushToGitHubWiki(repoPath: string): Promise<ProjectWikiSyncResult> {
    const memory = await this.requireProjectMemory(repoPath)
    const wiki = await this.storage.read(memory.repository)

    if (!wiki) {
      throw new BranchPilotUserError('project_wiki_missing', 'Generate or pull Project Wiki before pushing it to GitHub Wiki.')
    }

    const storedWiki = await this.storage.write({ ...wiki, repository: memory.repository })
    const remoteUrl = githubWikiRemoteUrl(memory.repository)
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'branchpilot-github-wiki-'))
    let cloned = false

    try {
      try {
        await this.runGit(['clone', '--depth', '1', '--', remoteUrl, tempDir], undefined, 90_000)
        cloned = true
      } catch {
        await fs.rm(tempDir, { recursive: true, force: true })
        await fs.mkdir(tempDir, { recursive: true })
        await this.runGit(['init'], tempDir)
        await this.runGit(['remote', 'add', 'origin', remoteUrl], tempDir)
      }

      await writeMarkdownPagesToDirectory(storedWiki.pages, tempDir, true)
      await this.runGit(['add', '--all'], tempDir)
      const status = await this.runGit(['status', '--porcelain'], tempDir)

      if (!status.stdout.trim()) {
        return {
          wiki: storedWiki,
          pageCount: storedWiki.pages.length,
          remoteUrl,
          message: 'GitHub Wiki already matches local Project Wiki.'
        }
      }

      await ensureGitIdentity(this.commandRunner, tempDir)
      await this.runGit(['commit', '-m', 'Update Project Wiki from BranchPilot'], tempDir)
      await this.runGit(['push', 'origin', 'HEAD:master'], tempDir, 90_000)
      const commit = await this.runGit(['rev-parse', '--short', 'HEAD'], tempDir)

      return {
        wiki: storedWiki,
        pageCount: storedWiki.pages.length,
        remoteUrl,
        commitSha: commit.stdout.trim() || undefined,
        message: cloned
          ? `Pushed ${storedWiki.pages.length} Project Wiki pages to GitHub Wiki.`
          : `Created GitHub Wiki and pushed ${storedWiki.pages.length} pages.`
      }
    } catch (error) {
      if (error instanceof BranchPilotUserError) {
        throw error
      }

      throw new BranchPilotUserError(
        'github_wiki_push_failed',
        'Unable to push Project Wiki pages to GitHub Wiki.',
        errorMessage(error)
      )
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true })
    }
  }

  private async requireProjectMemory(repoPath: string): Promise<ProjectMemorySnapshot> {
    const memory = await this.projectMemoryService.getProjectMemory(normalizeRepoPath(repoPath))

    if (!memory) {
      throw new BranchPilotUserError('project_memory_missing', 'Scan Project Memory before working with Project Wiki.')
    }

    return memory
  }

  private runGit(args: string[], cwd?: string, timeoutMs = 30_000) {
    return this.commandRunner.run(GIT_EXECUTABLE, args, {
      cwd,
      timeoutMs,
      maxOutputBytes: 24_000
    })
  }
}

function normalizeRepoPath(repoPath: string): string {
  const normalized = repoPath.trim()

  if (!normalized) {
    throw new BranchPilotUserError('invalid_repository_path', 'Repository path is required.')
  }

  return normalized
}
