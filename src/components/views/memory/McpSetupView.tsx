import { Cable, CheckCircle2, Clock3, Database, Server } from 'lucide-react'
import { CopyableCodeBlock } from '../../CopyableCodeBlock'
import type {
  ActivityLogSnapshot, ProjectMemoryMcpConfig, ProjectMemorySnapshot, ProjectWikiSnapshot
} from '../../../shared/branchPilot'
import { formatDate } from '../../../lib/format'
import { MemoryCellHeading, MemoryPanelHeading } from './MemoryPanelChrome'
import { shortPath } from './pathLabels'

interface McpSetupViewProps {
  projectMemoryMcpConfig: ProjectMemoryMcpConfig | null
  projectMemory: ProjectMemorySnapshot | null
  projectWiki: ProjectWikiSnapshot | null
  activityLog: ActivityLogSnapshot | null
  copyProjectMemoryText: (text: string, label: string) => void | Promise<void>
}

export function McpSetupView({
  projectMemoryMcpConfig,
  projectMemory,
  projectWiki,
  activityLog,
  copyProjectMemoryText
}: McpSetupViewProps) {
  if (!projectMemoryMcpConfig) {
    return (
      <section className="single-panel branchpilot-memory-panel mcp-panel">
        <MemoryPanelHeading
          title="MCP"
          detail="Connect local assistants to BranchPilot Memory, Project Wiki, and change history."
        />
        <section className="memory-empty-board">
          <Cable size={28} />
          <div>
            <h3>No MCP config</h3>
            <p>Open a repository to generate connection settings.</p>
          </div>
        </section>
      </section>
    )
  }

  const prompt = mcpConnectionPrompt(projectMemoryMcpConfig, projectMemory, projectWiki, activityLog)
  const mcpResources = [
    {
      title: 'Live status',
      uri: 'branchpilot://repo/current/live-status',
      detail: 'Current branch, upstream divergence, worktree counts, and changed paths.'
    },
    {
      title: 'Working tree',
      uri: 'branchpilot://repo/current/worktree',
      detail: 'Tracked and untracked non-ignored local files for GitHub-like repo browsing.'
    },
    {
      title: 'Project health',
      uri: 'branchpilot://repo/current/health',
      detail: 'File-level risk map from Project Memory: large files, dense modules, configs, and entrypoints.'
    },
    {
      title: 'Project Wiki',
      uri: 'branchpilot://repo/current/wiki',
      detail: 'Generated architecture, module map, workflows, assistant policy, and recent timeline.'
    },
    {
      title: 'Change history',
      uri: 'branchpilot://repo/current/activity',
      detail: 'BranchPilot activity ledger: assistant actions, repository operations, and provider events.'
    },
    {
      title: 'Recent commits',
      uri: 'branchpilot://repo/current/commits',
      detail: 'Recent Git subjects and SHAs to explain what changed before reading files.'
    },
    {
      title: 'Refs',
      uri: 'branchpilot://repo/current/refs',
      detail: 'Local branches, remote branches, tags, remotes, and worktrees.'
    },
    {
      title: 'Current diff',
      uri: 'branchpilot://repo/current/diff',
      detail: 'Live Git diff/stat for current uncommitted work.'
    },
    {
      title: 'File tree',
      uri: 'branchpilot://repo/current/tree',
      detail: 'Indexed repository file tree from Project Memory for fast orientation.'
    }
  ]
  const mcpToolGroups = [
    {
      title: 'Orient',
      tools: ['get_live_overview', 'project_summary', 'get_project_health', 'get_repository_status', 'get_project_wiki']
    },
    {
      title: 'Browse repo',
      tools: ['list_repository_files', 'read_repository_file']
    },
    {
      title: 'Review changes',
      tools: ['get_repository_diff', 'list_pull_requests', 'get_pull_request', 'get_ci_status', 'get_commit_details', 'get_file_history', 'get_repository_blame']
    },
    {
      title: 'Trace work',
      tools: ['get_recent_commits', 'get_agent_activity', 'list_agent_runs', 'get_agent_run', 'record_session_note', 'get_wiki_page']
    }
  ]
  const mcpPrompts = ['review-current-work', 'prepare-change-plan', 'explain-module', 'summarize-recent-work']
  const sourceCards = [
    {
      title: 'Memory index',
      detail: projectMemory ? `${projectMemory.files.length} files - ${projectMemory.symbols.length} symbols` : 'No snapshot loaded',
      meta: 'Searchable project map',
      ready: Boolean(projectMemory)
    },
    {
      title: 'Project Wiki',
      detail: projectWiki ? `${projectWiki.pages.length} generated pages` : 'No wiki generated',
      meta: 'Architecture guide',
      ready: Boolean(projectWiki)
    },
    {
      title: 'Change history',
      detail: `${activityLog?.totalCount ?? 0} BranchPilot events`,
      meta: 'Assistant, provider, and repo timeline',
      ready: Boolean(activityLog?.totalCount)
    },
    {
      title: 'Read-only server',
      detail: projectMemoryMcpConfig.serverExists ? 'Server build found' : 'Run npm run build',
      meta: 'No repo writes or Git mutation',
      ready: projectMemoryMcpConfig.serverExists
    }
  ]

  return (
    <section className="single-panel branchpilot-memory-panel mcp-panel">
      <MemoryPanelHeading
        title="MCP"
        detail="Copy a connection prompt or config that exposes live repo, Git history, Memory, Project Wiki, and change history to local assistants."
      />

      <div className="mcp-workbench">
        <section className="mcp-source-grid">
          {sourceCards.map((card) => (
            <article className={card.ready ? 'mcp-source-card ready' : 'mcp-source-card'} key={card.title}>
              {card.ready ? <CheckCircle2 size={16} /> : <Clock3 size={16} />}
              <div>
                <strong>{card.title}</strong>
                <span>{card.detail}</span>
                <small>{card.meta}</small>
              </div>
            </article>
          ))}
        </section>

        <section className="mcp-main-grid">
          <section className="memory-workcell mcp-surface-cell">
            <MemoryCellHeading icon={<Cable size={16} />} title="MCP context surface" meta={`${mcpResources.length} resources - ${mcpPrompts.length} prompts`} />
            <div className="mcp-resource-list">
              {mcpResources.map((resource) => (
                <article className="mcp-resource-row" key={resource.uri}>
                  <div>
                    <strong>{resource.title}</strong>
                    <span>{resource.detail}</span>
                  </div>
                  <code>{resource.uri}</code>
                </article>
              ))}
            </div>

            <div className="mcp-tool-groups">
              {mcpToolGroups.map((group) => (
                <article className="mcp-tool-card" key={group.title}>
                  <strong>{group.title}</strong>
                  <span>{group.tools.join(' - ')}</span>
                </article>
              ))}
            </div>

            <section className="mcp-prompt-card">
              <div className="memory-section-heading compact">
                <h3>Assistant behavior prompt</h3>
                <button type="button" className="mcp-copy-prompt-button" onClick={() => copyProjectMemoryText(prompt, 'BranchPilot MCP prompt')}>
                  <Cable size={15} />
                  Copy Prompt
                </button>
              </div>
              <p>Use this when connecting Claude Code, Codex, or another MCP client so it reads BranchPilot context before opening raw files.</p>
              <div className="mcp-prompt-chips">
                {mcpPrompts.map((name) => <code key={name}>{name}</code>)}
              </div>
            </section>
          </section>

          <section className="memory-workcell mcp-config-cell">
            <MemoryCellHeading icon={<Server size={16} />} title="Connection" meta={projectMemoryMcpConfig.serverExists ? 'ready' : 'build missing'} />
            <CopyableCodeBlock
              variant="snippet"
              title="Server command"
              code={projectMemoryMcpConfig.serverCommand}
              onCopy={() => copyProjectMemoryText(projectMemoryMcpConfig.serverCommand, 'MCP server command')}
            />
            <CopyableCodeBlock
              variant="snippet"
              title="Codex CLI command"
              code={projectMemoryMcpConfig.codexCommand}
              onCopy={() => copyProjectMemoryText(projectMemoryMcpConfig.codexCommand, 'Codex CLI MCP command')}
            />
            <CopyableCodeBlock
              variant="snippet"
              title="Codex config.toml"
              code={projectMemoryMcpConfig.codexToml}
              onCopy={() => copyProjectMemoryText(projectMemoryMcpConfig.codexToml, 'Codex MCP TOML')}
            />
            <section className="mcp-diagnostics">
              <MemoryCellHeading icon={<Database size={15} />} title="Diagnostics" meta="local paths" compact />
              <div className="mcp-diagnostic-grid">
                <McpDiagnostic label="Repo" value={projectMemoryMcpConfig.repoPath} />
                <McpDiagnostic label="Server" value={projectMemoryMcpConfig.serverPath} />
                <McpDiagnostic label="Memory" value={projectMemoryMcpConfig.memoryDir} />
                <McpDiagnostic label="Activity + Wiki" value={`${shortPath(projectMemoryMcpConfig.activityDir)} - ${shortPath(projectMemoryMcpConfig.wikiDir)}`} />
              </div>
            </section>
          </section>
        </section>
      </div>
    </section>
  )
}

function McpDiagnostic({ label, value }: { label: string; value: string }) {
  return (
    <article className="mcp-diagnostic-row" title={value}>
      <span>{label}</span>
      <strong>{shortPath(value)}</strong>
    </article>
  )
}

function mcpConnectionPrompt(
  config: ProjectMemoryMcpConfig,
  memory: ProjectMemorySnapshot | null,
  wiki: ProjectWikiSnapshot | null,
  activity: ActivityLogSnapshot | null
): string {
  return [
    'Use BranchPilot MCP as the first source of local repository context for this assistant.',
    '',
    `Repository: ${config.repoPath}`,
    `Memory: ${memory ? `${memory.files.length} files, ${memory.symbols.length} symbols, scanned ${formatDate(memory.scannedAt)}` : 'not loaded'}`,
    `Wiki: ${wiki ? `${wiki.pages.length} pages, generated ${formatDate(wiki.generatedAt)}` : 'not generated'}`,
    `Change history: ${activity?.totalCount ?? 0} BranchPilot activity events plus recent commits`,
    '',
    'Read order:',
    '1. branchpilot://repo/current/live-status and branchpilot://repo/current/diff for current local work.',
    '2. branchpilot://repo/current/health to spot risky files before planning edits.',
    '3. branchpilot://repo/current/wiki for architecture and workflow intent.',
    '4. branchpilot://repo/current/worktree plus list_repository_files/read_repository_file for GitHub-like browsing.',
    '5. branchpilot://repo/current/refs, search_commit_history, get_commit_details, get_file_history, and get_repository_blame for history and ownership context.',
    '6. branchpilot://repo/current/activity and branchpilot://repo/current/commits for BranchPilot timeline context.',
    '7. branchpilot://repo/current/tree to narrow indexed file exploration.',
    '',
    'Available workflow prompts: review-current-work, prepare-change-plan, explain-module, summarize-recent-work. Start with get_live_overview for one-call session orientation. Other useful tools include project_summary, get_project_health, get_repository_status, list_repository_refs, list_repository_files, read_repository_file, get_repository_diff, search_commit_history, get_commit_details, get_file_history, get_repository_blame, get_agent_activity, list_agent_runs, get_agent_run.',
    'Before long or expensive work (full test runs, builds, migrations), check get_agent_activity for an assistant_session_note that says it already ran, and record your own via record_session_note (phase started/completed/failed) so an interrupted session never redoes it.',
    'For code-structure work — symbol graph, who-calls/who-imports, regex or full-text code search, and clone detection — use the repo-lens MCP server if it is attached; BranchPilot does not duplicate those.',
    '',
    'Treat this as a read-only BranchPilot repository bridge. It may read local files and run read-only Git commands, but it must not write files, push, pull, fetch, commit, or mutate Git state.',
    `Generic server command: ${config.serverCommand}`,
    `Codex CLI helper: ${config.codexCommand}`
  ].join('\n')
}
