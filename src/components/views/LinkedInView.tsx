import { useState } from 'react'
import { Clipboard, Loader2, RotateCcw, Settings2, Star } from 'lucide-react'
import type { GeneratedLinkedInProject, RepositorySnapshot } from '../../shared/branchPilot'

export function LinkedInView({
  generateLinkedInProject,
  snapshot,
  busy,
  linkedinLoading,
  canGenerateLinkedInProject,
  linkedinProject,
  updateLinkedInProject,
  linkedinHighlightsText,
  setLinkedinHighlightsText,
  linkedinTagsText,
  setLinkedinTagsText,
  linkedinSkillsText,
  setLinkedinSkillsText,
  linkedinRole,
  setLinkedInRole,
  linkedinAudience,
  setLinkedInAudience,
  linkedinProjectUrl,
  setLinkedInProjectUrl,
  linkedinCustomPrompt,
  setLinkedInCustomPrompt,
  resetLinkedInPrompt,
  copyLinkedInMarkdown,
  copyLinkedInTags
}: {
  generateLinkedInProject: () => void | Promise<void>
  snapshot: RepositorySnapshot | null
  busy: boolean
  linkedinLoading: boolean
  canGenerateLinkedInProject: boolean
  linkedinProject: GeneratedLinkedInProject | null
  updateLinkedInProject: (update: Partial<GeneratedLinkedInProject>) => void
  linkedinHighlightsText: string
  setLinkedinHighlightsText: (value: string) => void
  linkedinTagsText: string
  setLinkedinTagsText: (value: string) => void
  linkedinSkillsText: string
  setLinkedinSkillsText: (value: string) => void
  linkedinRole: string
  setLinkedInRole: (value: string) => void
  linkedinAudience: string
  setLinkedInAudience: (value: string) => void
  linkedinProjectUrl: string
  setLinkedInProjectUrl: (value: string) => void
  linkedinCustomPrompt: string
  setLinkedInCustomPrompt: (value: string) => void
  resetLinkedInPrompt: () => void
  copyLinkedInMarkdown: () => void | Promise<void>
  copyLinkedInTags: () => void | Promise<void>
}) {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const generateTitle = !snapshot
    ? 'Open a repository before generating LinkedIn content'
    : busy
      ? 'Another repository operation is running'
      : linkedinLoading
        ? 'Generating LinkedIn project'
        : canGenerateLinkedInProject
          ? 'Generate a LinkedIn project draft from this repository'
          : 'LinkedIn project generation is blocked by assistant policy'

  const updateHighlights = (value: string) => {
    setLinkedinHighlightsText(value)
    updateLinkedInProject({ highlights: value.split('\n').map((item) => item.trim()).filter(Boolean) })
  }
  const updateTags = (value: string) => {
    setLinkedinTagsText(value)
    updateLinkedInProject({ tags: splitCommaList(value) })
  }
  const updateSkills = (value: string) => {
    setLinkedinSkillsText(value)
    updateLinkedInProject({ skills: splitCommaList(value) })
  }

  return (
    <section className="single-panel linkedin-panel">
      <div className="panel-heading linkedin-heading">
        <div>
          <h2>LinkedIn Project</h2>
          <p>Draft a LinkedIn Projects entry from this repository.</p>
        </div>
        <div className="linkedin-heading-actions">
          <button
            className={settingsOpen ? 'icon-button active' : 'icon-button'}
            type="button"
            onClick={() => setSettingsOpen((open) => !open)}
            title="LinkedIn generation settings"
            aria-label="LinkedIn generation settings"
          >
            <Settings2 size={17} />
          </button>
          <button
            type="button"
            onClick={generateLinkedInProject}
            disabled={!snapshot || busy || linkedinLoading || !canGenerateLinkedInProject}
            title={generateTitle}
          >
            {linkedinLoading ? <Loader2 className="spin" size={17} /> : <Star size={17} />}
            Generate
          </button>
        </div>
      </div>

      {settingsOpen && (
        <section className="linkedin-settings linkedin-card">
          <div className="linkedin-settings-grid">
            <label className="linkedin-field">
              Preferred role
              <input
                value={linkedinRole}
                onChange={(event) => setLinkedInRole(event.target.value)}
                placeholder="Creator, maintainer, desktop app developer"
              />
            </label>
            <label className="linkedin-field">
              Audience
              <input
                value={linkedinAudience}
                onChange={(event) => setLinkedInAudience(event.target.value)}
                placeholder="LinkedIn project section"
              />
            </label>
            <label className="linkedin-field">
              Project URL override
              <input
                value={linkedinProjectUrl}
                onChange={(event) => setLinkedInProjectUrl(event.target.value)}
                placeholder="https://github.com/owner/repo"
              />
            </label>
            <label className="linkedin-field linkedin-prompt-field">
              Prompt preferences
              <textarea
                value={linkedinCustomPrompt}
                onChange={(event) => setLinkedInCustomPrompt(event.target.value)}
                placeholder="Tone, structure, claims to avoid, focus areas..."
              />
            </label>
          </div>
          <div className="linkedin-settings-actions">
            <button type="button" className="secondary-button" onClick={resetLinkedInPrompt} title="Restore the default LinkedIn prompt preferences">
              <RotateCcw size={15} />
              Reset prompt
            </button>
          </div>
        </section>
      )}

      {!linkedinProject ? (
        <section className="review-empty linkedin-empty linkedin-card">
          <Star size={24} />
          <strong>{linkedinLoading ? 'Generating LinkedIn project' : 'No LinkedIn draft yet'}</strong>
          <span>{snapshot ? 'Generate a saved project entry from commits, tracked files, README, and package metadata.' : 'Open a repository before generating LinkedIn content.'}</span>
        </section>
      ) : (
        <div className="linkedin-workspace">
          <section className="linkedin-draft linkedin-card">
            <label className="linkedin-field">
              Project name
              <input
                value={linkedinProject.projectName}
                onChange={(event) => updateLinkedInProject({ projectName: event.target.value })}
              />
            </label>

            <label className="linkedin-field">
              Headline
              <input
                value={linkedinProject.headline}
                onChange={(event) => updateLinkedInProject({ headline: event.target.value })}
              />
            </label>

            <label className="linkedin-field">
              Project URL
              <input
                value={linkedinProject.urlSuggestion}
                onChange={(event) => updateLinkedInProject({ urlSuggestion: event.target.value })}
              />
            </label>

            <div className="linkedin-field-grid">
              <label>
                Role
                <input
                  value={linkedinProject.role}
                  onChange={(event) => updateLinkedInProject({ role: event.target.value })}
                  placeholder="Creator"
                />
              </label>
              <label>
                Start date
                <input
                  value={linkedinProject.startDate}
                  onChange={(event) => updateLinkedInProject({ startDate: event.target.value })}
                  placeholder="2026-06"
                />
              </label>
              <label>
                End date
                <input
                  value={linkedinProject.endDate}
                  onChange={(event) => updateLinkedInProject({ endDate: event.target.value })}
                  placeholder="Present"
                />
              </label>
            </div>

            <label className="linkedin-field">
              Description
              <textarea
                className="linkedin-description"
                value={linkedinProject.description}
                onChange={(event) => updateLinkedInProject({ description: event.target.value })}
              />
            </label>
          </section>

          <aside className="linkedin-side">
            <section className="linkedin-card linkedin-list-card">
              <label className="linkedin-field">
                Highlights
                <textarea
                  value={linkedinHighlightsText}
                  onChange={(event) => updateHighlights(event.target.value)}
                  placeholder="One bullet per line"
                />
              </label>
              <label className="linkedin-field">
                Technologies
                <input
                  value={linkedinSkillsText}
                  onChange={(event) => updateSkills(event.target.value)}
                  placeholder="TypeScript, Electron, React, Vite"
                />
              </label>
              <label className="linkedin-field">
                Tags
                <input
                  value={linkedinTagsText}
                  onChange={(event) => updateTags(event.target.value)}
                  placeholder="Git, DesktopApp, DeveloperTools"
                />
              </label>
            </section>

            <section className="linkedin-card linkedin-markdown-block">
              <div className="linkedin-markdown-heading">
                <strong>Copyable Markdown</strong>
                <div className="linkedin-copy-actions">
                  <button type="button" className="secondary-button" onClick={copyLinkedInTags} title="Copy LinkedIn tags">
                    <Clipboard size={15} />
                    Tags
                  </button>
                  <button type="button" className="secondary-button" onClick={copyLinkedInMarkdown} title="Copy full LinkedIn project Markdown">
                    <Clipboard size={15} />
                    Markdown
                  </button>
                </div>
              </div>
              <textarea
                className="linkedin-markdown-editor"
                value={linkedinProject.markdown}
                onChange={(event) => updateLinkedInProject({ markdown: event.target.value })}
              />
            </section>
          </aside>
        </div>
      )}
    </section>
  )
}

function splitCommaList(value: string): string[] {
  return value.split(',').map((item) => item.trim()).filter(Boolean)
}
