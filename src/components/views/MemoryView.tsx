import { Copy, Database, Loader2, RefreshCcw, Trash2 } from 'lucide-react'
import type {
  ActivityLogEntry, ActivityLogSnapshot, ProjectMemoryMcpConfig, ProjectMemorySnapshot,
  ProjectWikiPage, ProjectWikiPageId, ProjectWikiSnapshot
} from '../../shared/branchPilot'
import type { ActivityCategory, CompletedWorkItem } from '../../lib/activityLabels'
import { activityCategoryLabel, activityMetadataLabel, activityTypeLabel, completedWorkSourceLabel } from '../../lib/activityLabels'
import { formatDate } from '../../lib/format'
import { memoryFileMeta } from '../../lib/memoryLabels'
import { InfoRow, Stat } from '../primitives'

export function MemoryView({
  projectMemory,
  memoryLoading,
  loadProjectMemory,
  scanProjectMemory,
  activityLog,
  projectMemoryMcpConfig,
  copyProjectMemoryText,
  projectWiki,
  wikiLoading,
  generateProjectWiki,
  selectedProjectWikiPage,
  setSelectedProjectWikiPageId,
  copyProjectWikiPage,
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
}: {
  projectMemory: ProjectMemorySnapshot | null
  memoryLoading: boolean
  loadProjectMemory: () => void | Promise<void>
  scanProjectMemory: () => void | Promise<void>
  activityLog: ActivityLogSnapshot | null
  projectMemoryMcpConfig: ProjectMemoryMcpConfig | null
  copyProjectMemoryText: (text: string, label: string) => void | Promise<void>
  projectWiki: ProjectWikiSnapshot | null
  wikiLoading: boolean
  generateProjectWiki: () => void | Promise<void>
  selectedProjectWikiPage: ProjectWikiPage | null
  setSelectedProjectWikiPageId: (id: ProjectWikiPageId) => void
  copyProjectWikiPage: (page: ProjectWikiPage | null) => void | Promise<void>
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
}) {
    const files = projectMemory?.files ?? []
  const symbols = projectMemory?.symbols ?? []
  const commits = projectMemory?.recentCommits ?? []

  return (
    <section className="single-panel">
      <div className="panel-heading">
        <div>
          <h2>Project Memory</h2>
          <p>Local project context index for assistant workflows.</p>
        </div>
        <div className="panel-actions">
          <button type="button" onClick={() => loadProjectMemory()} disabled={memoryLoading}>
            <RefreshCcw size={17} />
            Reload
          </button>
          <button type="button" onClick={scanProjectMemory} disabled={memoryLoading}>
            {memoryLoading ? <Loader2 className="spin" size={17} /> : <Database size={17} />}
            Rescan
          </button>
        </div>
      </div>

      {!projectMemory ? (
        <div className="quiet-box">
          {memoryLoading ? 'Scanning Project Memory.' : 'No Project Memory snapshot yet.'}
        </div>
      ) : (
        <div className="memory-workspace">
          <section className="memory-summary-grid">
            <Stat label="Indexed files" value={files.length} />
            <Stat label="Symbols" value={symbols.length} />
            <Stat label="Imports" value={projectMemory.imports.length} />
            <Stat label="Recent commits" value={commits.length} />
            <Stat label="Activity events" value={activityLog?.totalCount ?? 0} />
          </section>

          <section className="memory-meta">
            <InfoRow label="Last scan" value={formatDate(projectMemory.scannedAt)} />
            <InfoRow label="Branch" value={projectMemory.repository.currentBranch} />
            <InfoRow label="Remote" value={projectMemory.repository.remoteName ?? 'None'} />
            <InfoRow label="Repository ID" value={projectMemory.repository.id} />
          </section>

          <section className="memory-stack">
            {projectMemory.stackHints.length === 0 ? (
              <div className="quiet-box">No stack hints detected.</div>
            ) : (
              projectMemory.stackHints.map((hint) => (
                <span key={hint.id} title={hint.source}>{hint.label}</span>
              ))
            )}
          </section>

          {projectMemoryMcpConfig && (
            <section className="memory-mcp-card">
              <div className="memory-section-heading">
                <div>
                  <h3>Codex MCP setup</h3>
                  <span>{projectMemoryMcpConfig.serverExists ? 'Server build found' : 'Run npm run build before connecting'}</span>
                </div>
              </div>
              <InfoRow label="Memory dir" value={projectMemoryMcpConfig.memoryDir} />
              <InfoRow label="Activity dir" value={projectMemoryMcpConfig.activityDir} />
              <InfoRow label="Wiki dir" value={projectMemoryMcpConfig.wikiDir} />
              <InfoRow label="Server path" value={projectMemoryMcpConfig.serverPath} />
              <div className="memory-mcp-snippet">
                <div className="memory-section-heading compact">
                  <h3>CLI command</h3>
                  <button type="button" onClick={() => copyProjectMemoryText(projectMemoryMcpConfig.codexCommand, 'Codex MCP command')}>
                    <Copy size={15} />
                    Copy
                  </button>
                </div>
                <pre><code>{projectMemoryMcpConfig.codexCommand}</code></pre>
              </div>
              <div className="memory-mcp-snippet">
                <div className="memory-section-heading compact">
                  <h3>config.toml</h3>
                  <button type="button" onClick={() => copyProjectMemoryText(projectMemoryMcpConfig.codexToml, 'Codex MCP TOML')}>
                    <Copy size={15} />
                    Copy
                  </button>
                </div>
                <pre><code>{projectMemoryMcpConfig.codexToml}</code></pre>
              </div>
            </section>
          )}

          <section className="project-wiki-card">
            <div className="memory-section-heading">
              <div>
                <h3>Project Wiki</h3>
                <span>
                  {projectWiki
                    ? `${projectWiki.pages.length} pages · generated ${formatDate(projectWiki.generatedAt)}`
                    : 'Generate a local private wiki from Project Memory'}
                </span>
              </div>
              <div className="panel-actions">
                <button type="button" onClick={() => loadProjectMemory()} disabled={memoryLoading || wikiLoading}>
                  <RefreshCcw size={15} />
                  Reload
                </button>
                <button type="button" onClick={generateProjectWiki} disabled={memoryLoading || wikiLoading}>
                  {wikiLoading ? <Loader2 className="spin" size={15} /> : <Database size={15} />}
                  Generate wiki
                </button>
              </div>
            </div>

            {!projectWiki ? (
              <div className="quiet-box">
                {wikiLoading ? 'Generating Project Wiki.' : 'No Project Wiki generated yet.'}
              </div>
            ) : (
              <>
                <section className="memory-meta">
                  <InfoRow label="Generated" value={formatDate(projectWiki.generatedAt)} />
                  <InfoRow label="Source scan" value={formatDate(projectWiki.sourceMemoryScannedAt)} />
                  <InfoRow label="Repository" value={projectWiki.repository.name} />
                  <InfoRow label="Branch" value={projectWiki.repository.currentBranch} />
                </section>

                <div className="project-wiki-grid">
                  <div className="project-wiki-pages">
                    {projectWiki.pages.map((page) => (
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

                  <div className="project-wiki-preview">
                    <div className="memory-section-heading compact">
                      <h3>{selectedProjectWikiPage?.title ?? 'Wiki page'}</h3>
                      <button type="button" disabled={!selectedProjectWikiPage} onClick={() => copyProjectWikiPage(selectedProjectWikiPage)}>
                        <Copy size={15} />
                        Copy Markdown
                      </button>
                    </div>
                    <pre><code>{selectedProjectWikiPage?.markdown ?? 'Select a wiki page.'}</code></pre>
                  </div>
                </div>
              </>
            )}
          </section>

          <section className="memory-activity-card completed-work-card">
            <div className="memory-section-heading">
              <div>
                <h3>Completed Work</h3>
                <span>{completedWorkItems.length} finished work item{completedWorkItems.length === 1 ? '' : 's'} from Git history and completed operations</span>
              </div>
            </div>
            <div className="completed-work-list">
              {completedWorkItems.length === 0 ? (
                <div className="quiet-box">Generate Project Memory or make a commit to build completed work history.</div>
              ) : (
                completedWorkItems.map((item) => (
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

          <section className="memory-activity-card">
            <div className="memory-section-heading">
              <div>
                <h3>Raw Activity Events</h3>
                <span>{activityLog?.totalCount ?? 0} technical events stored locally</span>
              </div>
              <div className="panel-actions">
                <button type="button" onClick={() => loadProjectMemory()} disabled={memoryLoading}>
                  <RefreshCcw size={15} />
                  Reload
                </button>
                <button className="danger-button" type="button" onClick={clearActivityLog} disabled={memoryLoading || !activityLog?.totalCount}>
                  <Trash2 size={15} />
                  Clear
                </button>
              </div>
            </div>
            <div className="segmented memory-activity-filters" aria-label="Activity filters">
              {activityCategories.map((category) => (
                <button
                  className={activityCategory === category ? 'active' : ''}
                  type="button"
                  key={category}
                  onClick={() => setActivityCategory(category)}
                >
                  {activityCategoryLabel(category)}
                </button>
              ))}
            </div>
            <div className="memory-activity-list">
              {filteredActivityEntries.length === 0 ? (
                <div className="quiet-box">No activity for this filter.</div>
              ) : (
                <>
                  {filteredActivityEntries.slice(0, 40).map((entry) => (
                    <article className={`activity-row activity-${entry.status}`} key={entry.id}>
                      <div>
                        <strong>{activityTypeLabel(entry.type)}</strong>
                        <span>{entry.actor} · {entry.status} · {formatDate(entry.createdAt)}</span>
                      </div>
                      <code>{activityMetadataLabel(entry)}</code>
                    </article>
                  ))}
                  {filteredActivityEntries.length > 40 && (
                    <div className="quiet-box">Showing 40 of {filteredActivityEntries.length} loaded events.</div>
                  )}
                </>
              )}
            </div>
          </section>

          <section className="memory-grid">
            <div className="memory-list">
              <div className="memory-section-heading">
                <h3>Files</h3>
                <span>{files.length}</span>
              </div>
              {files.length === 0 ? (
                <div className="quiet-box">No indexed files.</div>
              ) : (
                files.slice(0, 250).map((file) => (
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

            <div className="memory-details">
              <div className="memory-section-heading">
                <h3>{selectedMemoryFile?.path ?? 'File outline'}</h3>
                <span>{selectedMemorySymbols.length} symbols</span>
              </div>

              {!selectedMemoryFile ? (
                <div className="quiet-box">Select an indexed file.</div>
              ) : (
                <>
                  <div className="memory-outline">
                    {selectedMemorySymbols.length === 0 ? (
                      <div className="quiet-box">No symbols detected in this file.</div>
                    ) : (
                      selectedMemorySymbols.map((symbol) => (
                        <article className="memory-symbol-row" key={symbol.id}>
                          <span>{symbol.kind}</span>
                          <strong>{symbol.parentName ? `${symbol.parentName}.${symbol.name}` : symbol.name}</strong>
                          <code>{symbol.exported ? 'exported' : 'local'} · line {symbol.line}</code>
                        </article>
                      ))
                    )}
                  </div>

                  <div className="memory-section-heading compact">
                    <h3>Imports</h3>
                    <span>{selectedMemoryImports.length}</span>
                  </div>
                  <div className="memory-imports">
                    {selectedMemoryImports.length === 0 ? (
                      <div className="quiet-box">No imports detected.</div>
                    ) : (
                      selectedMemoryImports.map((entry) => (
                        <code key={`${entry.path}-${entry.line}-${entry.source}`}>
                          {entry.source}{entry.specifiers.length > 0 ? ` · ${entry.specifiers.join(', ')}` : ''} · line {entry.line}
                        </code>
                      ))
                    )}
                  </div>
                </>
              )}
            </div>

            <div className="memory-list recent-memory-commits">
              <div className="memory-section-heading">
                <h3>Recent commits</h3>
                <span>{commits.length > 12 ? `12 of ${commits.length}` : commits.length}</span>
              </div>
              {commits.length === 0 ? (
                <div className="quiet-box">No commits indexed.</div>
              ) : (
                commits.slice(0, 12).map((commit) => (
                  <article className="memory-commit-row" key={commit.sha}>
                    <strong>{commit.subject || '(no subject)'}</strong>
                    <span>{commit.shortSha} · {formatDate(commit.authoredAt)}</span>
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
