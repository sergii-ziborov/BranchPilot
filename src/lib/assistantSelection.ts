import type { AssistantId, AssistantStatus } from '../shared/branchPilot'
import { assistantLabel, assistantModelLabel } from './assistantLabels'

export function autoAssistantLabel(readyAssistant: AssistantStatus | undefined, assistants: AssistantStatus[]): string {
  if (readyAssistant) {
    return `Uses ${readyAssistant.label} when ready`
  }

  if (assistants.some((assistant) => assistant.state === 'detected')) {
    return 'Check access before running'
  }

  return 'First available assistant'
}

export function selectedAssistantDescription(
  assistant: AssistantId,
  readyAssistant: AssistantStatus | undefined,
  assistants: AssistantStatus[]
): { title: string; meta: string } {
  if (assistant === 'auto') {
    return {
      title: 'Auto',
      meta: autoAssistantLabel(readyAssistant, assistants)
    }
  }

  const model = assistantModelLabel(assistant)

  return {
    title: assistantLabel(assistant),
    meta: model === 'Default' ? 'Default model' : model
  }
}
