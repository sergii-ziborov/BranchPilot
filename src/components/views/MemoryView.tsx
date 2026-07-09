import {
  Cable, CheckCircle2, ChevronDown, Database, FileCode2, FolderOpen, History, Trash2
} from 'lucide-react'
import { useMemo } from 'react'
import { SegmentedControl } from '../SegmentedControl'
import { SignalStatus } from '../SignalStatus'
import type {
  ActivityLogEntry, ActivityLogSnapshot, ProjectMemorySnapshot
} from '../../shared/branchPilot'
import type { ActivityCategory, CompletedWorkItem } from '../../lib/activityLabels'
import { activityCategoryLabel, activityMetadataLabel, activityTypeLabel, completedWorkSourceLabel } from '../../lib/activityLabels'
import { formatBytes, formatDate } from '../../lib/format'
import { memoryFileMeta } from '../../lib/memoryLabels'
import {
  sortedMemoryFiles,
  summarizeMemoryFolders
} from '../../lib/projectMemorySignals'
import { MemoryCellHeading, MemoryChipGroup, MemoryPanelHeading } from './memory/MemoryPanelChrome'
import { AgentRunDetails } from './memory/AgentRunDetails'
import { compactMemoryImports, compactMemorySymbols, formatLines } from './memory/memoryFileOutline'
import { useAgentRunDetails } from '../../hooks/useAgentRunDetails'

export { ProjectWikiView } from './memory/ProjectWikiView'
export { McpSetupView } from './memory/McpSetupView'

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
  currentRepoPath?: string | null
  selectedMemoryFilePath: string | null
  setSelectedMemoryFilePath: (path: string) => void
  selectedMemoryFile: ProjectMemorySnapshot['files'][number] | null
  selectedMemorySymbols: ProjectMemorySnapshot['symbols']
  selectedMemoryImports: ProjectMemorySnapshot['imports']
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
  currentRepoPath,
  selectedMemoryFilePath,
  setSelectedMemoryFilePath,
  selectedMemoryFile,
  selectedMemorySymbols,
  selectedMemoryImports
}: MemoryViewProps) {
  const agentRuns = useAgentRunDetails(currentRepoPath)
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
                    visibleActivity.map((entry) => {
                      const runId = activityRunId(entry)
                      const expanded = runId !== null && agentRuns.expandedId === runId

                      return (
                        <div className="activity-row-shell" key={entry.id}>
                          {runId ? (
                            <button
                              type="button"
                              className={`activity-row activity-${entry.status} activity-row-expandable${expanded ? ' expanded' : ''}`}
                              aria-expanded={expanded}
                              onClick={() => agentRuns.toggle(runId)}
                            >
                              <div>
                                <strong>{activityTypeLabel(entry.type)}</strong>
                                <span>{entry.actor} - {entry.status} - {formatDate(entry.createdAt)}</span>
                              </div>
                              <code>{activityMetadataLabel(entry)}</code>
                              <ChevronDown className="activity-row-caret" size={15} aria-hidden="true" />
                            </button>
                          ) : (
                            <article className={`activity-row activity-${entry.status}`}>
                              <div>
                                <strong>{activityTypeLabel(entry.type)}</strong>
                                <span>{entry.actor} - {entry.status} - {formatDate(entry.createdAt)}</span>
                              </div>
                              <code>{activityMetadataLabel(entry)}</code>
                            </article>
                          )}
                          {expanded && (
                            <AgentRunDetails record={agentRuns.record} loading={agentRuns.loading} error={agentRuns.error} />
                          )}
                        </div>
                      )
                    })
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

function isUsefulMemoryActivity(entry: ActivityLogEntry): boolean {
  return entry.type !== 'repository_opened' && entry.type !== 'repository_refreshed'
}

/** Read the recorded agent run id from an activity entry's metadata, if present. */
function activityRunId(entry: ActivityLogEntry): string | null {
  const raw = entry.metadata.run_id ?? entry.metadata.runId

  return typeof raw === 'string' && raw.length > 0 ? raw : null
}
