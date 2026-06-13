import type { ReactNode } from 'react'
import { Copy, Loader2, Star } from 'lucide-react'
import type {
  AssistantActionKind, AssistantId, AssistantPolicyStatus, GeneratedLinkedInProject, RepositorySnapshot
} from '../../shared/branchPilot'
import { assistantPolicyBlockedLabel } from '../../lib/assistantLabels'

export function LinkedInView({
  generateLinkedInProject,
  snapshot,
  busy,
  linkedinLoading,
  canGenerateLinkedInProject,
  selectedAssistant,
  setSelectedAssistant,
  linkedinRole,
  setLinkedInRole,
  linkedinAudience,
  setLinkedInAudience,
  linkedinProjectUrl,
  setLinkedInProjectUrl,
  assistantPolicy,
  linkedinProject,
  updateLinkedInProject,
  linkedinHighlightsText,
  setLinkedinHighlightsText,
  linkedinTagsText,
  setLinkedinTagsText,
  linkedinSkillsText,
  setLinkedinSkillsText,
  copyLinkedInTags,
  copyLinkedInMarkdown,
  renderAssistantReadiness
}: {
  generateLinkedInProject: () => void | Promise<void>
  snapshot: RepositorySnapshot | null
  busy: boolean
  linkedinLoading: boolean
  canGenerateLinkedInProject: boolean
  selectedAssistant: AssistantId
  setSelectedAssistant: (assistant: AssistantId) => void
  linkedinRole: string
  setLinkedInRole: (value: string) => void
  linkedinAudience: string
  setLinkedInAudience: (value: string) => void
  linkedinProjectUrl: string
  setLinkedInProjectUrl: (value: string) => void
  assistantPolicy: AssistantPolicyStatus | null
  linkedinProject: GeneratedLinkedInProject | null
  updateLinkedInProject: (update: Partial<GeneratedLinkedInProject>) => void
  linkedinHighlightsText: string
  setLinkedinHighlightsText: (value: string) => void
  linkedinTagsText: string
  setLinkedinTagsText: (value: string) => void
  linkedinSkillsText: string
  setLinkedinSkillsText: (value: string) => void
  copyLinkedInTags: () => void | Promise<void>
  copyLinkedInMarkdown: () => void | Promise<void>
  renderAssistantReadiness: (action: AssistantActionKind) => ReactNode
}) {
    return (
    <section className="single-panel linkedin-panel">
      <div className="panel-heading">
        <div>
          <h2>LinkedIn Project</h2>
          <p>Generate editable LinkedIn project fields from repository context.</p>
        </div>
        <button type="button" onClick={generateLinkedInProject} disabled={!snapshot || busy || linkedinLoading || !canGenerateLinkedInProject}>
          {linkedinLoading ? <Loader2 className="spin" size={17} /> : <Star size={17} />}
          Generate
        </button>
      </div>

      <div className="linkedin-workspace">
        <section className="linkedin-controls">
          <label htmlFor="linkedin-assistant">Assistant</label>
          <select
            id="linkedin-assistant"
            value={selectedAssistant}
            onChange={(event) => setSelectedAssistant(event.target.value as AssistantId)}
            disabled={busy}
          >
            <option value="auto">Auto</option>
            <option value="claude">Claude Code</option>
            <option value="codex">Codex</option>
          </select>

          <label htmlFor="linkedin-role">Preferred role</label>
          <input
            id="linkedin-role"
            value={linkedinRole}
            onChange={(event) => setLinkedInRole(event.target.value)}
            placeholder="Creator, maintainer, desktop app developer"
          />

          <label htmlFor="linkedin-audience">Audience</label>
          <input
            id="linkedin-audience"
            value={linkedinAudience}
            onChange={(event) => setLinkedInAudience(event.target.value)}
            placeholder="LinkedIn project section"
          />

          <label htmlFor="linkedin-url">Project URL</label>
          <input
            id="linkedin-url"
            value={linkedinProjectUrl}
            onChange={(event) => setLinkedInProjectUrl(event.target.value)}
            placeholder={snapshot?.summary.remoteUrl ?? 'Optional'}
          />

          {!canGenerateLinkedInProject && (
            <div className="assistant-policy-note">{assistantPolicyBlockedLabel('linkedin_project', assistantPolicy)}</div>
          )}
          {renderAssistantReadiness('linkedin_project')}
        </section>

        {!linkedinProject ? (
          <section className="review-empty linkedin-empty">
            <Star size={24} />
            <strong>{linkedinLoading ? 'Generating LinkedIn project' : 'No LinkedIn draft yet'}</strong>
            <span>{snapshot ? 'Generate a project entry from commits, tracked files, README, package metadata, and repository dates.' : 'Open a repository before generating LinkedIn content.'}</span>
          </section>
        ) : (
          <section className="linkedin-draft">
            <div className="linkedin-field-grid">
              <label>
                Project name
                <input
                  value={linkedinProject.projectName}
                  onChange={(event) => updateLinkedInProject({ projectName: event.target.value })}
                />
              </label>
              <label>
                Headline
                <input
                  value={linkedinProject.headline}
                  onChange={(event) => updateLinkedInProject({ headline: event.target.value })}
                />
              </label>
              <label>
                Role
                <input
                  value={linkedinProject.role}
                  onChange={(event) => updateLinkedInProject({ role: event.target.value })}
                />
              </label>
              <label>
                Start date
                <input
                  value={linkedinProject.startDate}
                  onChange={(event) => updateLinkedInProject({ startDate: event.target.value })}
                />
              </label>
              <label>
                End date
                <input
                  value={linkedinProject.endDate}
                  onChange={(event) => updateLinkedInProject({ endDate: event.target.value })}
                />
              </label>
              <label>
                Project URL
                <input
                  value={linkedinProject.urlSuggestion}
                  onChange={(event) => updateLinkedInProject({ urlSuggestion: event.target.value })}
                />
              </label>
            </div>

            <label>
              Description
              <textarea
                value={linkedinProject.description}
                onChange={(event) => updateLinkedInProject({ description: event.target.value })}
              />
            </label>

            <label>
              Highlights
              <textarea
                value={linkedinHighlightsText}
                onChange={(event) => {
                  setLinkedinHighlightsText(event.target.value)
                  updateLinkedInProject({
                    highlights: event.target.value.split('\n').map((line) => line.trim()).filter(Boolean)
                  })
                }}
              />
            </label>

            <div className="linkedin-field-grid">
              <label>
                Tags
                <textarea
                  value={linkedinTagsText}
                  onChange={(event) => {
                    setLinkedinTagsText(event.target.value)
                    updateLinkedInProject({
                      tags: event.target.value.split(',').map((tag) => tag.trim().replace(/^#/, '')).filter(Boolean)
                    })
                  }}
                />
              </label>
              <label>
                Skills
                <textarea
                  value={linkedinSkillsText}
                  onChange={(event) => {
                    setLinkedinSkillsText(event.target.value)
                    updateLinkedInProject({
                      skills: event.target.value.split(',').map((skill) => skill.trim()).filter(Boolean)
                    })
                  }}
                />
              </label>
            </div>

            <section className="daily-section">
              <div className="daily-section-heading">
                <strong>LinkedIn Markdown</strong>
                <div className="panel-actions">
                  <button type="button" onClick={copyLinkedInTags}>
                    <Copy size={15} />
                    Tags
                  </button>
                  <button type="button" onClick={copyLinkedInMarkdown}>
                    <Copy size={15} />
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
          </section>
        )}
      </div>
    </section>
  )
}
