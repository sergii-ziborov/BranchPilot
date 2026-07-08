import { ConfigView } from '../../views/ConfigView'
import { useController } from '../../../hooks/AppControllerContext'
import { editorPreferences, gitBackendPreferences, terminalPreferences } from '../../../lib/appOptions'

export function ConfigRoute() {
  const { setViewMode } = useController()

  return (
    <ConfigView
      onBack={() => setViewMode('changes')}
      editorPreferences={editorPreferences}
      terminalPreferences={terminalPreferences}
      gitBackendPreferences={gitBackendPreferences}
    />
  )
}
