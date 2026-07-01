import './App.css'
import { AppFrame } from './components/app/AppFrame'
import { AppControllerProvider } from './hooks/AppControllerContext'
import { useAppController } from './hooks/useAppController'

function App() {
  const controller = useAppController()

  return (
    <AppControllerProvider value={controller}>
      <AppFrame />
    </AppControllerProvider>
  )
}

export default App
