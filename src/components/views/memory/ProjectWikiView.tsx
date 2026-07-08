import { BookOpen, Bot, Copy, Download, Save, Upload } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { SignalStatus } from '../../SignalStatus'
import { AssistantModelSelect, type AssistantPromptPreview } from '../../AssistantModelSelect'
import type {
  AssistantId, AssistantStatus,
  ProjectMemorySnapshot,
  ProjectWikiPage, ProjectWikiPageId, ProjectWikiSnapshot
} from '../../../shared/branchPilot'
import { formatDate } from '../../../lib/format'
import { MemoryCellHeading } from './MemoryPanelChrome'
import { shortPath } from './pathLabels'

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
