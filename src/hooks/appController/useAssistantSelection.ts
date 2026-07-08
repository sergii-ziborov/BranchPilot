import { useCallback, useState } from 'react'
import type { AssistantId } from '../../shared/branchPilot'

const ASSISTANT_PREFERENCE_KEY = 'bp-assistant'
const ASSISTANT_IDS = new Set<AssistantId>([
  'auto',
  'claude',
  'codex',
  'claude:opus',
  'claude:sonnet',
  'claude:haiku',
  'codex:gpt-5',
  'codex:gpt-5-codex',
  'codex:gpt-5-mini'
])

/** Owns the selected assistant preference, persisted in localStorage. */
export function useAssistantSelection() {
  const [selectedAssistant, setSelectedAssistantState] = useState<AssistantId>(readSelectedAssistantPreference)
  const setSelectedAssistant = useCallback((assistant: AssistantId) => {
    setSelectedAssistantState(assistant)
    try { localStorage.setItem(ASSISTANT_PREFERENCE_KEY, assistant) } catch { /* ignore */ }
  }, [])

  return { selectedAssistant, setSelectedAssistant }
}

function readSelectedAssistantPreference(): AssistantId {
  try {
    const saved = localStorage.getItem(ASSISTANT_PREFERENCE_KEY)
    return saved && ASSISTANT_IDS.has(saved as AssistantId)
      ? saved as AssistantId
      : 'auto'
  } catch {
    return 'auto'
  }
}
