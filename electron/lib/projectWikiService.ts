import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type {
  ActivityLogEntry,
  ProjectMemoryFile,
  ProjectMemoryRepository,
  ProjectMemorySnapshot,
  ProjectMemorySymbol,
  ProjectWikiGenerationResult,
  ProjectWikiPage,
  ProjectWikiPageId,
  ProjectWikiPageUpdateRequest,
  ProjectWikiSyncResult,
  ProjectWikiSnapshot
} from '../../src/shared/branchPilot.js'
import type { ActivityLogService } from './activityLogService.js'
import type { CommandRunner } from './commandRunner.js'
import { BranchPilotUserError } from './errors.js'
import type { ProjectMemoryService } from './projectMemoryService.js'
import { GIT_EXECUTABLE, normalizeNativePath } from './platformExecutables.js'

const WIKI_VERSION = 1
const ACTIVITY_LIMIT = 80
const MAX_LIST_ITEMS = 20
const IMPORTANT_SYMBOL_KINDS = new Set(['class', 'component', 'function', 'interface', 'type'])
const COMPLETED_WORK_ACTIVITY_TYPES = new Set<ActivityLogEntry['type']>([
  'github_pr_created',
  'daily_review_generated',
  'assistant_linkedin_generated',
  'merge_continued',
  'patch_applied',
  'branch_published'
])

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

    if (wiki.repository.id !== memory.repository.id || wiki.repository.rootPath !== memory.repository.rootPath) {
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

function buildWikiPages(snapshot: ProjectMemorySnapshot, activity: ActivityLogEntry[]): ProjectWikiPage[] {
  return [
    createPage('overview', 'Overview', 'Repository identity, stack, and indexed context.', overviewMarkdown(snapshot)),
    createPage('module_map', 'Module Map', 'Main directories and indexed file distribution.', moduleMapMarkdown(snapshot)),
    createPage('folder_structure', 'Folder Structure', 'What belongs in each meaningful folder.', folderStructureMarkdown(snapshot)),
    createPage('technology_map', 'Technology Map', 'Frameworks, runtimes, configs, and entrypoints.', technologyMapMarkdown(snapshot)),
    createPage('important_symbols', 'Important Symbols', 'High-signal symbols from the Project Memory index.', importantSymbolsMarkdown(snapshot)),
    createPage('workflows', 'Workflows', 'Product workflows inferred from files, symbols, and recent BranchPilot activity.', workflowsMarkdown(snapshot, activity)),
    createPage('assistant_policy', 'Assistant Policy', 'Local assistant and MCP safety policy for the project.', assistantPolicyMarkdown(snapshot)),
    createPage('recent_timeline', 'Recent Timeline', 'Recent commits and local BranchPilot activity.', recentTimelineMarkdown(snapshot, activity))
  ]
}

function overviewMarkdown(snapshot: ProjectMemorySnapshot): string {
  const rootDirectories = summarizeDirectories(snapshot.files, 1).slice(0, 12)
  const entrypoints = findEntrypoints(snapshot.files).slice(0, 8)
  const externalImports = summarizeExternalImports(snapshot).slice(0, 10)
  const lines = [
    `# ${snapshot.repository.name} Overview`,
    '',
    `Repository: ${snapshot.repository.rootPath}`,
    `Branch: ${snapshot.repository.currentBranch}`,
    `Remote: ${snapshot.repository.remoteName ? `${snapshot.repository.remoteName} (${snapshot.repository.remoteUrl ?? 'no url'})` : 'none'}`,
    `Project Memory scanned: ${formatDate(snapshot.scannedAt)}`,
    '',
    '## Index Counts',
    `- Files: ${snapshot.files.length}`,
    `- Symbols: ${snapshot.symbols.length}`,
    `- Imports: ${snapshot.imports.length}`,
    `- Recent commits: ${snapshot.recentCommits.length}`,
    '',
    '## Stack Hints'
  ]

  lines.push(...listOrEmpty(snapshot.stackHints.map((hint) => `${hint.label} from ${hint.source}`)))
  lines.push(
    '',
    '## High-Signal Folders',
    ...listOrEmpty(rootDirectories.map((entry) =>
      `${entry.name}: ${moduleRole(entry.name)} (${entry.files} files, ${entry.symbols} symbols)`
    )),
    '',
    '## Entrypoints',
    ...listOrEmpty(entrypoints.map((file) => `${file.path} (${file.language ?? file.extension})`)),
    '',
    '## Frequent External Imports',
    ...listOrEmpty(externalImports.map((entry) => `${entry.name}: ${entry.count} imports`))
  )

  return lines.join('\n')
}

function moduleMapMarkdown(snapshot: ProjectMemorySnapshot): string {
  const rootDirectories = summarizeDirectories(snapshot.files, 1)
  const modules = summarizeDirectories(snapshot.files, 2)
    .filter((entry) => entry.name !== '.')
    .slice(0, 28)
  const languages = summarizeLanguages(snapshot.files)
  const externalImports = summarizeExternalImports(snapshot)
  const entrypoints = findEntrypoints(snapshot.files)
  const configFiles = findConfigFiles(snapshot.files)
  const largestFiles = [...snapshot.files]
    .sort((left, right) => right.sizeBytes - left.sizeBytes)
    .slice(0, 10)

  return [
    '# Module Map',
    '',
    'This page is the main orientation map for Codex. Start here before opening raw files.',
    '',
    '## Technology Signals',
    ...listOrEmpty([
      ...snapshot.stackHints.map((hint) => `${hint.label} from ${hint.source}`),
      ...languages.slice(0, 10).map((entry) => `${entry.name}: ${entry.files} indexed files`),
      ...externalImports.slice(0, 12).map((entry) => `${entry.name}: imported ${entry.count} times`)
    ]),
    '',
    '## Root Folders',
    ...listOrEmpty(rootDirectories.map((entry) =>
      `${entry.name}: ${entry.files} files, ${entry.symbols} symbols, ${entry.imports} imports - ${moduleRole(entry.name)}`
    )),
    '',
    '## Module Details',
    ...(modules.length > 0 ? modules.flatMap((entry) => moduleDetailLines(snapshot, entry)) : ['- No indexed module folders available.']),
    '',
    '## Entrypoints',
    ...listOrEmpty(entrypoints.map((file) => `${file.path} (${file.language ?? file.extension}, ${file.symbolCount} symbols)`)),
    '',
    '## Configuration And Tooling',
    ...listOrEmpty(configFiles.map((file) => `${file.path} (${formatBytes(file.sizeBytes)})`)),
    '',
    '## Largest Indexed Files',
    ...listOrEmpty(largestFiles.map((file) => `${file.path} (${formatBytes(file.sizeBytes)}, ${file.symbolCount} symbols)`))
  ].join('\n')
}

function folderStructureMarkdown(snapshot: ProjectMemorySnapshot): string {
  const rootDirectories = summarizeDirectories(snapshot.files, 1)
  const secondLevelDirectories = summarizeDirectories(snapshot.files, 2)
    .filter((entry) => entry.name !== '.')
    .slice(0, 36)

  return [
    '# Folder Structure',
    '',
    'Use this page to decide where code belongs before editing.',
    '',
    '## Top-Level Folders',
    ...listOrEmpty(rootDirectories.map((entry) =>
      `${entry.name}: ${folderPurpose(entry.name)} (${entry.files} files, ${entry.symbols} symbols, ${formatBytes(entry.sizeBytes)} indexed)`
    )),
    '',
    '## Second-Level Modules',
    ...listOrEmpty(secondLevelDirectories.map((entry) =>
      `${entry.name}: ${folderPurpose(entry.name)}; inspect nearby entrypoints and exported symbols before changing it.`
    )),
    '',
    '## Low-Signal Paths',
    ...listOrEmpty(rootDirectories
      .filter((entry) => isLowSignalPath(entry.name))
      .map((entry) => `${entry.name}: generated, dependency, cache, build, or metadata path; avoid reading unless the task specifically needs it.`))
  ].join('\n')
}

function technologyMapMarkdown(snapshot: ProjectMemorySnapshot): string {
  const languages = summarizeLanguages(snapshot.files)
  const externalImports = summarizeExternalImports(snapshot)
  const entrypoints = findEntrypoints(snapshot.files)
  const configFiles = findConfigFiles(snapshot.files)

  return [
    '# Technology Map',
    '',
    'Technology signals are inferred from Project Memory files, imports, and config names.',
    '',
    '## Stack Hints',
    ...listOrEmpty(snapshot.stackHints.map((hint) => `${hint.label}: detected from ${hint.source}`)),
    '',
    '## Languages And File Types',
    ...listOrEmpty(languages.slice(0, 14).map((entry) => `${entry.name}: ${entry.files} indexed files`)),
    '',
    '## External Packages',
    ...listOrEmpty(externalImports.slice(0, 18).map((entry) => `${entry.name}: ${entry.count} imports`)),
    '',
    '## Runtime And Build Entrypoints',
    ...listOrEmpty(entrypoints.map((file) => `${file.path}: ${file.language ?? file.extension}, ${file.symbolCount} symbols, ${file.importCount} imports`)),
    '',
    '## Configuration Files',
    ...listOrEmpty(configFiles.map((file) => `${file.path}: ${formatBytes(file.sizeBytes)}`))
  ].join('\n')
}

function importantSymbolsMarkdown(snapshot: ProjectMemorySnapshot): string {
  const symbols = [...snapshot.symbols]
    .filter((symbol) => IMPORTANT_SYMBOL_KINDS.has(symbol.kind))
    .sort(compareSymbolsForImportance)
    .slice(0, MAX_LIST_ITEMS)

  return [
    '# Important Symbols',
    '',
    ...listOrEmpty(symbols.map((symbol) =>
      `${symbolLabel(symbol)} - ${symbol.kind}, ${symbol.path}:${symbol.line}${symbol.exported ? ', exported' : ''}`
    ))
  ].join('\n')
}

function workflowsMarkdown(snapshot: ProjectMemorySnapshot, activity: ActivityLogEntry[]): string {
  const activityTypes = new Set(activity.map((entry) => entry.type))
  const paths = snapshot.files.map((file) => file.path.toLowerCase())
  const workflows = [
    {
      title: 'Local Git Core',
      detected: paths.some((filePath) => filePath.includes('repositoryservice') || filePath.includes('gitstatus')) ||
        activityTypes.has('commit_created') ||
        activityTypes.has('branch_switched')
    },
    {
      title: 'Pull Requests',
      detected: paths.some((filePath) => filePath.includes('githubcli') || filePath.includes('provider')) ||
        activityTypes.has('github_pr_created')
    },
    {
      title: 'Merge And Conflict Resolution',
      detected: activityTypes.has('merge_started') ||
        activityTypes.has('rebase_started') ||
        activityTypes.has('merge_resolved') ||
        paths.some((filePath) => filePath.includes('merge'))
    },
    {
      title: 'Stash Workflow',
      detected: activityTypes.has('stash_created') || paths.some((filePath) => filePath.includes('stash'))
    },
    {
      title: 'Assistant Review',
      detected: paths.some((filePath) => filePath.includes('assistant')) ||
        activityTypes.has('assistant_review_generated')
    },
    {
      title: 'Daily Review',
      detected: paths.some((filePath) => filePath.includes('dailyreview')) ||
        activityTypes.has('daily_review_generated')
    },
    {
      title: 'LinkedIn Project Drafts',
      detected: activityTypes.has('assistant_linkedin_generated')
    }
  ]

  return [
    '# Workflows',
    '',
    ...workflows.map((workflow) => `- ${workflow.detected ? 'Detected' : 'Planned'}: ${workflow.title}`)
  ].join('\n')
}

function assistantPolicyMarkdown(snapshot: ProjectMemorySnapshot): string {
  return [
    '# Assistant Policy',
    '',
    '- Default behavior is suggest-only.',
    '- Commit, pull request, LinkedIn project drafts, review, daily review, Project Memory, and Project Wiki content are generated locally.',
    '- MCP access is read-only and intended for context retrieval.',
    '- MCP must not write files, run commands, mutate Git state, or store credentials.',
    '- Destructive Git operations require explicit user confirmation in BranchPilot.',
    '',
    '## Current Context',
    `- Repository: ${snapshot.repository.name}`,
    `- Project Memory scanned: ${formatDate(snapshot.scannedAt)}`
  ].join('\n')
}

function recentTimelineMarkdown(snapshot: ProjectMemorySnapshot, activity: ActivityLogEntry[]): string {
  const completedActivity = activity.filter((entry) => entry.status === 'success' && COMPLETED_WORK_ACTIVITY_TYPES.has(entry.type))
  const completedWork = [
    ...snapshot.recentCommits.slice(0, 15).map((commit) =>
      `${formatDate(commit.authoredAt)} - Commit ${commit.shortSha}: ${commit.subject || '(no subject)'}`
    ),
    ...completedActivity.slice(0, 10).map((entry) =>
      `${formatDate(entry.createdAt)} - ${activityTypeLabel(entry.type)} (${entry.status})`
    )
  ]

  return [
    '# Recent Timeline',
    '',
    '## Completed Work',
    ...listOrEmpty(completedWork),
    '',
    '## Recent Technical Activity',
    ...listOrEmpty(activity.slice(0, 12).map((entry) =>
      `${formatDate(entry.createdAt)} - ${activityTypeLabel(entry.type)} (${entry.status})`
    ))
  ].join('\n')
}

function summarizeDirectories(files: ProjectMemoryFile[], depth = 1) {
  const directories = new Map<string, { name: string; files: number; symbols: number; imports: number; sizeBytes: number }>()

  for (const file of files) {
    const directory = directoryKey(file.path, depth)
    const entry = directories.get(directory) ?? { name: directory, files: 0, symbols: 0, imports: 0, sizeBytes: 0 }
    entry.files += 1
    entry.symbols += file.symbolCount
    entry.imports += file.importCount
    entry.sizeBytes += file.sizeBytes
    directories.set(directory, entry)
  }

  return [...directories.values()]
    .sort((left, right) => right.files - left.files || right.symbols - left.symbols || left.name.localeCompare(right.name))
    .slice(0, MAX_LIST_ITEMS)
}

function directoryKey(filePath: string, depth: number): string {
  if (!filePath.includes('/')) {
    return '.'
  }

  const parts = filePath.split('/').filter(Boolean)

  return parts.slice(0, Math.min(depth, parts.length - 1)).join('/') || '.'
}

function moduleDetailLines(
  snapshot: ProjectMemorySnapshot,
  module: { name: string; files: number; symbols: number; imports: number; sizeBytes: number }
): string[] {
  const files = snapshot.files
    .filter((file) => file.path === module.name || file.path.startsWith(`${module.name}/`))
    .sort((left, right) => scoreFileForModule(right) - scoreFileForModule(left) || left.path.localeCompare(right.path))
  const symbols = snapshot.symbols
    .filter((symbol) => symbol.path.startsWith(`${module.name}/`))
    .sort(compareSymbolsForImportance)
    .slice(0, 6)
  const imports = summarizeModuleImports(snapshot, module.name).slice(0, 6)
  const languages = summarizeLanguages(files).slice(0, 4)
  const keyFiles = files.slice(0, 6)

  return [
    `### ${module.name}`,
    `- Role: ${moduleRole(module.name)}`,
    `- Scale: ${module.files} files, ${module.symbols} symbols, ${module.imports} imports, ${formatBytes(module.sizeBytes)} indexed.`,
    `- Languages: ${languages.length > 0 ? languages.map((entry) => `${entry.name} (${entry.files})`).join(', ') : 'unknown'}.`,
    `- Key files: ${keyFiles.length > 0 ? keyFiles.map((file) => file.path).join(', ') : 'none indexed'}.`,
    `- Key symbols: ${symbols.length > 0 ? symbols.map(symbolLabel).join(', ') : 'none detected'}.`,
    `- External imports: ${imports.length > 0 ? imports.map((entry) => `${entry.name} (${entry.count})`).join(', ') : 'none detected'}.`,
    ''
  ]
}

function scoreFileForModule(file: ProjectMemoryFile): number {
  const pathScore = /(^|\/)(index|main|app|layout|route|server|service|controller|provider|config|vite|package)\./i.test(file.path) ? 20 : 0

  return pathScore + file.symbolCount * 3 + file.importCount + Math.min(file.sizeBytes / 2048, 10)
}

function summarizeModuleImports(snapshot: ProjectMemorySnapshot, moduleName: string) {
  const counts = new Map<string, number>()

  for (const entry of snapshot.imports) {
    if (!entry.path.startsWith(`${moduleName}/`) || isLocalImport(entry.source)) continue
    counts.set(entry.source, (counts.get(entry.source) ?? 0) + 1)
  }

  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name))
}

function summarizeExternalImports(snapshot: ProjectMemorySnapshot) {
  const counts = new Map<string, number>()

  for (const entry of snapshot.imports) {
    if (isLocalImport(entry.source)) continue
    const name = externalPackageName(entry.source)
    counts.set(name, (counts.get(name) ?? 0) + 1)
  }

  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name))
}

function isLocalImport(source: string): boolean {
  return source.startsWith('.') || source.startsWith('/') || source.startsWith('@/') || source.startsWith('~/')
}

function externalPackageName(source: string): string {
  if (source.startsWith('@')) {
    return source.split('/').slice(0, 2).join('/')
  }

  return source.split('/')[0] || source
}

function findEntrypoints(files: ProjectMemoryFile[]) {
  return files
    .filter((file) => /(^|\/)(main|index|app|layout|route|server|preload|renderer)\.(tsx?|jsx?|mjs|cjs)$/.test(file.path))
    .sort((left, right) => scoreFileForModule(right) - scoreFileForModule(left) || left.path.localeCompare(right.path))
    .slice(0, 16)
}

function findConfigFiles(files: ProjectMemoryFile[]) {
  return files
    .filter((file) =>
      /(^|\/)(package|tsconfig|vite|electron-builder|eslint|prettier|tailwind|postcss|wrangler|next|nuxt|astro|svelte|jest|vitest|playwright|docker|compose|cargo|pyproject|requirements|go\.mod|pom|gradle)/i.test(file.path) ||
      /\.(config|rc)\.(js|ts|mjs|cjs|json|yaml|yml)$/i.test(file.path)
    )
    .sort((left, right) => left.path.localeCompare(right.path))
    .slice(0, 24)
}

function moduleRole(moduleName: string): string {
  const normalized = moduleName.toLowerCase()

  if (/(^|\/)(app|pages|routes|screens)(\/|$)/.test(normalized)) return 'application routes and user-facing screens'
  if (/(^|\/)(components|ui|widgets)(\/|$)/.test(normalized)) return 'reusable UI components and view primitives'
  if (/(^|\/)(hooks|stores|state)(\/|$)/.test(normalized)) return 'frontend state, hooks, and view orchestration'
  if (/(^|\/)(services|service|lib|core|domain)(\/|$)/.test(normalized)) return 'domain services, shared logic, and integration helpers'
  if (/(^|\/)(electron|main|preload)(\/|$)/.test(normalized)) return 'desktop runtime, IPC, filesystem, and native shell integration'
  if (/(^|\/)(api|server|backend|worker|workers|functions)(\/|$)/.test(normalized)) return 'server/API runtime and external service boundary'
  if (/(^|\/)(providers|integrations|adapters)(\/|$)/.test(normalized)) return 'provider adapters and external integrations'
  if (/(^|\/)(styles|css|theme|themes)(\/|$)/.test(normalized)) return 'visual system, themes, and presentation styling'
  if (/(^|\/)(test|tests|spec|__tests__)(\/|$)/.test(normalized)) return 'test coverage and verification fixtures'
  if (/(^|\/)(docs|doc|wiki|md)(\/|$)/.test(normalized)) return 'project documentation and local knowledge base'
  if (/(^|\/)(scripts|tools|bin)(\/|$)/.test(normalized)) return 'developer automation and maintenance scripts'
  if (/(^|\/)(config|configs|\.github)(\/|$)/.test(normalized)) return 'configuration, CI, and repository metadata'

  return 'project module; inspect key files and symbols before editing'
}

function folderPurpose(folderName: string): string {
  return isLowSignalPath(folderName)
    ? 'low-signal generated, dependency, cache, build, or repository metadata path'
    : moduleRole(folderName)
}

function isLowSignalPath(folderName: string): boolean {
  const normalized = folderName.toLowerCase()

  return /(^|\/)(node_modules|dist|build|coverage|out|tmp|temp|cache|\.cache|\.git|\.next|\.turbo|\.vite|vendor)(\/|$)/.test(normalized)
}

function summarizeLanguages(files: ProjectMemoryFile[]) {
  const languages = new Map<string, { name: string; files: number }>()

  for (const file of files) {
    const language = file.language ?? file.extension ?? 'unknown'
    const entry = languages.get(language) ?? { name: language, files: 0 }
    entry.files += 1
    languages.set(language, entry)
  }

  return [...languages.values()]
    .sort((left, right) => right.files - left.files || left.name.localeCompare(right.name))
    .slice(0, MAX_LIST_ITEMS)
}

function compareSymbolsForImportance(left: ProjectMemorySymbol, right: ProjectMemorySymbol): number {
  const kindScore = scoreSymbolKind(right.kind) - scoreSymbolKind(left.kind)

  if (kindScore !== 0) {
    return kindScore
  }

  if (left.exported !== right.exported) {
    return left.exported ? -1 : 1
  }

  return left.path.localeCompare(right.path) || left.line - right.line
}

function scoreSymbolKind(kind: ProjectMemorySymbol['kind']): number {
  if (kind === 'class' || kind === 'component') return 4
  if (kind === 'interface' || kind === 'type') return 3
  if (kind === 'function') return 2
  return 1
}

const WIKI_PAGE_FILE_NAMES: Record<string, string> = {
  overview: 'Home.md',
  module_map: 'Module-Map.md',
  folder_structure: 'Folder-Structure.md',
  technology_map: 'Technology-Map.md',
  important_symbols: 'Important-Symbols.md',
  workflows: 'Workflows.md',
  assistant_policy: 'Assistant-Policy.md',
  recent_timeline: 'Recent-Timeline.md'
}

async function writeMarkdownPagesToDirectory(
  pages: ProjectWikiPage[],
  directoryPath: string,
  replaceExistingMarkdown: boolean
): Promise<void> {
  await fs.mkdir(directoryPath, { recursive: true })

  if (replaceExistingMarkdown) {
    const existingEntries = await fs.readdir(directoryPath, { withFileTypes: true }).catch(() => [])

    await Promise.all(existingEntries
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.md'))
      .map((entry) => fs.rm(path.join(directoryPath, entry.name), { force: true }))
    )
  }

  const usedFileNames = new Set<string>()

  for (const page of pages) {
    const fileName = uniqueWikiFileName(page, usedFileNames)
    await fs.writeFile(path.join(directoryPath, fileName), page.markdown.endsWith('\n') ? page.markdown : `${page.markdown}\n`, 'utf8')
  }
}

async function readMarkdownPages(directoryPath: string): Promise<ProjectWikiPage[]> {
  const entries = await fs.readdir(directoryPath, { withFileTypes: true })
  const markdownFiles = entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.md'))
    .map((entry) => entry.name)
    .sort(compareWikiFileNames)

  const pages: ProjectWikiPage[] = []

  for (const fileName of markdownFiles) {
    const markdown = await fs.readFile(path.join(directoryPath, fileName), 'utf8')
    const title = titleFromMarkdown(markdown) ?? titleFromFileName(fileName)

    pages.push({
      id: pageIdFromFileName(fileName),
      title,
      summary: summarizeMarkdown(markdown),
      markdown
    })
  }

  return pages
}

function uniqueWikiFileName(page: ProjectWikiPage, usedFileNames: Set<string>): string {
  const preferredFileName = WIKI_PAGE_FILE_NAMES[page.id] ?? `${sanitizeWikiFileName(page.title || page.id)}.md`
  const extension = path.extname(preferredFileName) || '.md'
  const baseName = preferredFileName.slice(0, preferredFileName.length - extension.length)
  let candidate = preferredFileName
  let suffix = 2

  while (usedFileNames.has(candidate.toLowerCase())) {
    candidate = `${baseName}-${suffix}${extension}`
    suffix += 1
  }

  usedFileNames.add(candidate.toLowerCase())

  return candidate
}

function compareWikiFileNames(left: string, right: string): number {
  if (left.toLowerCase() === 'home.md') return -1
  if (right.toLowerCase() === 'home.md') return 1

  return left.localeCompare(right)
}

function pageIdFromFileName(fileName: string): ProjectWikiPageId {
  const baseName = fileName.replace(/\.md$/i, '')

  if (/^(home|readme)$/i.test(baseName)) {
    return 'overview'
  }

  return baseName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'wiki_page'
}

function titleFromFileName(fileName: string): string {
  const baseName = fileName.replace(/\.md$/i, '')

  if (/^home$/i.test(baseName)) {
    return 'Overview'
  }

  return baseName
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (match) => match.toUpperCase())
}

function titleFromPageId(pageId: ProjectWikiPageId): string {
  return pageId
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (match) => match.toUpperCase())
}

function titleFromMarkdown(markdown: string): string | null {
  const heading = markdown
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.startsWith('# '))

  return heading?.replace(/^#\s+/, '').trim() || null
}

function summarizeMarkdown(markdown: string): string {
  const line = markdown
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .find((entry) => entry && !entry.startsWith('#') && !entry.startsWith('```'))

  if (!line) {
    return 'Markdown wiki page.'
  }

  return stripMarkdown(line).slice(0, 140)
}

function stripMarkdown(value: string): string {
  return value
    .replace(/[`*_~[\]]/g, '')
    .replace(/\(([^)]+)\)/g, '$1')
    .replace(/^[-*]\s+/, '')
    .trim()
}

function sanitizeWikiFileName(value: string): string {
  const sanitized = value
    .trim()
    .replace(/\.md$/i, '')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')

  return sanitized || 'Wiki-Page'
}

function githubWikiRemoteUrl(repository: ProjectMemoryRepository): string {
  const remoteUrl = repository.remoteUrl?.trim()

  if (!remoteUrl) {
    throw new BranchPilotUserError('github_wiki_no_remote', 'GitHub Wiki sync requires a GitHub remote URL.')
  }

  const sshMatch = remoteUrl.match(/^git@([^:]+):(.+?)(?:\.git)?$/i)

  if (sshMatch) {
    const host = sshMatch[1]
    const repoPath = sshMatch[2].replace(/\/+$/, '').replace(/\.wiki$/i, '')

    if (!isGitHubHost(host)) {
      throw new BranchPilotUserError('github_wiki_unsupported_remote', 'GitHub Wiki sync only supports GitHub remotes.')
    }

    return `git@${host}:${repoPath}.wiki.git`
  }

  try {
    const parsed = new URL(remoteUrl)

    if (!isGitHubHost(parsed.host)) {
      throw new BranchPilotUserError('github_wiki_unsupported_remote', 'GitHub Wiki sync only supports GitHub remotes.')
    }

    const repoPath = parsed.pathname.replace(/^\/+/, '').replace(/\.git$/i, '').replace(/\/+$/, '').replace(/\.wiki$/i, '')

    if (!repoPath.includes('/')) {
      throw new BranchPilotUserError('github_wiki_unsupported_remote', 'GitHub remote URL does not include owner and repository.')
    }

    return `${parsed.protocol}//${parsed.host}/${repoPath}.wiki.git`
  } catch (error) {
    if (error instanceof BranchPilotUserError) {
      throw error
    }

    throw new BranchPilotUserError('github_wiki_unsupported_remote', 'GitHub Wiki sync requires an HTTPS or SSH GitHub remote URL.')
  }
}

function isGitHubHost(host: string): boolean {
  return host.toLowerCase() === 'github.com'
}

async function ensureGitIdentity(commandRunner: CommandRunner, cwd: string): Promise<void> {
  const userName = await readGitConfig(commandRunner, cwd, 'user.name')
  const userEmail = await readGitConfig(commandRunner, cwd, 'user.email')

  if (!userName) {
    await commandRunner.run(GIT_EXECUTABLE, ['config', 'user.name', 'BranchPilot'], { cwd })
  }

  if (!userEmail) {
    await commandRunner.run(GIT_EXECUTABLE, ['config', 'user.email', 'branchpilot@local'], { cwd })
  }
}

async function readGitConfig(commandRunner: CommandRunner, cwd: string, key: string): Promise<string> {
  const result = await commandRunner.run(GIT_EXECUTABLE, ['config', '--get', key], {
    cwd,
    allowedExitCodes: [0, 1],
    maxOutputBytes: 4000
  })

  return result.stdout.trim()
}

function errorMessage(error: unknown): string {
  const result = (error as { result?: { stderr?: string; stdout?: string } })?.result
  const details = [result?.stderr, result?.stdout, error instanceof Error ? error.message : String(error)]
    .filter(Boolean)
    .join('\n')

  return details || 'Unknown error'
}

function createPage(id: ProjectWikiPageId, title: string, summary: string, markdown: string): ProjectWikiPage {
  return {
    id,
    title,
    summary,
    markdown
  }
}

function listOrEmpty(items: string[]): string[] {
  return items.length > 0 ? items.map((item) => `- ${item}`) : ['- No indexed data available.']
}

function symbolLabel(symbol: ProjectMemorySymbol): string {
  return symbol.parentName ? `${symbol.parentName}.${symbol.name}` : symbol.name
}

function normalizeRepoPath(repoPath: string): string {
  const normalized = repoPath.trim()

  if (!normalized) {
    throw new BranchPilotUserError('invalid_repository_path', 'Repository path is required.')
  }

  return normalized
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(value))
}

function formatBytes(sizeBytes: number): string {
  if (sizeBytes < 1024) return `${sizeBytes} B`
  if (sizeBytes < 1024 * 1024) return `${Math.round(sizeBytes / 1024)} KB`
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`
}

function activityTypeLabel(type: ActivityLogEntry['type']): string {
  return type
    .split('_')
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(' ')
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
