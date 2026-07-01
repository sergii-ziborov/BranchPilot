import { ConfigView } from '../../views/ConfigView'
import { useController } from '../../../hooks/AppControllerContext'
import { editorPreferences, terminalPreferences } from '../../../lib/appOptions'

export function ConfigRoute() {
  const { setViewMode } = useController()

  return (
    <ConfigView
      onBack={() => setViewMode('changes')}
      editorPreferences={editorPreferences}
      terminalPreferences={terminalPreferences}
    />
  )
}
