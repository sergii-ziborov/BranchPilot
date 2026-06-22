import { useState } from 'react'
import type { AssistantId, AssistantPolicyMode, AssistantPolicyStatus, AssistantStatus, BranchPilotApi } from '../shared/branchPilot'
import { branchPilotErrorText } from '../shared/branchPilot'
import { assistantLabel, assistantPolicyModeLabel } from '../lib/assistantLabels'
import type { ViewMode } from '../lib/viewMode'

/** Owns assistant detection state and the per-repository assistant policy. */
export function useAssistants({
  api,
  currentRepoPath,
  viewMode,
  selectedAssistant,
  setSelectedAssistant,
  setNotice,
  setError,
  loadProjectMemory
}: {
  api: BranchPilotApi | undefined
  currentRepoPath: string | undefined
  viewMode: ViewMode
  selectedAssistant: AssistantId
  setSelectedAssistant: (assistant: AssistantId) => void
  setNotice: (message: string) => void
  setError: (message: string | null) => void
  loadProjectMemory: (repoPath?: string) => void | Promise<void>
}) {
  const [assistants, setAssistants] = useState<AssistantStatus[]>([])
  const [assistantsChecking, setAssistantsChecking] = useState(false)
  const [assistantPolicy, setAssistantPolicy] = useState<AssistantPolicyStatus | null>(null)
  const [assistantPolicyLoading, setAssistantPolicyLoading] = useState(false)

  async function loadAssistants() {
    if (!api) return
    const result = await api.listAssistants()
    if (result.ok) setAssistants(result.data)
  }

  async function checkAssistants() {
    if (!api) return
    setAssistantsChecking(true)
    setError(null)
    const result = await api.checkAssistants()

    if (result.ok) {
      setAssistants(result.data)
      const ready = result.data.filter((assistant) => assistant.state === 'ready').length
      const fallback = readyAssistantFallback(result.data, selectedAssistant)

      if (fallback) {
        setSelectedAssistant(fallback.id)
        const previous = selectedAssistant === 'auto' ? 'Auto' : assistantLabel(selectedAssistant)
        setNotice(`${fallback.label} is ready. Switched from ${previous}.`)
      } else {
        setNotice(`${ready} of ${result.data.length} assistant CLIs are ready.`)
      }
    } else {
      setError(result.error.message)
      setNotice(branchPilotErrorText(result.error))
    }

    setAssistantsChecking(false)
  }

  async function loadAssistantPolicy(repoPath = currentRepoPath) {
    if (!api || !repoPath) return
    setAssistantPolicyLoading(true)
    const result = await api.getAssistantPolicy(repoPath)

    if (result.ok) {
      setAssistantPolicy(result.data)
    } else {
      setAssistantPolicy(null)
      setError(result.error.message)
    }

    setAssistantPolicyLoading(false)
  }

  async function updateAssistantPolicy(mode: AssistantPolicyMode) {
    if (!api || !currentRepoPath) return
    setAssistantPolicyLoading(true)
    setError(null)
    const result = await api.setAssistantPolicy({
      repoPath: currentRepoPath,
      mode
    })

    if (result.ok) {
      setAssistantPolicy(result.data)
      setNotice(`Assistant policy set to ${assistantPolicyModeLabel(result.data.settings.mode)}.`)
      if (viewMode === 'dashboard') {
        void loadProjectMemory(currentRepoPath)
      }
    } else {
      setError(result.error.message)
      setNotice(branchPilotErrorText(result.error))
    }

    setAssistantPolicyLoading(false)
  }

  return {
    assistants,
    assistantsChecking,
    assistantPolicy,
    setAssistantPolicy,
    assistantPolicyLoading,
    loadAssistants,
    checkAssistants,
    loadAssistantPolicy,
    updateAssistantPolicy
  }
}

function readyAssistantFallback(assistants: AssistantStatus[], selectedAssistant: AssistantId): AssistantStatus | undefined {
  if (selectedAssistant === 'auto') {
    return undefined
  }

  const selected = assistants.find((assistant) => assistant.id === selectedAssistant)

  if (selected?.state === 'ready') {
    return undefined
  }

  return assistants.find((assistant) => assistant.state === 'ready')
}
