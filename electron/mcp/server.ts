import { pathToFileURL } from 'node:url'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import * as z from 'zod/v4'
import {
  BRANCHPILOT_MCP_TOOLS,
  MCP_RESOURCE_URIS,
  type MemoryQueryOptions,
  getCurrentGitState,
  getFileOutline,
  getAgentActivity,
  getProjectHealth,
  getProjectSummary,
  getProjectWiki,
  getPromptText,
  getRecentCommits,
  getResourcePayload,
  getSymbolContext,
  getWikiPage,
  searchFiles,
  searchSymbols,
  toJsonText
} from './memoryQueries.js'
import {
  REPOSITORY_RESOURCE_URIS,
  getCommitDetails,
  getFileHistory,
  getRepositoryBlame,
  getRepositoryDiff,
  getRepositoryResourcePayload,
  getRepositoryStatus,
  listRepositoryFiles,
  listRepositoryRefs,
  readRepositoryFile,
  searchCommitHistory,
  searchRepositoryText
} from './repositoryQueries.js'

const SERVER_VERSION = '0.1.0'
const SERVER_INSTRUCTIONS = [
  'BranchPilot exposes read-only Project Memory and live repository context for a local Git repository.',
  'Use this server for indexed repo summary, health, wiki, file, symbol, import, commit, branch, diff, and working tree context.',
  'Project Memory can be stale: every memory/wiki result includes scannedAt. Live repository tools read the current local worktree and run read-only Git commands.',
  'This server never writes files, edits Git state, pushes, fetches, pulls, or stores credentials.'
].join(' ')

const symbolKinds = [
  'function',
  'class',
  'method',
  'component',
  'constant',
  'type',
  'interface',
  'export'
] as const
const activityTypes = [
  'repository_opened',
  'repository_cloned',
  'repository_refreshed',
  'project_memory_scanned',
  'project_wiki_generated',
  'assistant_policy_updated',
  'assistant_action_blocked',
  'commit_created',
  'commit_amended',
  'commit_reverted',
  'commit_cherry_picked',
  'commit_reset',
  'branch_created',
  'branch_description_updated',
  'branch_switched',
  'branch_deleted',
  'remote_added',
  'remote_updated',
  'remote_removed',
  'tag_created',
  'tag_deleted',
  'worktree_created',
  'worktree_removed',
  'submodule_updated',
  'git_lfs_pulled',
  'patch_exported',
  'patch_applied',
  'git_fetched',
  'git_pulled',
  'git_pushed',
  'git_force_pushed',
  'branch_published',
  'stash_created',
  'stash_applied',
  'stash_dropped',
  'merge_started',
  'merge_continued',
  'merge_aborted',
  'merge_resolved',
  'assistant_commit_generated',
  'assistant_linkedin_generated',
  'assistant_pr_generated',
  'assistant_review_generated',
  'daily_review_generated',
  'github_pr_created',
  'github_pr_checked_out',
  'github_pr_details_loaded'
] as const
const activityActors = ['user', 'branchpilot', 'assistant', 'provider'] as const
const activityStatuses = ['success', 'failure'] as const
const healthSeverities = ['critical', 'warning', 'notice', 'healthy'] as const
const diffModes = ['all', 'staged', 'unstaged'] as const

export function createBranchPilotMcpServer(options: MemoryQueryOptions): McpServer {
  const server = new McpServer({
    name: 'branchpilot-project-memory',
    version: SERVER_VERSION
  }, {
    instructions: SERVER_INSTRUCTIONS
  })

  server.registerTool('project_summary', {
    title: 'Project Summary',
    description: BRANCHPILOT_MCP_TOOLS.find((tool) => tool.name === 'project_summary')?.description,
    annotations: readOnlyAnnotations()
  }, async () => toolJson(await getProjectSummary(options)))

  server.registerTool('get_project_health', {
    title: 'Get Project Health',
    description: BRANCHPILOT_MCP_TOOLS.find((tool) => tool.name === 'get_project_health')?.description,
    inputSchema: {
      limit: z.number().int().min(1).max(100).optional().describe('Maximum number of file health reports to return.'),
      minimumSeverity: z.enum(healthSeverities).optional().describe('Minimum file severity to include.'),
      includeHealthy: z.boolean().optional().describe('Include files with no health signals.')
    },
    annotations: readOnlyAnnotations()
  }, async (args) => toolJson(await getProjectHealth({ ...options, ...args })))

  server.registerTool('search_files', {
    title: 'Search Files',
    description: BRANCHPILOT_MCP_TOOLS.find((tool) => tool.name === 'search_files')?.description,
    inputSchema: {
      query: z.string().optional().describe('Case-insensitive path or language query.'),
      language: z.string().optional().describe('Optional language or extension filter.'),
      limit: z.number().int().min(1).max(100).optional().describe('Maximum number of files to return.')
    },
    annotations: readOnlyAnnotations()
  }, async (args) => toolJson(await searchFiles({ ...options, ...args })))

  server.registerTool('search_symbols', {
    title: 'Search Symbols',
    description: BRANCHPILOT_MCP_TOOLS.find((tool) => tool.name === 'search_symbols')?.description,
    inputSchema: {
      query: z.string().optional().describe('Case-insensitive symbol name query.'),
      kind: z.enum(symbolKinds).optional().describe('Optional symbol kind filter.'),
      path: z.string().optional().describe('Optional indexed file path filter.'),
      limit: z.number().int().min(1).max(100).optional().describe('Maximum number of symbols to return.')
    },
    annotations: readOnlyAnnotations()
  }, async (args) => toolJson(await searchSymbols({ ...options, ...args })))

  server.registerTool('get_file_outline', {
    title: 'Get File Outline',
    description: BRANCHPILOT_MCP_TOOLS.find((tool) => tool.name === 'get_file_outline')?.description,
    inputSchema: {
      path: z.string().min(1).describe('Indexed repository-relative file path.')
    },
    annotations: readOnlyAnnotations()
  }, async (args) => toolJson(await getFileOutline({ ...options, path: args.path })))

  server.registerTool('get_symbol_context', {
    title: 'Get Symbol Context',
    description: BRANCHPILOT_MCP_TOOLS.find((tool) => tool.name === 'get_symbol_context')?.description,
    inputSchema: {
      symbolId: z.string().optional().describe('Exact Project Memory symbol id.'),
      name: z.string().optional().describe('Symbol name query when symbolId is not available.'),
      path: z.string().optional().describe('Optional repository-relative file path filter.')
    },
    annotations: readOnlyAnnotations()
  }, async (args) => toolJson(await getSymbolContext({ ...options, ...args })))

  server.registerTool('get_recent_commits', {
    title: 'Get Recent Commits',
    description: BRANCHPILOT_MCP_TOOLS.find((tool) => tool.name === 'get_recent_commits')?.description,
    inputSchema: {
      limit: z.number().int().min(1).max(100).optional().describe('Maximum number of commits to return.')
    },
    annotations: readOnlyAnnotations()
  }, async (args) => toolJson(await getRecentCommits({ ...options, limit: args.limit })))

  server.registerTool('get_current_git_state', {
    title: 'Get Current Git State',
    description: BRANCHPILOT_MCP_TOOLS.find((tool) => tool.name === 'get_current_git_state')?.description,
    annotations: readOnlyAnnotations()
  }, async () => toolJson(await getCurrentGitState(options)))

  server.registerTool('get_repository_status', {
    title: 'Get Repository Status',
    description: BRANCHPILOT_MCP_TOOLS.find((tool) => tool.name === 'get_repository_status')?.description,
    annotations: readOnlyAnnotations()
  }, async () => toolJson(await getRepositoryStatus(options)))

  server.registerTool('list_repository_refs', {
    title: 'List Repository Refs',
    description: BRANCHPILOT_MCP_TOOLS.find((tool) => tool.name === 'list_repository_refs')?.description,
    annotations: readOnlyAnnotations()
  }, async () => toolJson(await listRepositoryRefs(options)))

  server.registerTool('list_repository_files', {
    title: 'List Repository Files',
    description: BRANCHPILOT_MCP_TOOLS.find((tool) => tool.name === 'list_repository_files')?.description,
    inputSchema: {
      query: z.string().optional().describe('Case-insensitive repository-relative path filter.'),
      extension: z.string().optional().describe('Optional extension filter, such as ts or .tsx.'),
      includeUntracked: z.boolean().optional().describe('Include untracked non-ignored files. Defaults to true.'),
      limit: z.number().int().min(1).max(200).optional().describe('Maximum number of files to return.')
    },
    annotations: readOnlyAnnotations()
  }, async (args) => toolJson(await listRepositoryFiles({ ...options, ...args })))

  server.registerTool('read_repository_file', {
    title: 'Read Repository File',
    description: BRANCHPILOT_MCP_TOOLS.find((tool) => tool.name === 'read_repository_file')?.description,
    inputSchema: {
      path: z.string().min(1).describe('Repository-relative file path.'),
      revision: z.string().optional().describe('Optional Git revision. Omit to read the working tree.'),
      startLine: z.number().int().min(1).optional().describe('First 1-based line to return.'),
      maxLines: z.number().int().min(1).max(2000).optional().describe('Maximum number of lines to return.'),
      maxBytes: z.number().int().min(4000).max(1000000).optional().describe('Maximum bytes to read before line slicing.')
    },
    annotations: readOnlyAnnotations()
  }, async (args) => toolJson(await readRepositoryFile({ ...options, ...args })))

  server.registerTool('search_repository_text', {
    title: 'Search Repository Text',
    description: BRANCHPILOT_MCP_TOOLS.find((tool) => tool.name === 'search_repository_text')?.description,
    inputSchema: {
      query: z.string().min(1).describe('Literal text to search in non-ignored repository files.'),
      path: z.string().optional().describe('Optional file or directory path filter.'),
      extension: z.string().optional().describe('Optional extension filter, such as ts or .tsx.'),
      caseSensitive: z.boolean().optional().describe('Use case-sensitive matching. Defaults to false.'),
      contextLines: z.number().int().min(0).max(5).optional().describe('Context lines before and after each match.'),
      limit: z.number().int().min(1).max(200).optional().describe('Maximum matches to return.')
    },
    annotations: readOnlyAnnotations()
  }, async (args) => toolJson(await searchRepositoryText({ ...options, ...args })))

  server.registerTool('get_repository_diff', {
    title: 'Get Repository Diff',
    description: BRANCHPILOT_MCP_TOOLS.find((tool) => tool.name === 'get_repository_diff')?.description,
    inputSchema: {
      mode: z.enum(diffModes).optional().describe('Diff mode when base/head are omitted. all means HEAD vs working tree.'),
      path: z.string().optional().describe('Optional repository-relative path filter.'),
      base: z.string().optional().describe('Optional base Git ref for comparing refs.'),
      head: z.string().optional().describe('Optional head Git ref for comparing refs.'),
      maxBytes: z.number().int().min(4000).max(1000000).optional().describe('Maximum bytes of stat/diff text to return.')
    },
    annotations: readOnlyAnnotations()
  }, async (args) => toolJson(await getRepositoryDiff({ ...options, ...args })))

  server.registerTool('search_commit_history', {
    title: 'Search Commit History',
    description: BRANCHPILOT_MCP_TOOLS.find((tool) => tool.name === 'search_commit_history')?.description,
    inputSchema: {
      query: z.string().optional().describe('Optional case-insensitive grep over commit subjects/bodies.'),
      path: z.string().optional().describe('Optional repository-relative path filter.'),
      limit: z.number().int().min(1).max(200).optional().describe('Maximum commits to return.')
    },
    annotations: readOnlyAnnotations()
  }, async (args) => toolJson(await searchCommitHistory({ ...options, ...args })))

  server.registerTool('get_commit_details', {
    title: 'Get Commit Details',
    description: BRANCHPILOT_MCP_TOOLS.find((tool) => tool.name === 'get_commit_details')?.description,
    inputSchema: {
      ref: z.string().min(1).describe('Commit SHA or ref to inspect.'),
      includePatch: z.boolean().optional().describe('Include patch text instead of only stat text.'),
      maxBytes: z.number().int().min(4000).max(1000000).optional().describe('Maximum bytes of commit text to return.')
    },
    annotations: readOnlyAnnotations()
  }, async (args) => toolJson(await getCommitDetails({ ...options, ...args })))

  server.registerTool('get_file_history', {
    title: 'Get File History',
    description: BRANCHPILOT_MCP_TOOLS.find((tool) => tool.name === 'get_file_history')?.description,
    inputSchema: {
      path: z.string().min(1).describe('Repository-relative file path.'),
      limit: z.number().int().min(1).max(200).optional().describe('Maximum commits to return.')
    },
    annotations: readOnlyAnnotations()
  }, async (args) => toolJson(await getFileHistory({ ...options, ...args })))

  server.registerTool('get_repository_blame', {
    title: 'Get Repository Blame',
    description: BRANCHPILOT_MCP_TOOLS.find((tool) => tool.name === 'get_repository_blame')?.description,
    inputSchema: {
      path: z.string().min(1).describe('Repository-relative file path.'),
      startLine: z.number().int().min(1).optional().describe('First 1-based line to blame.'),
      lineCount: z.number().int().min(1).max(200).optional().describe('Number of lines to blame.')
    },
    annotations: readOnlyAnnotations()
  }, async (args) => toolJson(await getRepositoryBlame({ ...options, ...args })))

  server.registerTool('get_agent_activity', {
    title: 'Get Agent Activity',
    description: BRANCHPILOT_MCP_TOOLS.find((tool) => tool.name === 'get_agent_activity')?.description,
    inputSchema: {
      types: z.array(z.enum(activityTypes)).optional().describe('Optional event type filters.'),
      actor: z.enum(activityActors).optional().describe('Optional actor filter.'),
      status: z.enum(activityStatuses).optional().describe('Optional success/failure filter.'),
      limit: z.number().int().min(1).max(100).optional().describe('Maximum number of activity entries to return.')
    },
    annotations: readOnlyAnnotations()
  }, async (args) => toolJson(await getAgentActivity({ ...options, ...args })))

  server.registerTool('get_project_wiki', {
    title: 'Get Project Wiki',
    description: BRANCHPILOT_MCP_TOOLS.find((tool) => tool.name === 'get_project_wiki')?.description,
    annotations: readOnlyAnnotations()
  }, async () => toolJson(await getProjectWiki(options)))

  server.registerTool('get_wiki_page', {
    title: 'Get Wiki Page',
    description: BRANCHPILOT_MCP_TOOLS.find((tool) => tool.name === 'get_wiki_page')?.description,
    inputSchema: {
      pageId: z.string().min(1).describe('Project Wiki page id, including generated module page ids.')
    },
    annotations: readOnlyAnnotations()
  }, async (args) => toolJson(await getWikiPage({ ...options, pageId: args.pageId })))

  for (const uri of [...MCP_RESOURCE_URIS, ...REPOSITORY_RESOURCE_URIS]) {
    server.registerResource(resourceName(uri), uri, {
      title: resourceTitle(uri),
      description: `BranchPilot read-only repository resource for ${uri}.`,
      mimeType: 'application/json'
    }, async (resourceUri) => ({
      contents: [{
        uri: resourceUri.toString(),
        mimeType: 'application/json',
        text: toJsonText(await getMcpResourcePayload(options, resourceUri.toString()))
      }]
    }))
  }

  for (const name of ['review-current-work', 'prepare-change-plan', 'explain-module', 'summarize-recent-work']) {
    server.registerPrompt(name, {
      title: promptTitle(name),
      description: `BranchPilot workflow prompt: ${name}.`
    }, async () => ({
      messages: [{
        role: 'user',
        content: {
          type: 'text',
          text: getPromptText(name)
        }
      }]
    }))
  }

  return server
}

async function getMcpResourcePayload(options: MemoryQueryOptions, uri: string): Promise<unknown> {
  if ((MCP_RESOURCE_URIS as readonly string[]).includes(uri)) {
    return getResourcePayload(options, uri)
  }

  return getRepositoryResourcePayload(options, uri)
}

export function parseMcpServerArgs(argv: string[]): MemoryQueryOptions {
  const memoryDir = readFlag(argv, '--memory-dir')
  const activityDir = readFlag(argv, '--activity-dir')
  const wikiDir = readFlag(argv, '--wiki-dir')
  const repoPath = readFlag(argv, '--repo')

  if (!memoryDir) {
    throw new Error('Missing required --memory-dir argument.')
  }

  return {
    memoryDir,
    activityDir,
    wikiDir,
    repoPath
  }
}

async function main() {
  const options = parseMcpServerArgs(process.argv.slice(2))
  const server = createBranchPilotMcpServer(options)
  const transport = new StdioServerTransport()

  await server.connect(transport)
}

function toolJson(payload: unknown) {
  return {
    content: [{
      type: 'text' as const,
      text: toJsonText(payload)
    }]
  }
}

function readOnlyAnnotations() {
  return {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false
  }
}

function readFlag(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag)

  if (index === -1) {
    return undefined
  }

  return argv[index + 1]
}

function resourceName(uri: string): string {
  return uri.replace('branchpilot://repo/current/', 'current_')
}

function resourceTitle(uri: string): string {
  const suffix = uri.split('/').at(-1) ?? uri
  return suffix
    .split('-')
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(' ')
}

function promptTitle(name: string): string {
  return name
    .split('-')
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(' ')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'Unexpected BranchPilot MCP server error.'
    process.stderr.write(`${message}\n`)
    process.exit(1)
  })
}
