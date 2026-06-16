import { Copy, Loader2, Star } from 'lucide-react'
import type {
  AssistantPolicyStatus, GeneratedLinkedInProject, RepositorySnapshot
} from '../../shared/branchPilot'
import { assistantPolicyBlockedLabel } from '../../lib/assistantLabels'

export function LinkedInView({
  generateLinkedInProject,
  snapshot,
  busy,
  linkedinLoading,
  canGenerateLinkedInProject,
  linkedinRole,
  setLinkedInRole,
  linkedinAudience,
  setLinkedInAudience,
  linkedinProjectUrl,
  setLinkedInProjectUrl,
  assistantPolicy,
  linkedinProject,
  updateLinkedInProject,
  linkedinSkillsText,
  setLinkedinSkillsText,
  copyLinkedInMarkdown
}: {
  generateLinkedInProject: () => void | Promise<void>
  snapshot: RepositorySnapshot | null
  busy: boolean
  linkedinLoading: boolean
  canGenerateLinkedInProject: boolean
  linkedinRole: string
  setLinkedInRole: (value: string) => void
  linkedinAudience: string
  setLinkedInAudience: (value: string) => void
  linkedinProjectUrl: string
  setLinkedInProjectUrl: (value: string) => void
  assistantPolicy: AssistantPolicyStatus | null
  linkedinProject: GeneratedLinkedInProject | null
  updateLinkedInProject: (update: Partial<GeneratedLinkedInProject>) => void
  linkedinSkillsText: string
  setLinkedinSkillsText: (value: string) => void
  copyLinkedInMarkdown: () => void | Promise<void>
}) {
  return (
    <section className="single-panel linkedin-panel">
      <div className="panel-heading">
        <div>
          <h2>LinkedIn Project</h2>
          <p>Draft a LinkedIn “Projects” entry from this repository.</p>
        </div>
        <button type="button" onClick={generateLinkedInProject} disabled={!snapshot || busy || linkedinLoading || !canGenerateLinkedInProject}>
          {linkedinLoading ? <Loader2 className="spin" size={17} /> : <Star size={17} />}
          Generate
        </button>
      </div>

      <div className="linkedin-workspace">
        <section className="linkedin-controls linkedin-hints">
          <div className="linkedin-hints-grid">
            <label>
              Focus role
              <input
                value={linkedinRole}
                onChange={(event) => setLinkedInRole(event.target.value)}
                placeholder="Creator, maintainer, app developer"
              />
            </label>
            <label>
              Audience
              <input
                value={linkedinAudience}
                onChange={(event) => setLinkedInAudience(event.target.value)}
                placeholder="Who should this impress?"
              />
            </label>
            <label className="linkedin-hint-wide">
              Project URL
              <input
                value={linkedinProjectUrl}
                onChange={(event) => setLinkedInProjectUrl(event.target.value)}
                placeholder={snapshot?.summary.remoteUrl ?? 'https://github.com/owner/repo'}
              />
            </label>
          </div>
          {!canGenerateLinkedInProject && (
            <div className="assistant-policy-note">{assistantPolicyBlockedLabel('linkedin_project', assistantPolicy)}</div>
          )}
        </section>

        {!linkedinProject ? (
          <section className="review-empty linkedin-empty">
            <Star size={24} />
            <strong>{linkedinLoading ? 'Generating LinkedIn project' : 'No LinkedIn draft yet'}</strong>
            <span>{snapshot ? 'Generate a project entry from commits, tracked files, README, and package metadata.' : 'Open a repository before generating LinkedIn content.'}</span>
          </section>
        ) : (
          <section className="linkedin-draft linkedin-card">
            <label className="linkedin-field">
              Project name
              <input
                value={linkedinProject.projectName}
                onChange={(event) => updateLinkedInProject({ projectName: event.target.value })}
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
                Start date
                <input
                  value={linkedinProject.startDate}
                  onChange={(event) => updateLinkedInProject({ startDate: event.target.value })}
                  placeholder="Jun 2026"
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

            <label className="linkedin-field">
              Skills
              <input
                value={linkedinSkillsText}
                onChange={(event) => {
                  setLinkedinSkillsText(event.target.value)
                  updateLinkedInProject({
                    skills: event.target.value.split(',').map((skill) => skill.trim()).filter(Boolean)
                  })
                }}
                placeholder="TypeScript, Electron, React"
              />
            </label>

            <div className="linkedin-markdown-block">
              <div className="linkedin-markdown-heading">
                <strong>LinkedIn-ready text</strong>
                <button type="button" onClick={copyLinkedInMarkdown}>
                  <Copy size={15} />
                  Copy
                </button>
              </div>
              <textarea
                className="linkedin-markdown-editor"
                value={linkedinProject.markdown}
                onChange={(event) => updateLinkedInProject({ markdown: event.target.value })}
              />
            </div>
          </section>
        )}
      </div>
    </section>
  )
}
