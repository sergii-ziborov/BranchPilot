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

const SERVER_VERSION = '0.1.0'
const SERVER_INSTRUCTIONS = [
  'BranchPilot exposes read-only Project Memory for a local Git repository.',
  'Use this server for indexed repo summary, file, symbol, import, and commit context.',
  'Project Memory can be stale: every result includes scannedAt. Use shell/git separately for live mutable state.',
  'This server never writes files, runs commands, edits Git state, or stores credentials.'
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
  'repository_refreshed',
  'project_memory_scanned',
  'project_wiki_generated',
  'assistant_policy_updated',
  'assistant_action_blocked',
  'commit_created',
  'commit_amended',
  'commit_reverted',
  'commit_cherry_picked',
  'branch_created',
  'branch_description_updated',
  'branch_switched',
  'branch_deleted',
  'tag_created',
  'tag_deleted',
  'worktree_created',
  'worktree_removed',
  'patch_exported',
  'patch_applied',
  'git_fetched',
  'git_pulled',
  'git_pushed',
  'branch_published',
  'stash_created',
  'stash_applied',
  'stash_dropped',
  'merge_started',
  'merge_continued',
  'merge_aborted',
  'merge_resolved',
  'assistant_commit_generated',
  'assistant_pr_generated',
  'assistant_review_generated',
  'daily_review_generated',
  'github_pr_created',
  'github_pr_checked_out',
  'github_pr_details_loaded'
] as const
const activityActors = ['user', 'branchpilot', 'assistant', 'provider'] as const
const activityStatuses = ['success', 'failure'] as const
const wikiPageIds = [
  'overview',
  'module_map',
  'important_symbols',
  'workflows',
  'assistant_policy',
  'recent_timeline'
] as const

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
      pageId: z.enum(wikiPageIds).describe('Project Wiki page id.')
    },
    annotations: readOnlyAnnotations()
  }, async (args) => toolJson(await getWikiPage({ ...options, pageId: args.pageId })))

  for (const uri of MCP_RESOURCE_URIS) {
    server.registerResource(resourceName(uri), uri, {
      title: resourceTitle(uri),
      description: `BranchPilot Project Memory resource for ${uri}.`,
      mimeType: 'application/json'
    }, async (resourceUri) => ({
      contents: [{
        uri: resourceUri.toString(),
        mimeType: 'application/json',
        text: toJsonText(await getResourcePayload(options, resourceUri.toString()))
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
