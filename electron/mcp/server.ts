import { pathToFileURL } from 'node:url'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import * as z from 'zod/v4'
import {
  BRANCHPILOT_MCP_TOOLS,
  MCP_RESOURCE_URIS,
  type MemoryQueryOptions,
  getCurrentGitState,
  getAgentActivity,
  getAgentRuns,
  getAgentRunDetail,
  getProjectHealth,
  getProjectSummary,
  getProjectWiki,
  getPromptText,
  getRecentCommits,
  getResourcePayload,
  getWikiPage,
  recordSessionNote,
  toJsonText
} from './memoryQueries.js'
import {
  REPOSITORY_RESOURCE_URIS,
  getCiStatus,
  getCommitDetails,
  getFileHistory,
  getLiveOverview,
  getPullRequest,
  listPullRequests,
  getRepositoryBlame,
  getRepositoryDiff,
  getRepositoryResourcePayload,
  getRepositoryStatus,
  listRepositoryFiles,
  listRepositoryRefs,
  readRepositoryFile,
  searchCommitHistory
} from './repositoryQueries.js'

const SERVER_VERSION = '0.1.0'
const SERVER_INSTRUCTIONS = [
  'BranchPilot exposes read-only live repository context and locally indexed Project Memory for a Git repository.',
  'Use it for live Git status, diff, history, blame, commit details, refs, working-tree and revision file reads, plus Project Memory summary, file-level health, Project Wiki, and the BranchPilot activity/agent-run log.',
  'For code-structure work — symbol graph, who-calls/who-imports, regex or full-text code search, and clone detection — use the repo-lens MCP server when it is attached; BranchPilot intentionally does not duplicate those.',
  'Project Memory can be stale: every memory/wiki result includes scannedAt. Live repository tools read the current local worktree and run read-only Git commands.',
  'This server never writes repository files, edits Git state, pushes, fetches, pulls, or stores credentials. Its only write is record_session_note, which appends an assistant note to BranchPilot\'s own activity ledger (outside the repository) so interrupted sessions can see what earlier work was already started.'
].join(' ')

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
  'assistant_codex_agent_ran',
  'assistant_session_note',
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
const sessionNotePhases = ['started', 'completed', 'failed'] as const
const diffModes = ['all', 'staged', 'unstaged'] as const
const diffFormats = ['patch', 'stat', 'name-only'] as const

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

  server.registerTool('get_live_overview', {
    title: 'Get Live Overview',
    description: BRANCHPILOT_MCP_TOOLS.find((tool) => tool.name === 'get_live_overview')?.description,
    annotations: readOnlyAnnotations()
  }, async () => toolJson(await getLiveOverview(options)))

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

  server.registerTool('get_repository_diff', {
    title: 'Get Repository Diff',
    description: BRANCHPILOT_MCP_TOOLS.find((tool) => tool.name === 'get_repository_diff')?.description,
    inputSchema: {
      mode: z.enum(diffModes).optional().describe('Diff mode when base/head are omitted. all means HEAD vs working tree.'),
      format: z.enum(diffFormats).optional().describe('Output shape: patch (stat + full patch, default), stat (summary only), or name-only (changed files).'),
      path: z.string().optional().describe('Optional repository-relative path filter.'),
      base: z.string().optional().describe('Optional base Git ref for comparing refs.'),
      head: z.string().optional().describe('Optional head Git ref for comparing refs.'),
      mergeBase: z.boolean().optional().describe('Compare head against the merge-base of base and head (three-dot), for PR-style review.'),
      contextLines: z.number().int().min(0).max(50).optional().describe('Unified context lines around each hunk in patch format.'),
      maxBytes: z.number().int().min(4000).max(1000000).optional().describe('Maximum bytes of stat/diff text to return.')
    },
    annotations: readOnlyAnnotations()
  }, async (args) => toolJson(await getRepositoryDiff({ ...options, ...args })))

  server.registerTool('get_ci_status', {
    title: 'Get CI Status',
    description: BRANCHPILOT_MCP_TOOLS.find((tool) => tool.name === 'get_ci_status')?.description,
    inputSchema: {
      ref: z.string().optional().describe('Branch to inspect. Defaults to the current branch.'),
      prNumber: z.number().int().min(1).optional().describe('Inspect the head branch of this PR instead.'),
      runLimit: z.number().int().min(1).max(20).optional().describe('Maximum workflow runs to list. Default 5.'),
      failedLogBytes: z.number().int().min(2000).max(60000).optional().describe('Tail bytes of each failed job log. Default 12000.')
    },
    annotations: readOnlyAnnotations()
  }, async (args) => toolJson(await getCiStatus({ ...options, ...args })))

  server.registerTool('get_pull_request', {
    title: 'Get Pull Request',
    description: BRANCHPILOT_MCP_TOOLS.find((tool) => tool.name === 'get_pull_request')?.description,
    inputSchema: {
      number: z.number().int().min(1).optional().describe('PR number. Omit to use the current branch\'s PR.'),
      includeDiff: z.boolean().optional().describe('Include the PR diff text (bounded by maxBytes).'),
      maxBytes: z.number().int().min(4000).max(1000000).optional().describe('Maximum bytes of diff text to return.')
    },
    annotations: readOnlyAnnotations()
  }, async (args) => toolJson(await getPullRequest({ ...options, ...args })))

  server.registerTool('list_pull_requests', {
    title: 'List Pull Requests',
    description: BRANCHPILOT_MCP_TOOLS.find((tool) => tool.name === 'list_pull_requests')?.description,
    inputSchema: {
      state: z.enum(['open', 'closed', 'merged', 'all']).optional().describe('PR state filter. Defaults to open.'),
      base: z.string().optional().describe('Only PRs targeting this base branch.'),
      limit: z.number().int().min(1).max(50).optional().describe('Maximum PRs to return. Default 20.')
    },
    annotations: readOnlyAnnotations()
  }, async (args) => toolJson(await listPullRequests({ ...options, ...args })))

  server.registerTool('search_commit_history', {
    title: 'Search Commit History',
    description: BRANCHPILOT_MCP_TOOLS.find((tool) => tool.name === 'search_commit_history')?.description,
    inputSchema: {
      query: z.string().optional().describe('Optional case-insensitive grep over commit subjects/bodies.'),
      author: z.string().optional().describe('Optional author name/email pattern (git --author).'),
      since: z.string().optional().describe('Only commits after this date (git --since, e.g. 2026-07-01 or "2 weeks ago").'),
      until: z.string().optional().describe('Only commits before this date (git --until).'),
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
      since: z.string().optional().describe('Only entries at or after this ISO date/datetime.'),
      until: z.string().optional().describe('Only entries at or before this ISO date/datetime.'),
      limit: z.number().int().min(1).max(100).optional().describe('Maximum number of activity entries to return.')
    },
    annotations: readOnlyAnnotations()
  }, async (args) => toolJson(await getAgentActivity({ ...options, ...args })))

  server.registerTool('list_agent_runs', {
    title: 'List Agent Runs',
    description: BRANCHPILOT_MCP_TOOLS.find((tool) => tool.name === 'list_agent_runs')?.description,
    inputSchema: {
      limit: z.number().int().min(1).max(100).optional().describe('Maximum number of agent run summaries to return.')
    },
    annotations: readOnlyAnnotations()
  }, async (args) => toolJson(await getAgentRuns({ ...options, limit: args.limit })))

  server.registerTool('get_agent_run', {
    title: 'Get Agent Run',
    description: BRANCHPILOT_MCP_TOOLS.find((tool) => tool.name === 'get_agent_run')?.description,
    inputSchema: {
      id: z.string().min(1).describe('Agent run id to fetch, as returned by list_agent_runs.')
    },
    annotations: readOnlyAnnotations()
  }, async (args) => toolJson(await getAgentRunDetail({ ...options, id: args.id })))

  server.registerTool('record_session_note', {
    title: 'Record Session Note',
    description: BRANCHPILOT_MCP_TOOLS.find((tool) => tool.name === 'record_session_note')?.description,
    inputSchema: {
      title: z.string().min(1).max(200).describe('Short description of the work, e.g. "Full vitest run".'),
      detail: z.string().max(300).optional().describe('Optional context: command, scope, outcome.'),
      phase: z.enum(sessionNotePhases).optional().describe('started before long work; completed or failed after it. Defaults to completed.')
    },
    // The one non-read-only tool: appends to BranchPilot's own activity ledger, never the repository.
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false
    }
  }, async (args) => toolJson(await recordSessionNote({ ...options, ...args })))

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
  const agentRunDir = readFlag(argv, '--agent-run-dir')
  const repoPath = readFlag(argv, '--repo')

  if (!memoryDir) {
    throw new Error('Missing required --memory-dir argument.')
  }

  return {
    memoryDir,
    activityDir,
    wikiDir,
    agentRunDir,
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
