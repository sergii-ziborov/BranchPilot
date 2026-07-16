export type BranchPilotMcpToolName =
  | 'project_summary'
  | 'get_project_health'
  | 'get_live_overview'
  | 'get_recent_commits'
  | 'get_current_git_state'
  | 'get_repository_status'
  | 'list_repository_refs'
  | 'list_repository_files'
  | 'read_repository_file'
  | 'get_repository_diff'
  | 'get_ci_status'
  | 'get_pull_request'
  | 'list_pull_requests'
  | 'search_commit_history'
  | 'get_commit_details'
  | 'get_file_history'
  | 'get_repository_blame'
  | 'get_agent_activity'
  | 'list_agent_runs'
  | 'get_agent_run'
  | 'record_session_note'
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
    name: 'get_live_overview',
    description: 'One-call session orientation: live branch/status/changed files, refs summary, recent commits, and top health-risk files. Start here instead of calling status, refs, history, and health separately.'
  },
  {
    name: 'get_recent_commits',
    description: 'Return recent commits from the indexed Project Memory snapshot (works without git installed). Prefer search_commit_history for live history when git is available.'
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
    name: 'get_repository_diff',
    description: 'Return live Git diff for the working tree, staged changes, one path, or a base/head comparison — as a full patch, stat summary, or changed-file list, with optional merge-base (three-dot) comparison and unified context control. Working-tree modes also list untracked files, which git diff alone never shows.'
  },
  {
    name: 'get_ci_status',
    description: 'One-call CI triage: workflow runs for a branch or PR, the failed jobs of the newest failed run, and a bounded TAIL of each failed log. Uses your existing GitHub credentials (GH_TOKEN/GITHUB_TOKEN or Git Credential Manager — no gh CLI needed); read-only.'
  },
  {
    name: 'get_pull_request',
    description: 'One-call PR context: metadata, changed files, review decision, recent comments, unresolved review threads, optional bounded diff. Defaults to the current branch\'s PR. Uses your existing GitHub credentials (GH_TOKEN or Git Credential Manager); read-only. For the impact of those changes feed the file list into the repo-lens change_impact tool (works without checking the PR out).'
  },
  {
    name: 'list_pull_requests',
    description: 'List pull requests with CI check rollup (passed/failed/pending + failed check names) and review state in one call. For review priority or merge risk, feed a candidate\'s files from get_pull_request into repo-lens change_impact. Uses your existing GitHub credentials (GH_TOKEN or Git Credential Manager); read-only.'
  },
  {
    name: 'search_commit_history',
    description: 'Search live Git commit history by grep query, author, since/until dates, and optional path filter.'
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
    description: 'Return recent BranchPilot activity for this repository from the local Activity Log, filterable by event type, actor, status, and since/until dates.'
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
    name: 'record_session_note',
    description: 'Append a durable assistant note to the BranchPilot Activity Log (actor "assistant"): record long or expensive work you start and finish (test runs, builds, migrations) so a crashed or new session can check get_agent_activity instead of redoing it. Writes only BranchPilot\'s own ledger — never repository files or Git state.'
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
