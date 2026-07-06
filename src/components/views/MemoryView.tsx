import {
  BookOpen, Bot, Cable, CheckCircle2, Clock3, Database, FileCode2,
  Copy, Download, FolderOpen, History, Save, Server, Trash2, Upload
} from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { SegmentedControl } from '../SegmentedControl'
import { CopyableCodeBlock } from '../CopyableCodeBlock'
import { SignalStatus } from '../SignalStatus'
import { AssistantModelSelect, type AssistantPromptPreview } from '../AssistantModelSelect'
import type {
  AssistantId, AssistantStatus,
  ActivityLogEntry, ActivityLogSnapshot, ProjectMemoryMcpConfig, ProjectMemorySnapshot,
  ProjectWikiPage, ProjectWikiPageId, ProjectWikiSnapshot
} from '../../shared/branchPilot'
import type { ActivityCategory, CompletedWorkItem } from '../../lib/activityLabels'
import { activityCategoryLabel, activityMetadataLabel, activityTypeLabel, completedWorkSourceLabel } from '../../lib/activityLabels'
import { formatBytes, formatDate } from '../../lib/format'
import { memoryFileMeta } from '../../lib/memoryLabels'
import {
  sortedMemoryFiles,
  summarizeMemoryFolders
} from '../../lib/projectMemorySignals'

interface MemoryViewProps {
  projectMemory: ProjectMemorySnapshot | null
  memoryLoading: boolean
  scanProjectMemory: () => void | Promise<void>
  openRepoInEditor: () => void | Promise<void>
  activityLog: ActivityLogSnapshot | null
  completedWorkItems: CompletedWorkItem[]
  clearActivityLog: () => void | Promise<void>
  activityCategories: ActivityCategory[]
  activityCategory: ActivityCategory
  setActivityCategory: (category: ActivityCategory) => void
  filteredActivityEntries: ActivityLogEntry[]
  selectedMemoryFilePath: string | null
  setSelectedMemoryFilePath: (path: string) => void
  selectedMemoryFile: ProjectMemorySnapshot['files'][number] | null
  selectedMemorySymbols: ProjectMemorySnapshot['symbols']
  selectedMemoryImports: ProjectMemorySnapshot['imports']
}

interface ProjectWikiViewProps {
  projectWiki: ProjectWikiSnapshot | null
  projectMemory: ProjectMemorySnapshot | null
  memoryLoading: boolean
  wikiLoading: boolean
  generateProjectWiki: () => void | Promise<void>
  selectedProjectWikiPage: ProjectWikiPage | null
  setSelectedProjectWikiPageId: (id: ProjectWikiPageId) => void
  copyProjectWikiPage: (page: ProjectWikiPage | null) => void | Promise<void>
  saveProjectWikiPage: (page: ProjectWikiPage | null, markdown: string) => void | Promise<void>
  pullProjectWikiFromGitHub: () => void | Promise<void>
  pushProjectWikiToGitHub: () => void | Promise<void>
  selectedAssistant: AssistantId
  setSelectedAssistant: (assistant: AssistantId) => void
  assistants: AssistantStatus[]
  assistantsChecking: boolean
  checkAssistants: () => void | Promise<void>
}

interface McpSetupViewProps {
  projectMemoryMcpConfig: ProjectMemoryMcpConfig | null
  projectMemory: ProjectMemorySnapshot | null
  projectWiki: ProjectWikiSnapshot | null
  activityLog: ActivityLogSnapshot | null
  copyProjectMemoryText: (text: string, label: string) => void | Promise<void>
}

export function MemoryView({
  projectMemory,
  memoryLoading,
  scanProjectMemory,
  openRepoInEditor,
  activityLog,
  completedWorkItems,
  clearActivityLog,
  activityCategories,
  activityCategory,
  setActivityCategory,
  filteredActivityEntries,
  selectedMemoryFilePath,
  setSelectedMemoryFilePath,
  selectedMemoryFile,
  selectedMemorySymbols,
  selectedMemoryImports
}: MemoryViewProps) {
  const files = projectMemory?.files ?? []
  const symbols = projectMemory?.symbols ?? []
  const visibleActivitySource = useMemo(
    () => filteredActivityEntries.filter(isUsefulMemoryActivity),
    [filteredActivityEntries]
  )
  const visibleActivity = visibleActivitySource.slice(0, 18)
  const visibleFiles = sortedMemoryFiles(files).slice(0, 320)
  const topFolders = summarizeMemoryFolders(files, 5)
  const completedPreview = completedWorkItems.slice(0, 6)
  const visibleMemorySymbols = useMemo(() => compactMemorySymbols(selectedMemorySymbols), [selectedMemorySymbols])
  const visibleMemoryImports = useMemo(() => compactMemoryImports(selectedMemoryImports), [selectedMemoryImports])
  const memoryHeadingDetail = projectMemory ? (
    <span className="memory-heading-metrics">
      <span className="metric-files">{files.length.toLocaleString()} files</span>
      <span className="metric-symbols">{symbols.length.toLocaleString()} symbols</span>
      <span className="metric-imports">{projectMemory.imports.length.toLocaleString()} imports</span>
      <span className="metric-scan">scanned {formatDate(projectMemory.scannedAt)}</span>
    </span>
  ) : 'Files, symbols, imports, and local BranchPilot activity.'

  return (
    <section className="single-panel branchpilot-memory-panel memory-index-panel">
      <MemoryPanelHeading
        title="Memory"
        detail={memoryHeadingDetail}
        actions={(
          <button type="button" onClick={scanProjectMemory} disabled={memoryLoading}>
            <Database size={17} />
            Rescan
          </button>
        )}
      />

      {memoryLoading && !projectMemory ? (
        <SignalStatus
          className="memory-data-loading"
          label="Scanning memory"
          detail="Indexing files, symbols, imports, and local activity."
        />
      ) : !projectMemory ? (
        <section className="memory-empty-board">
          <Database size={28} />
          <div>
            <h3>No Project Memory snapshot</h3>
            <p>Run a scan to build the local repository index.</p>
          </div>
        </section>
      ) : (
        <div className="memory-workbench">
          <section className="memory-layout-grid">
            <section className="memory-workcell memory-files-cell">
              <MemoryCellHeading icon={<FileCode2 size={16} />} title="Indexed files" meta={`${visibleFiles.length} shown`} />
              <div className="memory-index-summary">
                <MemoryChipGroup
                  label="Stack"
                  items={projectMemory.stackHints.map((hint) => hint.label)}
                  empty="No stack hints"
                />
                <MemoryChipGroup
                  label="Top paths"
                  items={topFolders.map((folder) => `${folder.label} ${folder.count}`)}
                  empty="No path signals"
                  action={(
                    <button className="memory-chip-action" type="button" onClick={openRepoInEditor}>
                      <FolderOpen size={13} />
                      Editor
                    </button>
                  )}
                />
              </div>
              <div className="memory-scroll-list">
                {files.length === 0 ? (
                  <div className="quiet-box">No indexed files.</div>
                ) : (
                  visibleFiles.map((file) => (
                    <button
                      className={selectedMemoryFilePath === file.path ? 'memory-file-row selected' : 'memory-file-row'}
                      type="button"
                      key={file.path}
                      onClick={() => setSelectedMemoryFilePath(file.path)}
                    >
                      <strong>{file.path}</strong>
                      <span>{memoryFileMeta(file)}</span>
                    </button>
                  ))
                )}
              </div>
            </section>

            <section className="memory-workcell memory-outline-cell">
              <MemoryCellHeading
                icon={<Database size={16} />}
                title={selectedMemoryFile?.path ?? 'File outline'}
                meta={selectedMemoryFile ? `${visibleMemorySymbols.length} names` : `${selectedMemorySymbols.length} symbols`}
              />
              {!selectedMemoryFile ? (
                <div className="quiet-box">Select an indexed file.</div>
              ) : (
                <div className="memory-outline-grid">
                  <section className="memory-file-summary">
                    <span>{selectedMemoryFile.language ?? (selectedMemoryFile.extension || 'file')}</span>
                    <span>{formatBytes(selectedMemoryFile.sizeBytes)}</span>
                    <span>{selectedMemoryFile.symbolCount.toLocaleString()} symbols</span>
                    <span>{selectedMemoryFile.importCount.toLocaleString()} imports</span>
                  </section>
                  <section className="memory-outline-section memory-symbols-section">
                    <MemoryCellHeading icon={<Database size={15} />} title="Symbols" meta={String(visibleMemorySymbols.length)} compact />
                    <div className="memory-scroll-list">
                      {visibleMemorySymbols.length === 0 ? (
                        <div className="quiet-box">No symbols detected.</div>
                      ) : (
                        visibleMemorySymbols.map((symbol) => (
                          <article className="memory-symbol-row" key={symbol.id}>
                            <span>{symbol.kind}</span>
                            <strong title={symbol.name}>
                              {symbol.name}
                              {symbol.count > 1 && <small>{symbol.count}x</small>}
                            </strong>
                            <code>{symbol.exported ? 'exported' : 'local'} - {formatLines(symbol.lines)}</code>
                          </article>
                        ))
                      )}
                    </div>
                  </section>
                  <div className="memory-import-stack">
                    <MemoryCellHeading icon={<Cable size={15} />} title="Imports" meta={String(visibleMemoryImports.length)} compact />
                    <div className="memory-scroll-list">
                      {visibleMemoryImports.length === 0 ? (
                        <div className="quiet-box">No imports detected.</div>
                      ) : (
                        visibleMemoryImports.map((entry) => (
                          <code key={entry.id} title={entry.title}>
                            {entry.source}{entry.specifiers.length > 0 ? ` - ${entry.specifiers.join(', ')}` : ''} - {formatLines(entry.lines)}
                            {entry.count > 1 ? ` - ${entry.count} uses` : ''}
                          </code>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              )}
            </section>

            <section className="memory-workcell memory-history-cell">
              <div className="memory-history-head">
                <MemoryCellHeading icon={<History size={16} />} title="Activity" meta={`${visibleActivitySource.length} shown`} />
                <button className="danger-button icon-button" type="button" onClick={clearActivityLog} disabled={memoryLoading || !activityLog?.totalCount} title="Clear activity log">
                  <Trash2 size={15} />
                </button>
              </div>
              <SegmentedControl
                className="memory-activity-filters"
                ariaLabel="Activity filters"
                value={activityCategory}
                onChange={(value) => setActivityCategory(value as ActivityCategory)}
                options={activityCategories.map((category) => ({
                  value: category,
                  label: activityCategoryLabel(category)
                }))}
              />
              <section className="memory-activity-section">
                <div className="memory-scroll-list activity">
                  {visibleActivity.length === 0 ? (
                    <div className="quiet-box">No BranchPilot activity for this filter.</div>
                  ) : (
                    visibleActivity.map((entry) => (
                      <article className={`activity-row activity-${entry.status}`} key={entry.id}>
                        <div>
                          <strong>{activityTypeLabel(entry.type)}</strong>
                          <span>{entry.actor} - {entry.status} - {formatDate(entry.createdAt)}</span>
                        </div>
                        <code>{activityMetadataLabel(entry)}</code>
                      </article>
                    ))
                  )}
                </div>
              </section>
            </section>
          </section>

          <section className="memory-completed-strip">
            <MemoryCellHeading
              icon={<CheckCircle2 size={16} />}
              title="Completed work"
              meta={completedWorkItems.length > completedPreview.length ? `${completedPreview.length} of ${completedWorkItems.length}` : `${completedWorkItems.length} items`}
              compact
            />
            <div className="completed-work-list compact">
              {completedPreview.length === 0 ? (
                <div className="quiet-box">No completed work indexed yet.</div>
              ) : (
                completedPreview.map((item) => (
                  <article className={`completed-work-row source-${item.source}`} key={item.id}>
                    <div>
                      <strong>{item.title}</strong>
                      <span>{item.meta}</span>
                    </div>
                    <em>{completedWorkSourceLabel(item.source)}</em>
                  </article>
                ))
              )}
            </div>
          </section>
        </div>
      )}
    </section>
  )
}

export function ProjectWikiView({
  projectWiki,
  projectMemory,
  memoryLoading,
  wikiLoading,
  generateProjectWiki,
  selectedProjectWikiPage,
  setSelectedProjectWikiPageId,
  copyProjectWikiPage,
  saveProjectWikiPage,
  pullProjectWikiFromGitHub,
  pushProjectWikiToGitHub,
  selectedAssistant,
  setSelectedAssistant,
  assistants,
  assistantsChecking,
  checkAssistants
}: ProjectWikiViewProps) {
  const pages = projectWiki?.pages ?? []
  const [markdownDraft, setMarkdownDraft] = useState('')
  const wikiPrompt = useMemo(() => projectWikiGenerationPrompt(projectMemory, projectWiki), [projectMemory, projectWiki])
  const wikiPrompts = useMemo<AssistantPromptPreview[]>(() => [{
    id: 'project-wiki',
    title: 'Project Wiki generation',
    subtitle: 'editable markdown pages',
    body: wikiPrompt
  }], [wikiPrompt])
  const markdownDirty = Boolean(selectedProjectWikiPage && markdownDraft !== selectedProjectWikiPage.markdown)
  const wikiMeta = projectWiki
    ? `${pages.length} pages - generated ${formatDate(projectWiki.generatedAt)} - scan ${formatDate(projectWiki.sourceMemoryScannedAt)}${projectWiki.markdownDir ? ` - md ${shortPath(projectWiki.markdownDir)}` : ''}`
    : projectMemory
      ? `${projectMemory.files.length} files indexed - ${projectMemory.repository.currentBranch}`
      : 'Scan Project Memory before generating wiki'

  useEffect(() => {
    setMarkdownDraft(selectedProjectWikiPage?.markdown ?? '')
  }, [selectedProjectWikiPage?.id, selectedProjectWikiPage?.markdown])

  return (
    <section className="single-panel branchpilot-memory-panel project-wiki-panel">
      <header className="wiki-command-bar">
        <div className="wiki-title-block">
          <div>
            <h2>Project Wiki</h2>
            <p>{wikiMeta}</p>
          </div>
        </div>
        <div className="wiki-command-actions">
          <div className="wiki-assistant-control">
            <AssistantModelSelect
              id="project-wiki-assistant"
              label="Assistant"
              selectedAssistant={selectedAssistant}
              setSelectedAssistant={setSelectedAssistant}
              assistants={assistants}
              assistantsChecking={assistantsChecking}
              checkAssistants={checkAssistants}
              prompts={wikiPrompts}
              promptsAriaLabel="Project Wiki generation prompt"
            />
          </div>
          <div className="panel-actions memory-actions wiki-actions">
            <button type="button" onClick={generateProjectWiki} disabled={memoryLoading || wikiLoading}>
              <Bot size={17} />
              Build local wiki
            </button>
          </div>
        </div>
      </header>

      {wikiLoading && !projectWiki ? (
        <SignalStatus
          className="memory-data-loading"
          label="Generating wiki"
          detail="Building pages from Memory, commits, and BranchPilot activity."
        />
      ) : !projectWiki ? (
        <section className="memory-empty-board">
          <BookOpen size={28} />
          <div>
            <h3>No Project Wiki generated</h3>
            <p>Generate wiki pages after scanning Project Memory.</p>
          </div>
          <button type="button" onClick={generateProjectWiki} disabled={memoryLoading || wikiLoading}>
            <Bot size={16} />
            Build local wiki
          </button>
        </section>
      ) : (
        <div className="wiki-workbench">
          <section className="wiki-browser-grid">
            <section className="memory-workcell wiki-pages-cell">
              <MemoryCellHeading icon={<BookOpen size={16} />} title="Pages" meta={`${pages.length} pages`} />
              <div className="memory-scroll-list wiki-pages">
                {pages.map((page) => (
                  <button
                    className={selectedProjectWikiPage?.id === page.id ? 'project-wiki-page selected' : 'project-wiki-page'}
                    type="button"
                    key={page.id}
                    onClick={() => setSelectedProjectWikiPageId(page.id)}
                  >
                    <strong>{page.title}</strong>
                    <span>{page.summary}</span>
                  </button>
                ))}
              </div>
            </section>

            <section className="memory-workcell wiki-preview-cell">
              <div className="project-wiki-editor">
                <header>
                  <div>
                    <h3>{selectedProjectWikiPage?.title ?? 'Wiki page'}</h3>
                    <span>
                      {selectedProjectWikiPage
                        ? `${projectWikiMarkdownFileLabel(selectedProjectWikiPage)}${markdownDirty ? ' - edited' : ''}`
                        : 'Select a wiki page'}
                    </span>
                  </div>
                  <div className="project-wiki-editor-actions">
                    <button type="button" onClick={() => copyProjectWikiPage(selectedProjectWikiPage)} disabled={!selectedProjectWikiPage}>
                      <Copy size={15} />
                      Copy
                    </button>
                    <button type="button" onClick={() => saveProjectWikiPage(selectedProjectWikiPage, markdownDraft)} disabled={!selectedProjectWikiPage || !markdownDirty || wikiLoading}>
                      <Save size={15} />
                      Save
                    </button>
                    <button type="button" onClick={pullProjectWikiFromGitHub} disabled={memoryLoading || wikiLoading}>
                      <Download size={15} />
                      Pull GitHub
                    </button>
                    <button type="button" onClick={pushProjectWikiToGitHub} disabled={!projectWiki || memoryLoading || wikiLoading}>
                      <Upload size={15} />
                      Push GitHub
                    </button>
                  </div>
                </header>
                <textarea
                  aria-label="Project Wiki Markdown editor"
                  spellCheck={false}
                  value={markdownDraft}
                  disabled={!selectedProjectWikiPage}
                  onChange={(event) => setMarkdownDraft(event.currentTarget.value)}
                  placeholder="Select a Project Wiki page."
                />
              </div>
            </section>
          </section>
        </div>
      )}
    </section>
  )
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
      title: 'Code index',
      uri: 'branchpilot://repo/current/tree + symbols',
      detail: 'Indexed file tree, imports, and exported/local symbols for fast code navigation.'
    }
  ]
  const mcpToolGroups = [
    {
      title: 'Orient',
      tools: ['project_summary', 'get_project_health', 'get_repository_status', 'list_repository_refs', 'get_project_wiki']
    },
    {
      title: 'Browse repo',
      tools: ['list_repository_files', 'read_repository_file', 'search_repository_text', 'search_files', 'search_symbols']
    },
    {
      title: 'Review changes',
      tools: ['get_repository_diff', 'get_commit_details', 'search_commit_history', 'get_file_history', 'get_repository_blame']
    },
    {
      title: 'Trace work',
      tools: ['get_recent_commits', 'get_agent_activity', 'get_file_outline', 'get_symbol_context', 'get_wiki_page']
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
      meta: 'No file writes or Git mutation',
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
                <button type="button" onClick={() => copyProjectMemoryText(prompt, 'BranchPilot MCP prompt')}>
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

function projectWikiGenerationPrompt(
  memory: ProjectMemorySnapshot | null,
  wiki: ProjectWikiSnapshot | null
): string {
  const repository = memory?.repository ?? wiki?.repository
  const stackHints = memory?.stackHints.map((hint) => `${hint.label} (${hint.source})`).join(', ') || 'not scanned'

  return [
    'Generate a BranchPilot Project Wiki for Claude Code, Codex, and future local assistants.',
    'The wiki must be practical architecture documentation, not marketing copy.',
    'Treat BranchPilot Project Wiki as local private Markdown wiki pages. It may be pushed to GitHub Wiki later, but do not assume GitHub Wiki already exists.',
    '',
    `Repository: ${repository?.name ?? 'current repository'}`,
    `Branch: ${repository?.currentBranch ?? 'current branch'}`,
    `Indexed files: ${memory?.files.length ?? 0}`,
    `Indexed symbols: ${memory?.symbols.length ?? 0}`,
    `Indexed imports: ${memory?.imports.length ?? 0}`,
    `Stack hints: ${stackHints}`,
    '',
    'Required Markdown pages:',
    '1. Home.md: repository purpose, stack, current branch, important constraints, and links to the other pages.',
    '2. Module-Map.md: every meaningful top-level and second-level module folder; component/service/module boundaries.',
    '3. Folder-Structure.md: what belongs in each folder and which paths are low-signal generated/cache/build output.',
    '4. Technology-Map.md: frameworks, runtimes, package managers, build/runtime entrypoints, configs, and provider/API layers.',
    '5. Important-Symbols.md: exported components/services/types and why they matter.',
    '6. Workflows.md: how user-facing flows move across UI, services, Electron, provider/API, and Git layers.',
    '7. Assistant-Policy.md: what local assistants should read first, what not to mutate, and MCP usage order.',
    '8. Recent-Timeline.md: recent commits/activity only when it changes architectural understanding.',
    '',
    'Rules:',
    '- Prefer concrete repository paths and symbols from Project Memory.',
    '- Do not invent modules, technologies, metrics, users, or production claims.',
    '- Every page must be valid Markdown and stay under 500 lines.',
    '- Keep each page useful under token pressure: short sections, dense bullets, clear cross-links.',
    '- Add relative wiki links like [Technology Map](Technology-Map.md) where they help navigation.',
    '- If a folder is only generated assets/cache/build output, mark it as low-signal or omit it.',
    '- Do not duplicate Memory index data unless it explains architecture.',
    '- Write pages that can be stored locally and optionally pushed to GitHub Wiki.'
  ].join('\n')
}

function MemoryPanelHeading({
  title,
  detail,
  actions
}: {
  title: string
  detail: ReactNode
  actions?: ReactNode
}) {
  return (
    <div className="memory-panel-heading">
      <div>
        <h2>{title}</h2>
        <p>{detail}</p>
      </div>
      {actions && <div className="panel-actions memory-actions">{actions}</div>}
    </div>
  )
}

function MemoryCellHeading({
  icon,
  title,
  meta,
  compact = false
}: {
  icon: ReactNode
  title: string
  meta: string
  compact?: boolean
}) {
  return (
    <div className={compact ? 'memory-cell-heading compact' : 'memory-cell-heading'}>
      <div>
        {icon}
        <h3>{title}</h3>
      </div>
      <span>{meta}</span>
    </div>
  )
}

function MemoryChipGroup({
  label,
  items,
  empty,
  action
}: {
  label: string
  items: string[]
  empty: string
  action?: ReactNode
}) {
  const visibleItems = items.slice(0, 6)

  return (
    <div className={action ? 'memory-chip-row with-action' : 'memory-chip-row'}>
      <span>{label}</span>
      <div>
        {visibleItems.length === 0 ? (
          <em>{empty}</em>
        ) : (
          visibleItems.map((item) => <code key={item}>{item}</code>)
        )}
      </div>
      {action}
    </div>
  )
}

function isUsefulMemoryActivity(entry: ActivityLogEntry): boolean {
  return entry.type !== 'repository_opened' && entry.type !== 'repository_refreshed'
}

interface MemorySymbolGroup {
  id: string
  kind: string
  name: string
  exported: boolean
  lines: number[]
  count: number
}

function compactMemorySymbols(symbols: ProjectMemorySnapshot['symbols']): MemorySymbolGroup[] {
  const groups = new Map<string, MemorySymbolGroup>()

  for (const symbol of symbols) {
    const name = symbol.parentName ? `${symbol.parentName}.${symbol.name}` : symbol.name
    const key = `${symbol.kind}:${name}:${symbol.exported ? 'exported' : 'local'}`
    const group = groups.get(key) ?? {
      id: key,
      kind: symbol.kind,
      name,
      exported: symbol.exported,
      lines: [],
      count: 0
    }

    group.lines.push(symbol.line)
    group.count += 1
    groups.set(key, group)
  }

  return [...groups.values()]
    .map((group) => ({ ...group, lines: [...new Set(group.lines)].sort((left, right) => left - right) }))
    .sort((left, right) => (left.lines[0] ?? 0) - (right.lines[0] ?? 0) || left.name.localeCompare(right.name))
}

interface MemoryImportGroup {
  id: string
  source: string
  specifiers: string[]
  lines: number[]
  count: number
  title: string
}

function compactMemoryImports(imports: ProjectMemorySnapshot['imports']): MemoryImportGroup[] {
  const groups = new Map<string, MemoryImportGroup>()

  for (const entry of imports) {
    const specifiers = [...new Set(entry.specifiers)].sort()
    const key = `${entry.source}:${specifiers.join(',')}`
    const group = groups.get(key) ?? {
      id: key,
      source: entry.source,
      specifiers,
      lines: [],
      count: 0,
      title: ''
    }

    group.lines.push(entry.line)
    group.count += 1
    group.title = `${entry.source}${specifiers.length > 0 ? ` - ${specifiers.join(', ')}` : ''}`
    groups.set(key, group)
  }

  return [...groups.values()]
    .map((group) => ({ ...group, lines: [...new Set(group.lines)].sort((left, right) => left - right) }))
    .sort((left, right) => (left.lines[0] ?? 0) - (right.lines[0] ?? 0) || left.source.localeCompare(right.source))
}

function formatLines(lines: number[]): string {
  if (lines.length === 0) return 'no lines'
  if (lines.length === 1) return `line ${lines[0]}`

  const preview = lines.slice(0, 4).join(', ')
  return lines.length > 4 ? `lines ${preview} +${lines.length - 4}` : `lines ${preview}`
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
    '4. branchpilot://repo/current/worktree plus list_repository_files/read_repository_file/search_repository_text for GitHub-like browsing.',
    '5. branchpilot://repo/current/refs, search_commit_history, get_commit_details, get_file_history, and get_repository_blame for history and ownership context.',
    '6. branchpilot://repo/current/activity and branchpilot://repo/current/commits for BranchPilot timeline context.',
    '7. branchpilot://repo/current/tree and branchpilot://repo/current/symbols to narrow indexed exploration.',
    '',
    'Available workflow prompts: review-current-work, prepare-change-plan, explain-module, summarize-recent-work. Useful tools include project_summary, get_project_health, get_repository_status, list_repository_refs, list_repository_files, read_repository_file, search_repository_text, get_repository_diff, search_commit_history, get_commit_details, get_file_history, get_repository_blame, search_files, search_symbols, get_file_outline, get_symbol_context.',
    '',
    'Treat this as a read-only BranchPilot repository bridge. It may read local files and run read-only Git commands, but it must not write files, push, pull, fetch, commit, or mutate Git state.',
    `Generic server command: ${config.serverCommand}`,
    `Codex CLI helper: ${config.codexCommand}`
  ].join('\n')
}

function shortPath(value: string): string {
  const parts = value.split('/').filter(Boolean)

  if (parts.length <= 4) {
    return value
  }

  return `.../${parts.slice(-3).join('/')}`
}

function projectWikiMarkdownFileLabel(page: ProjectWikiPage): string {
  const knownNames: Record<string, string> = {
    overview: 'Home.md',
    module_map: 'Module-Map.md',
    folder_structure: 'Folder-Structure.md',
    technology_map: 'Technology-Map.md',
    important_symbols: 'Important-Symbols.md',
    workflows: 'Workflows.md',
    assistant_policy: 'Assistant-Policy.md',
    recent_timeline: 'Recent-Timeline.md'
  }

  if (knownNames[page.id]) {
    return knownNames[page.id]
  }

  const fileName = page.title
    .trim()
    .replace(/\.md$/i, '')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')

  return `${fileName || 'Wiki-Page'}.md`
}
