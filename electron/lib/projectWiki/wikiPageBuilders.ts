import type {
  ActivityLogEntry,
  ProjectMemorySnapshot,
  ProjectWikiPage
} from '../../../src/shared/branchPilot.js'
import {
  MAX_LIST_ITEMS,
  compareSymbolsForImportance,
  findConfigFiles,
  findEntrypoints,
  folderPurpose,
  isLowSignalPath,
  moduleRole,
  summarizeDirectories,
  summarizeExternalImports,
  summarizeLanguages,
  wikiModuleDirectories
} from './memoryInsights.js'
import { moduleDetailLines, modulePageId, modulePageMarkdown, modulePageTitle } from './modulePages.js'
import { activityTypeLabel, createPage, formatBytes, formatDate, listOrEmpty, symbolLabel } from './wikiText.js'

const IMPORTANT_SYMBOL_KINDS = new Set(['class', 'component', 'function', 'interface', 'type'])
const COMPLETED_WORK_ACTIVITY_TYPES = new Set<ActivityLogEntry['type']>([
  'github_pr_created',
  'daily_review_generated',
  'assistant_linkedin_generated',
  'merge_continued',
  'patch_applied',
  'branch_published'
])

export function buildWikiPages(snapshot: ProjectMemorySnapshot, activity: ActivityLogEntry[]): ProjectWikiPage[] {
  const modulePages = wikiModuleDirectories(snapshot).map((module) =>
    createPage(
      modulePageId(module.name),
      modulePageTitle(module.name),
      `Module guide for ${module.name}.`,
      modulePageMarkdown(snapshot, module)
    )
  )

  return [
    createPage('overview', 'Overview', 'Repository identity, stack, and indexed context.', overviewMarkdown(snapshot)),
    createPage('module_map', 'Module Map', 'Main directories and indexed file distribution.', moduleMapMarkdown(snapshot)),
    ...modulePages,
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
  const modules = wikiModuleDirectories(snapshot)
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
    'This page is the main orientation map for local assistants. Start here before opening raw files.',
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
    ...(modules.length > 0 ? modules.flatMap((entry) => moduleDetailLines(snapshot, entry, true)) : ['- No indexed module folders available.']),
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
