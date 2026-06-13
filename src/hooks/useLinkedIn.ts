import { useState } from 'react'
import type { AssistantId, AssistantPolicyStatus, BranchPilotApi, GeneratedLinkedInProject } from '../shared/branchPilot'
import { branchPilotErrorText } from '../shared/branchPilot'
import { assistantLabel, assistantPolicyBlockedLabel } from '../lib/assistantLabels'

/**
 * Owns LinkedIn project draft state and its generate/edit/copy handlers.
 * Shared infrastructure and cross-domain triggers are injected.
 */
export function useLinkedIn({
  api,
  currentRepoPath,
  selectedAssistant,
  assistantPolicy,
  canGenerateLinkedInProject,
  setNotice,
  setError,
  setBusy,
  copyToClipboard,
  loadProjectMemory
}: {
  api: BranchPilotApi | undefined
  currentRepoPath: string | undefined
  selectedAssistant: AssistantId
  assistantPolicy: AssistantPolicyStatus | null
  canGenerateLinkedInProject: boolean
  setNotice: (message: string) => void
  setError: (message: string | null) => void
  setBusy: (value: boolean) => void
  copyToClipboard: (text: string, successMessage: string) => Promise<void>
  loadProjectMemory: () => void | Promise<void>
}) {
  const [linkedinProject, setLinkedInProject] = useState<GeneratedLinkedInProject | null>(null)
  // Raw text drafts for the list editors; parsing on change would swallow Enter/comma keystrokes.
  const [linkedinHighlightsText, setLinkedinHighlightsText] = useState('')
  const [linkedinTagsText, setLinkedinTagsText] = useState('')
  const [linkedinSkillsText, setLinkedinSkillsText] = useState('')
  const [linkedinRole, setLinkedInRole] = useState('')
  const [linkedinAudience, setLinkedInAudience] = useState('LinkedIn project section')
  const [linkedinProjectUrl, setLinkedInProjectUrl] = useState('')
  const [linkedinLoading, setLinkedInLoading] = useState(false)

  async function generateLinkedInProject() {
    if (!api || !currentRepoPath) return

    if (!canGenerateLinkedInProject) {
      setNotice(assistantPolicyBlockedLabel('linkedin_project', assistantPolicy))
      return
    }

    setLinkedInLoading(true)
    setBusy(true)
    setError(null)
    try {
      const result = await api.generateLinkedInProject({
        repoPath: currentRepoPath,
        assistant: selectedAssistant,
        role: linkedinRole,
        audience: linkedinAudience,
        projectUrl: linkedinProjectUrl
      })

      if (result.ok) {
        setLinkedInProject(result.data)
        setLinkedinHighlightsText(result.data.highlights.join('\n'))
        setLinkedinTagsText(result.data.tags.join(', '))
        setLinkedinSkillsText(result.data.skills.join(', '))
        setNotice(`LinkedIn project generated with ${assistantLabel(result.data.assistant)}.`)
        if (result.data.truncated) {
          setError('LinkedIn context was truncated for assistant limits.')
        }
        void loadProjectMemory()
      } else {
        // Keep the current draft so a failed regeneration does not wipe user edits.
        setError(result.error.message)
        setNotice(branchPilotErrorText(result.error))
      }
    } finally {
      setBusy(false)
      setLinkedInLoading(false)
    }
  }

  function updateLinkedInProject(update: Partial<GeneratedLinkedInProject>) {
    setLinkedInProject((current) => current ? { ...current, ...update } : current)
  }

  async function copyLinkedInMarkdown() {
    if (!linkedinProject) return
    await copyToClipboard(linkedinProject.markdown, 'LinkedIn project Markdown copied.')
  }

  async function copyLinkedInTags() {
    if (!linkedinProject) return
    await copyToClipboard(
      linkedinProject.tags.map((tag) => `#${tag.replace(/^#/, '')}`).join(' '),
      'LinkedIn tags copied.'
    )
  }

  return {
    linkedinProject, setLinkedInProject,
    linkedinHighlightsText, setLinkedinHighlightsText,
    linkedinTagsText, setLinkedinTagsText,
    linkedinSkillsText, setLinkedinSkillsText,
    linkedinRole, setLinkedInRole,
    linkedinAudience, setLinkedInAudience,
    linkedinProjectUrl, setLinkedInProjectUrl,
    linkedinLoading,
    generateLinkedInProject, updateLinkedInProject, copyLinkedInMarkdown, copyLinkedInTags
  }
}
