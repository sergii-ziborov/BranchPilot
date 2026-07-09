export type BranchPilotMcpToolName =
  | 'project_summary'
  | 'get_project_health'
  | 'search_files'
  | 'search_symbols'
  | 'get_file_outline'
  | 'get_symbol_context'
  | 'get_recent_commits'
  | 'get_current_git_state'
  | 'get_repository_status'
  | 'list_repository_refs'
  | 'list_repository_files'
  | 'read_repository_file'
  | 'search_repository_text'
  | 'get_repository_diff'
  | 'search_commit_history'
  | 'get_commit_details'
  | 'get_file_history'
  | 'get_repository_blame'
  | 'get_agent_activity'
  | 'list_agent_runs'
  | 'get_agent_run'
  | 'get_project_wiki'
  | 'get_wiki_page'

export interface BranchPilotMcpToolDefinition {
  name: BranchPilotMcpToolName
  description: string
}

export const BRANCHPILOT_MCP_TOOLS: BranchPilotMcpToolDefinition[] = [
  {
    name: 'project_summary',
    description: 'Return repository identity, stack hints, counts, and recent commit summary from Project Memory.'
  },
  {
    name: 'get_project_health',
    description: 'Return file-level health signals from Project Memory, including large files, dense modules, import pressure, configs, and entrypoints.'
  },
  {
    name: 'search_files',
    description: 'Search indexed Project Memory files by path, language, or extension.'
  },
  {
    name: 'search_symbols',
    description: 'Search indexed functions, classes, methods, components, types, interfaces, and exports.'
  },
  {
    name: 'get_file_outline',
    description: 'Return symbols and imports for one indexed file path.'
  },
  {
    name: 'get_symbol_context',
    description: 'Return one symbol plus nearby symbols and imports from the same file.'
  },
  {
    name: 'get_recent_commits',
    description: 'Return recent commits stored in Project Memory.'
  },
  {
    name: 'get_current_git_state',
    description: 'Return branch and remote state from the latest Project Memory snapshot.'
  },
  {
    name: 'get_repository_status',
    description: 'Return live local Git status, branch/upstream divergence, and changed files.'
  },
  {
    name: 'list_repository_refs',
    description: 'Return live local branches, remote branches, tags, remotes, and worktrees.'
  },
  {
    name: 'list_repository_files',
    description: 'List tracked and optionally untracked non-ignored files from the live repository worktree.'
  },
  {
    name: 'read_repository_file',
    description: 'Read a repository file from the working tree or a Git revision with line and byte limits.'
  },
  {
    name: 'search_repository_text',
    description: 'Search literal text across non-ignored repository files with optional path, extension, and context filters.'
  },
  {
    name: 'get_repository_diff',
    description: 'Return live Git diff/stat for the working tree, staged changes, one path, or a base/head comparison.'
  },
  {
    name: 'search_commit_history',
    description: 'Search live Git commit history by grep query and optional path filter.'
  },
  {
    name: 'get_commit_details',
    description: 'Return live Git commit metadata, changed files, stat text, and optional patch text.'
  },
  {
    name: 'get_file_history',
    description: 'Return live Git history for one file, following renames.'
  },
  {
    name: 'get_repository_blame',
    description: 'Return live Git blame metadata for a bounded range of one file.'
  },
  {
    name: 'get_agent_activity',
    description: 'Return recent BranchPilot activity for this repository from the local Activity Log.'
  },
  {
    name: 'list_agent_runs',
    description: 'Return recent local-agent (Codex/Claude) run summaries for this repository, including status, prompt preview, and verdict. Useful for seeing what earlier runs did, e.g. after an interruption.'
  },
  {
    name: 'get_agent_run',
    description: 'Return the full stored record for one local-agent run by id, including prompt, output, events, and verdict.'
  },
  {
    name: 'get_project_wiki',
    description: 'Return Project Wiki page summaries generated locally by BranchPilot.'
  },
  {
    name: 'get_wiki_page',
    description: 'Return one generated Project Wiki page by page id.'
  }
]
