import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type {
  ActivityLogEntry,
  ProjectMemoryFile,
  ProjectMemorySnapshot,
  ProjectMemorySymbol,
  ProjectWikiGenerationResult,
  ProjectWikiPage,
  ProjectWikiPageId,
  ProjectWikiSnapshot
} from '../../src/shared/branchPilot.js'
import type { ActivityLogService } from './activityLogService.js'
import { BranchPilotUserError } from './errors.js'
import type { ProjectMemoryService } from './projectMemoryService.js'

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
    private readonly storage: ProjectWikiStore
  ) {}

  async getProjectWiki(repoPath: string): Promise<ProjectWikiSnapshot | null> {
    const memory = await this.projectMemoryService.getProjectMemory(normalizeRepoPath(repoPath))

    if (!memory) {
      return null
    }

    return this.storage.read(memory.repository.rootPath)
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

    await this.storage.write(wiki)

    return {
      wiki,
      memory
    }
  }
}

export class ProjectWikiStore {
  constructor(private readonly directoryPath: string) {}

  async read(rootPath: string): Promise<ProjectWikiSnapshot | null> {
    try {
      const raw = await fs.readFile(this.filePath(rootPath), 'utf8')
      const parsed = JSON.parse(raw) as ProjectWikiSnapshot

      return isProjectWikiSnapshot(parsed) ? parsed : null
    } catch {
      return null
    }
  }

  async write(wiki: ProjectWikiSnapshot): Promise<void> {
    await fs.mkdir(this.directoryPath, { recursive: true })
    await fs.writeFile(this.filePath(wiki.repository.rootPath), JSON.stringify(wiki, null, 2), 'utf8')
  }

  private filePath(rootPath: string): string {
    return path.join(this.directoryPath, `${repositoryId(rootPath)}.json`)
  }
}

function buildWikiPages(snapshot: ProjectMemorySnapshot, activity: ActivityLogEntry[]): ProjectWikiPage[] {
  return [
    createPage('overview', 'Overview', 'Repository identity, stack, and indexed context.', overviewMarkdown(snapshot)),
    createPage('module_map', 'Module Map', 'Main directories and indexed file distribution.', moduleMapMarkdown(snapshot)),
    createPage('important_symbols', 'Important Symbols', 'High-signal symbols from the Project Memory index.', importantSymbolsMarkdown(snapshot)),
    createPage('workflows', 'Workflows', 'Product workflows inferred from files, symbols, and recent BranchPilot activity.', workflowsMarkdown(snapshot, activity)),
    createPage('assistant_policy', 'Assistant Policy', 'Local assistant and MCP safety policy for the project.', assistantPolicyMarkdown(snapshot)),
    createPage('recent_timeline', 'Recent Timeline', 'Recent commits and local BranchPilot activity.', recentTimelineMarkdown(snapshot, activity))
  ]
}

function overviewMarkdown(snapshot: ProjectMemorySnapshot): string {
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

  return lines.join('\n')
}

function moduleMapMarkdown(snapshot: ProjectMemorySnapshot): string {
  const directories = summarizeDirectories(snapshot.files)
  const languages = summarizeLanguages(snapshot.files)
  const largestFiles = [...snapshot.files]
    .sort((left, right) => right.sizeBytes - left.sizeBytes)
    .slice(0, 10)

  return [
    '# Module Map',
    '',
    '## Directories',
    ...listOrEmpty(directories.map((entry) => `${entry.name}: ${entry.files} files, ${entry.symbols} symbols`)),
    '',
    '## Languages',
    ...listOrEmpty(languages.map((entry) => `${entry.name}: ${entry.files} files`)),
    '',
    '## Largest Indexed Files',
    ...listOrEmpty(largestFiles.map((file) => `${file.path} (${formatBytes(file.sizeBytes)}, ${file.symbolCount} symbols)`))
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

function summarizeDirectories(files: ProjectMemoryFile[]) {
  const directories = new Map<string, { name: string; files: number; symbols: number }>()

  for (const file of files) {
    const directory = file.path.includes('/') ? file.path.split('/')[0] : '.'
    const entry = directories.get(directory) ?? { name: directory, files: 0, symbols: 0 }
    entry.files += 1
    entry.symbols += file.symbolCount
    directories.set(directory, entry)
  }

  return [...directories.values()]
    .sort((left, right) => right.files - left.files || left.name.localeCompare(right.name))
    .slice(0, MAX_LIST_ITEMS)
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

function repositoryId(rootPath: string): string {
  return createHash('sha256').update(rootPath).digest('hex').slice(0, 16)
}
