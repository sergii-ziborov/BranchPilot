import { Bot } from 'lucide-react'
import type { AssistantId, AssistantPolicyMode, AssistantPolicyStatus, AssistantStatus, RepositorySnapshot } from '../../shared/branchPilot'
import { AssistantModelSelect } from '../AssistantModelSelect'
import { AssistantPolicyPanel } from '../AssistantPanels'

export function AssistantSettingsPanel({
  selectedAssistant,
  setSelectedAssistant,
  assistants,
  assistantsChecking,
  checkAssistants,
  assistantPolicy,
  assistantPolicyLoading,
  assistantPolicyModes,
  snapshot,
  updateAssistantPolicy
}: {
  selectedAssistant: AssistantId
  setSelectedAssistant: (assistant: AssistantId) => void
  assistants: AssistantStatus[]
  assistantsChecking: boolean
  checkAssistants: () => void | Promise<void>
  assistantPolicy: AssistantPolicyStatus | null
  assistantPolicyLoading: boolean
  assistantPolicyModes: AssistantPolicyMode[]
  snapshot: RepositorySnapshot | null
  updateAssistantPolicy: (mode: AssistantPolicyMode) => void | Promise<void>
}) {
  return (
    <div className="assistant-settings-panel">
      <section className="assistant-default-panel">
        <div className="config-card-heading">
          <div>
            <h3>Default assistant</h3>
            <p>Used for commit text, PR drafts, review reports, branch drafts, and generated project copy.</p>
          </div>
          <Bot size={18} />
        </div>

        <AssistantModelSelect
          id="settings-assistant"
          label="Assistant and model"
          selectedAssistant={selectedAssistant}
          setSelectedAssistant={setSelectedAssistant}
          assistants={assistants}
          assistantsChecking={assistantsChecking}
          checkAssistants={checkAssistants}
        />

        <p className="muted-text">
          Auto uses the first ready local assistant. Choosing a model here becomes the default for every assistant workflow.
        </p>
      </section>

      <AssistantPolicyPanel
        assistantPolicy={assistantPolicy}
        assistantPolicyLoading={assistantPolicyLoading}
        assistantPolicyModes={assistantPolicyModes}
        snapshot={snapshot}
        updateAssistantPolicy={updateAssistantPolicy}
      />
    </div>
  )
}
