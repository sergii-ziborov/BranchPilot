import path from 'node:path'
import fs from 'node:fs/promises'
import os from 'node:os'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const { app, BrowserWindow, dialog } = require('electron') as typeof import('electron')
// ESM module: `__dirname` is not defined, so derive it from the module URL.
const moduleDir = path.dirname(fileURLToPath(import.meta.url))
import type {
  ActivityLogQuery,
  AssistantPolicyUpdate,
  ChromeThemeRequest,
  CloneRepositoryRequest,
  CommitDetailsRequest,
  CommitSearchTextRequest,
  CommitFileCompareRequest,
  CommitFileContentRequest,
  CommitFileDiffRequest,
  CssColorEditRequest,
  DailyReviewRequest,
  DiffContextRequest,
  DiffRequest,
  ImagePreviewRequest,
  ProjectWikiPageUpdateRequest,
  ProjectMemoryScanResult,
  RepositoryBrowserRequest,
  RepositoryBrowserSnapshot,
  RepositoryFileBytesWriteRequest,
  RepositoryFileChunkRequest,
  RepositoryFileChunkWriteRequest,
  RepositoryFileDeleteRequest,
  RepositoryFileContentRequest,
  RepositoryFileRenameRequest,
  RepositoryFileWriteRequest,
  RepositorySearchRequest,
  RepositoryPinRequest
} from '../../../src/shared/branchPilot.js'
import { createProjectMemoryMcpConfig } from '../../mcp/config.js'
import { withProjectMemoryRefresh } from '../ipcTypes.js'
import type { createIpcHelpers } from '../ipcHelpers.js'
import type { RegisterIpcHandlersServices } from '../ipcTypes.js'
import { detectRepositoryBrowserTech } from '../../lib/repositoryBrowserTech.js'

function normalizeChromeThemeColor(value: string | undefined, fallback: string): string {
  const color = value?.trim()

  return color && /^(#[\da-f]{3,8}|rgba?\([^)]+\)|color\([^)]+\))$/i.test(color)
    ? color
    : fallback
}

export function registerRepositoryHandlers(
  helpers: ReturnType<typeof createIpcHelpers>,
  services: RegisterIpcHandlersServices
) {
  const { handle, handleLogged, handleUnwrapped, repoPathArg, requestRepoPath, snapshotRepoPath, chooseCloneParentPath } = helpers
  const { repositoryService, assistantPolicyService, activityLogService, projectMemoryService, projectWikiService, dailyReviewService, projectMemoryDir, projectWikiDir, activityLogDir } = services

  handleUnwrapped('app:version', () => app.getVersion())
  handleUnwrapped('app:setChromeTheme', (request: ChromeThemeRequest) => {
    const window = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed())

    if (!window || process.platform === 'darwin') {
      return
    }

    window.setTitleBarOverlay({
      color: normalizeChromeThemeColor(request.backgroundColor, '#f8fafc'),
      symbolColor: normalizeChromeThemeColor(request.symbolColor, '#0f172a'),
      height: 32
    })
  })

  handleLogged('repository:chooseAndOpen', {
    type: 'repository_opened',
    actor: 'user',
    title: 'Repository opened',
    repoPath: snapshotRepoPath,
    metadata: (_args, snapshot) => snapshot ? {
      repository: snapshot.summary.name,
      branch: snapshot.summary.currentBranch,
      remote: snapshot.summary.remoteName ?? 'none'
    } : undefined
  }, async () => {
    const result = await dialog.showOpenDialog({
      title: 'Open repository',
      properties: ['openDirectory']
    })

    if (result.canceled || result.filePaths.length === 0) {
      return null
    }

    return withProjectMemoryRefresh(await repositoryService.openRepository(result.filePaths[0]))
  })

  handleLogged('repository:clone', {
    type: 'repository_cloned',
    actor: 'user',
    title: 'Repository cloned',
    repoPath: snapshotRepoPath,
    metadata: ([request], snapshot) => ({
      repository: snapshot?.summary.name ?? request.targetName ?? 'repository',
      target_parent: request.targetParentPath ? path.basename(request.targetParentPath) : 'selected'
    })
  }, async (request: CloneRepositoryRequest) => {
    const targetParentPath = request.targetParentPath ?? await chooseCloneParentPath()

    if (!targetParentPath) {
      return null
    }

    return withProjectMemoryRefresh(await repositoryService.cloneRepository({
      ...request,
      targetParentPath
    }))
  })

  handleLogged('repository:open', {
    type: 'repository_opened',
    actor: 'user',
    title: 'Repository opened',
    repoPath: (args, snapshot) => snapshotRepoPath(args, snapshot) ?? args[0],
    metadata: (_args, snapshot) => snapshot ? {
      repository: snapshot.summary.name,
      branch: snapshot.summary.currentBranch,
      remote: snapshot.summary.remoteName ?? 'none'
    } : undefined
  }, async (repoPath: string) =>
    withProjectMemoryRefresh(await repositoryService.openRepository(repoPath))
  )
  handleLogged('repository:init', {
    type: 'repository_opened',
    actor: 'user',
    title: 'Repository initialized',
    repoPath: (args, snapshot) => snapshotRepoPath(args, snapshot) ?? args[0],
    metadata: (_args, snapshot) => snapshot ? {
      repository: snapshot.summary.name,
      branch: snapshot.summary.currentBranch,
      remote: snapshot.summary.remoteName ?? 'none'
    } : undefined
  }, async (repoPath: string) =>
    withProjectMemoryRefresh(await repositoryService.initializeRepository(repoPath))
  )
  handle('repository:recent', () => repositoryService.getRecentRepositories())
  handle('repository:browseDirectory', (request?: RepositoryBrowserRequest) => browseRepositoryDirectory(request))
  handle('repository:setPinned', (request: RepositoryPinRequest) => repositoryService.setRepositoryPinned(request))
  handle('repository:dashboard', (repoPath?: string) => repositoryService.dashboard.getRepositoryDashboard(repoPath))
  handle('repository:files', (repoPath: string) => repositoryService.listRepositoryFiles(repoPath))
  handle('repository:searchFiles', (request: RepositorySearchRequest) => repositoryService.searchRepositoryContent(request))
  handle('repository:fileContent', (request: RepositoryFileContentRequest) => repositoryService.getRepositoryFileContent(request))
  handle('repository:fileChunk', (request: RepositoryFileChunkRequest) => repositoryService.getRepositoryFileChunk(request))
  handle('repository:writeFileChunk', async (request: RepositoryFileChunkWriteRequest) =>
    withProjectMemoryRefresh(await repositoryService.writeRepositoryFileChunk(request))
  )
  handle('repository:writeFile', async (request: RepositoryFileWriteRequest) =>
    withProjectMemoryRefresh(await repositoryService.writeRepositoryFile(request))
  )
  handle('repository:fileBytes', (request: RepositoryFileContentRequest) => repositoryService.getRepositoryFileBytes(request))
  handle('repository:writeFileBytes', async (request: RepositoryFileBytesWriteRequest) =>
    withProjectMemoryRefresh(await repositoryService.writeRepositoryFileBytes(request))
  )
  handle('repository:renameFile', async (request: RepositoryFileRenameRequest) =>
    withProjectMemoryRefresh(await repositoryService.renameRepositoryFile(request))
  )
  handle('repository:deleteFile', async (request: RepositoryFileDeleteRequest) =>
    withProjectMemoryRefresh(await repositoryService.deleteRepositoryFile(request))
  )
  // A status refresh is not a meaningful user action — don't spam the activity log
  // (auto-refresh polls it, and the log feeds AI generation).
  handle('repository:refresh', (repoPath: string) => repositoryService.getSnapshot(repoPath))
  handle('repository:diff', (request: DiffRequest) => repositoryService.getDiff(request))
  handle('repository:diffContext', (request: DiffContextRequest) => repositoryService.getDiffContext(request))
  handle('repository:updateCssColor', async (request: CssColorEditRequest) =>
    withProjectMemoryRefresh(await repositoryService.updateCssColor(request))
  )
  handle('repository:imagePreview', (request: ImagePreviewRequest) => repositoryService.getImagePreview(request))
  handle('repository:contributionGraph', (request?: string | { repoPath?: string; repoPaths?: string[] }) => repositoryService.activity.getContributionGraph(request))
  handle('repository:rhythm', (repoPath?: string) => repositoryService.activity.getRepositoryRhythm(repoPath))
  handle('repository:contributorStats', (request?: string | { repoPath?: string; repoPaths?: string[]; window?: 'all' | 'year' | 'month' | 'week' | 'day'; date?: string }) =>
    repositoryService.activity.getContributorStats(request)
  )
  handle('repository:contributors', (repoPath: string) => repositoryService.activity.getContributors(repoPath))
  handle('repository:history', (repoPath: string) => repositoryService.getHistory(repoPath))
  handle('repository:commitCard', (request: CommitDetailsRequest) => repositoryService.getCommitCard(request))
  handle('repository:commitDetails', (request: CommitDetailsRequest) => repositoryService.getCommitDetails(request))
  handle('repository:commitSearchText', (request: CommitSearchTextRequest) => repositoryService.getCommitSearchText(request))
  handle('repository:commitFileDiff', (request: CommitFileDiffRequest) => repositoryService.getCommitFileDiff(request))
  handle('repository:commitFileContent', (request: CommitFileContentRequest) => repositoryService.getCommitFileContent(request))
  handle('repository:commitFileCompareDiff', (request: CommitFileCompareRequest) => repositoryService.getCommitFileCompareDiff(request))
  handle('repository:projectMemory', (repoPath: string) => projectMemoryService.getProjectMemory(repoPath))
  handle('repository:projectWiki', (repoPath: string) => projectWikiService.getProjectWiki(repoPath))
  handleLogged('repository:scanProjectMemory', {
    type: 'project_memory_scanned',
    actor: 'branchpilot',
    title: 'Project Memory scanned',
    repoPath: repoPathArg,
    metadata: (_args, result) => result ? {
      scanned_files: result.scannedFileCount,
      skipped_files: result.skippedFileCount,
      duration_ms: result.durationMs,
      symbols: result.snapshot.symbols.length
    } : undefined
  }, (repoPath: string): Promise<ProjectMemoryScanResult> =>
    projectMemoryService.scanProjectMemory(repoPath)
  )
  handleLogged('repository:generateProjectWiki', {
    type: 'project_wiki_generated',
    actor: 'branchpilot',
    title: 'Project Wiki generated',
    repoPath: repoPathArg,
    metadata: (_args, result) => result ? {
      pages: result.wiki.pages.length,
      scanned_files: result.memory.scannedFileCount,
      source_memory_scanned_at: result.wiki.sourceMemoryScannedAt
    } : undefined
  }, (repoPath: string) =>
    projectWikiService.generateProjectWiki(repoPath)
  )
  handle('repository:saveProjectWikiPage', (request: ProjectWikiPageUpdateRequest) =>
    projectWikiService.saveProjectWikiPage(request)
  )
  handle('repository:pullProjectWikiFromGitHub', (repoPath: string) =>
    projectWikiService.pullFromGitHubWiki(repoPath)
  )
  handle('repository:pushProjectWikiToGitHub', (repoPath: string) =>
    projectWikiService.pushToGitHubWiki(repoPath)
  )
  handle('repository:projectMemoryMcpConfig', (repoPath: string) =>
    createProjectMemoryMcpConfig({
      memoryDir: projectMemoryDir,
      activityDir: activityLogDir,
      wikiDir: projectWikiDir,
      repoPath,
      serverPath: path.join(moduleDir, '../../mcp/server.js')
    })
  )
  handle('assistants:getPolicy', (repoPath: string) => assistantPolicyService.getAssistantPolicy(repoPath))
  handleLogged('assistants:setPolicy', {
    type: 'assistant_policy_updated',
    actor: 'user',
    title: 'Assistant policy updated',
    repoPath: requestRepoPath,
    metadata: ([update], status) => ({
      mode: status?.settings.mode ?? update.mode
    })
  }, (update: AssistantPolicyUpdate) =>
    assistantPolicyService.setAssistantPolicy(update)
  )
  handle('activity:list', (query: ActivityLogQuery) => activityLogService.getActivityLog(query))
  handle('activity:clear', (repoPath: string, confirmed: boolean) =>
    activityLogService.clearActivityLog(repoPath, confirmed)
  )
  handleLogged('daily:generate', {
    type: 'daily_review_generated',
    actor: 'branchpilot',
    title: 'Daily review generated',
    repoPath: requestRepoPath,
    metadata: ([request], report) => ({
      date: request.date ?? report?.date ?? '',
      commits: report?.stats.commits ?? 0,
      changed: report?.stats.changed ?? 0,
      activities: report?.stats.activities ?? 0,
      actions: report?.actionItems.length ?? 0
    })
  }, (request: DailyReviewRequest) =>
    dailyReviewService.generateDailyReview(request)
  )
}

async function browseRepositoryDirectory(request?: RepositoryBrowserRequest): Promise<RepositoryBrowserSnapshot> {
  const requestedPath = request?.path?.trim()
  const targetPath = path.resolve(requestedPath || await defaultRepositoryBrowserPath())
  const stats = await fs.stat(targetPath)

  if (!stats.isDirectory()) {
    throw new Error('Selected path is not a folder.')
  }

  const dirents = await fs.readdir(targetPath, { withFileTypes: true })
  const directories = dirents.filter((entry) => entry.isDirectory())
  const entries = await Promise.all(directories.map(async (entry) => {
    const entryPath = path.join(targetPath, entry.name)
    const [gitRepository, entryStats, tech] = await Promise.all([
      isGitRepositoryDirectory(entryPath),
      fs.stat(entryPath).catch(() => undefined),
      detectRepositoryBrowserTech(entryPath).catch(() => undefined)
    ])

    return {
      name: entry.name,
      path: entryPath,
      isGitRepository: gitRepository,
      modifiedAt: entryStats?.mtime ? entryStats.mtime.toISOString() : undefined,
      tech
    }
  }))

  entries.sort((left, right) => {
    if (left.isGitRepository !== right.isGitRepository) return left.isGitRepository ? -1 : 1
    return left.name.localeCompare(right.name, undefined, { sensitivity: 'base', numeric: true })
  })

  const parentPath = path.dirname(targetPath)

  return {
    path: targetPath,
    parentPath: parentPath === targetPath ? undefined : parentPath,
    isGitRepository: await isGitRepositoryDirectory(targetPath),
    repositoryCount: entries.filter((entry) => entry.isGitRepository).length,
    entries
  }
}

async function defaultRepositoryBrowserPath(): Promise<string> {
  const preferredPath = path.join(os.homedir(), 'Documents', 'GitHub')
  const preferredStats = await fs.stat(preferredPath).catch(() => undefined)
  return preferredStats?.isDirectory() ? preferredPath : os.homedir()
}

async function isGitRepositoryDirectory(directoryPath: string): Promise<boolean> {
  const dotGitPath = path.join(directoryPath, '.git')
  const stats = await fs.stat(dotGitPath).catch(() => undefined)
  return Boolean(stats && (stats.isDirectory() || stats.isFile()))
}
