import { useEffect, useRef, useState } from 'react'
import type { AssistantId, AssistantPolicyStatus, BranchPilotApi, GeneratedLinkedInProject, InstalledAssistantId } from '../shared/branchPilot'
import { branchPilotErrorText } from '../shared/branchPilot'
import { assistantPolicyBlockedLabel } from '../lib/assistantLabels'

const LINKEDIN_DRAFT_VERSION = 1
export const DEFAULT_LINKEDIN_CUSTOM_PROMPT = [
  'Prefer a calm, concrete LinkedIn Projects entry over a marketing pitch.',
  'Keep the project name short. Do not append a tagline to the project name.',
  'Use first person only when it reads naturally; otherwise use concise resume style.',
  'Prioritize visible architecture, workflow, and implementation details over vague impact claims.',
  'Keep the description easy to paste into LinkedIn without extra editing.'
].join('\n')

interface PersistedLinkedInDraft {
  version: number
  project: GeneratedLinkedInProject | null
  highlightsText: string
  tagsText: string
  skillsText: string
  role: string
  audience: string
  projectUrl: string
  customPrompt: string
}

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
  const [linkedinCustomPrompt, setLinkedInCustomPrompt] = useState(DEFAULT_LINKEDIN_CUSTOM_PROMPT)
  const [linkedinLoading, setLinkedInLoading] = useState(false)
  const hydratedRepoRef = useRef<string | undefined>(undefined)
  const skipNextPersistRef = useRef(false)

  useEffect(() => {
    skipNextPersistRef.current = true

    if (!currentRepoPath) {
      hydratedRepoRef.current = undefined
      restoreLinkedInDraft(null, {
        setLinkedInProject,
        setLinkedinHighlightsText,
        setLinkedinTagsText,
        setLinkedinSkillsText,
        setLinkedInRole,
        setLinkedInAudience,
        setLinkedInProjectUrl,
        setLinkedInCustomPrompt
      })
      return
    }

    restoreLinkedInDraft(readLinkedInDraft(currentRepoPath), {
      setLinkedInProject,
      setLinkedinHighlightsText,
      setLinkedinTagsText,
      setLinkedinSkillsText,
      setLinkedInRole,
      setLinkedInAudience,
      setLinkedInProjectUrl,
      setLinkedInCustomPrompt
    })
    hydratedRepoRef.current = currentRepoPath
  }, [currentRepoPath])

  useEffect(() => {
    if (!currentRepoPath || hydratedRepoRef.current !== currentRepoPath) return

    if (skipNextPersistRef.current) {
      skipNextPersistRef.current = false
      return
    }

    writeLinkedInDraft(currentRepoPath, {
      version: LINKEDIN_DRAFT_VERSION,
      project: linkedinProject,
      highlightsText: linkedinHighlightsText,
      tagsText: linkedinTagsText,
      skillsText: linkedinSkillsText,
      role: linkedinRole,
      audience: linkedinAudience,
      projectUrl: linkedinProjectUrl,
      customPrompt: linkedinCustomPrompt
    })
  }, [
    currentRepoPath,
    linkedinProject,
    linkedinHighlightsText,
    linkedinTagsText,
    linkedinSkillsText,
    linkedinRole,
    linkedinAudience,
    linkedinProjectUrl,
    linkedinCustomPrompt
  ])

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
        projectUrl: linkedinProjectUrl,
        customPrompt: linkedinCustomPrompt
      })

      if (result.ok) {
        const project = { ...result.data, markdown: formatLinkedInMarkdown(result.data) }
        const highlightsText = project.highlights.join('\n')
        const tagsText = project.tags.join(', ')
        const skillsText = project.skills.join(', ')

        writeLinkedInDraft(currentRepoPath, {
          version: LINKEDIN_DRAFT_VERSION,
          project,
          highlightsText,
          tagsText,
          skillsText,
          role: linkedinRole,
          audience: linkedinAudience,
          projectUrl: linkedinProjectUrl,
          customPrompt: linkedinCustomPrompt
        })
        setLinkedInProject(project)
        setLinkedinHighlightsText(highlightsText)
        setLinkedinTagsText(tagsText)
        setLinkedinSkillsText(skillsText)
        if (project.truncated) {
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
    setLinkedInProject((current) => {
      if (!current) return current
      const next = { ...current, ...update }
      if (!('markdown' in update)) {
        next.markdown = formatLinkedInMarkdown(next)
      }
      return next
    })
  }

  function resetLinkedInPrompt() {
    setLinkedInCustomPrompt(DEFAULT_LINKEDIN_CUSTOM_PROMPT)
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
    linkedinCustomPrompt, setLinkedInCustomPrompt, resetLinkedInPrompt,
    linkedinLoading,
    generateLinkedInProject, updateLinkedInProject, copyLinkedInMarkdown, copyLinkedInTags
  }
}

function storageKey(repoPath: string): string {
  return `branchpilot:linkedin-draft:${normalizeRepoPathForStorage(repoPath)}`
}

function legacyStorageKey(repoPath: string): string {
  return `branchpilot:linkedin-draft:${repoPath}`
}

function normalizeRepoPathForStorage(repoPath: string): string {
  const normalized = repoPath.trim().replace(/\\/g, '/').replace(/\/+$/g, '')
  return /^[A-Za-z]:\//.test(normalized) ? normalized.toLowerCase() : normalized
}

function readLinkedInDraft(repoPath: string): PersistedLinkedInDraft | null {
  try {
    const raw = localStorage.getItem(storageKey(repoPath)) ?? localStorage.getItem(legacyStorageKey(repoPath))
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<PersistedLinkedInDraft>
    const project = coerceLinkedInProject(parsed.project)
    return {
      version: LINKEDIN_DRAFT_VERSION,
      project,
      highlightsText: typeof parsed.highlightsText === 'string' ? parsed.highlightsText : '',
      tagsText: typeof parsed.tagsText === 'string' ? parsed.tagsText : '',
      skillsText: typeof parsed.skillsText === 'string' ? parsed.skillsText : '',
      role: typeof parsed.role === 'string' ? parsed.role : '',
      audience: typeof parsed.audience === 'string' ? parsed.audience : 'LinkedIn project section',
      projectUrl: typeof parsed.projectUrl === 'string' ? parsed.projectUrl : '',
      customPrompt: typeof parsed.customPrompt === 'string' && parsed.customPrompt.trim()
        ? parsed.customPrompt
        : DEFAULT_LINKEDIN_CUSTOM_PROMPT
    }
  } catch {
    return null
  }
}

function writeLinkedInDraft(repoPath: string, draft: PersistedLinkedInDraft) {
  try {
    localStorage.setItem(storageKey(repoPath), JSON.stringify(draft))
    if (legacyStorageKey(repoPath) !== storageKey(repoPath)) {
      localStorage.removeItem(legacyStorageKey(repoPath))
    }
  } catch {
    // Ignore storage failures; generation and editing should still work.
  }
}

function restoreLinkedInDraft(
  draft: PersistedLinkedInDraft | null,
  setters: {
    setLinkedInProject: (project: GeneratedLinkedInProject | null) => void
    setLinkedinHighlightsText: (value: string) => void
    setLinkedinTagsText: (value: string) => void
    setLinkedinSkillsText: (value: string) => void
    setLinkedInRole: (value: string) => void
    setLinkedInAudience: (value: string) => void
    setLinkedInProjectUrl: (value: string) => void
    setLinkedInCustomPrompt: (value: string) => void
  }
) {
  setters.setLinkedInProject(draft?.project ?? null)
  setters.setLinkedinHighlightsText(draft?.highlightsText ?? draft?.project?.highlights.join('\n') ?? '')
  setters.setLinkedinTagsText(draft?.tagsText ?? draft?.project?.tags.join(', ') ?? '')
  setters.setLinkedinSkillsText(draft?.skillsText ?? draft?.project?.skills.join(', ') ?? '')
  setters.setLinkedInRole(draft?.role ?? '')
  setters.setLinkedInAudience(draft?.audience ?? 'LinkedIn project section')
  setters.setLinkedInProjectUrl(draft?.projectUrl ?? '')
  setters.setLinkedInCustomPrompt(draft?.customPrompt ?? DEFAULT_LINKEDIN_CUSTOM_PROMPT)
}

function coerceLinkedInProject(value: unknown): GeneratedLinkedInProject | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<GeneratedLinkedInProject>
  const projectName = typeof candidate.projectName === 'string' ? candidate.projectName : ''
  const description = typeof candidate.description === 'string' ? candidate.description : ''
  if (!projectName && !description) return null

  const project: GeneratedLinkedInProject = {
    projectName,
    headline: typeof candidate.headline === 'string' ? candidate.headline : '',
    role: typeof candidate.role === 'string' ? candidate.role : '',
    startDate: typeof candidate.startDate === 'string' ? candidate.startDate : '',
    endDate: typeof candidate.endDate === 'string' ? candidate.endDate : '',
    description,
    highlights: sanitizeList(candidate.highlights),
    tags: sanitizeList(candidate.tags),
    skills: sanitizeList(candidate.skills),
    urlSuggestion: typeof candidate.urlSuggestion === 'string' ? candidate.urlSuggestion : '',
    markdown: typeof candidate.markdown === 'string' ? candidate.markdown : '',
    assistant: coerceInstalledAssistant(candidate.assistant),
    truncated: typeof candidate.truncated === 'boolean' ? candidate.truncated : false
  }

  return {
    ...project,
    markdown: project.markdown || formatLinkedInMarkdown(project)
  }
}

function sanitizeList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => typeof item === 'string' ? item.trim() : '').filter(Boolean)
    : []
}

function coerceInstalledAssistant(value: unknown): InstalledAssistantId {
  return value === 'claude' || value === 'codex' ? value : 'codex'
}

function formatLinkedInMarkdown(project: Omit<GeneratedLinkedInProject, 'markdown'> | GeneratedLinkedInProject): string {
  return [
    `Project: ${project.projectName}`,
    project.headline,
    '',
    `Role: ${project.role}`,
    `Dates: ${project.startDate} - ${project.endDate}`,
    project.urlSuggestion ? `URL: ${project.urlSuggestion}` : '',
    '',
    project.description,
    '',
    project.highlights.length > 0 ? 'Highlights:' : '',
    ...project.highlights.map((highlight) => `- ${highlight}`),
    '',
    project.skills.length > 0 ? `Skills: ${project.skills.join(', ')}` : '',
    project.tags.length > 0 ? `Tags: ${project.tags.map((tag) => `#${tag.replace(/^#/, '')}`).join(' ')}` : ''
  ].filter((line) => line !== '').join('\n')
}
