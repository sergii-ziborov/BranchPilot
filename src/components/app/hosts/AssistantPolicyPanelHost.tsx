import { AssistantPolicyPanel } from '../../AssistantPanels'
import { useController } from '../../../hooks/AppControllerContext'
import { assistantPolicyModes } from '../../../lib/appOptions'

export function AssistantPolicyPanelHost() {
  const { assistantPolicy, assistantPolicyLoading, snapshot, updateAssistantPolicy } = useController()

  return (
    <AssistantPolicyPanel
      assistantPolicy={assistantPolicy}
      assistantPolicyLoading={assistantPolicyLoading}
      assistantPolicyModes={assistantPolicyModes}
      snapshot={snapshot}
      updateAssistantPolicy={updateAssistantPolicy}
    />
  )
}
