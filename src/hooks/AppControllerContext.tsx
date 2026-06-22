/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, type ReactNode } from 'react'
import type { useAppController } from './useAppController'

/** The full controller surface, shared via context so views pull what they need
 *  instead of being prop-drilled the whole object through App.tsx. */
export type AppController = ReturnType<typeof useAppController>

const AppControllerContext = createContext<AppController | null>(null)

export function AppControllerProvider({ value, children }: { value: AppController; children: ReactNode }) {
  return <AppControllerContext.Provider value={value}>{children}</AppControllerContext.Provider>
}

/** Access the app controller. Throws if used outside the provider (a wiring bug). */
export function useController(): AppController {
  const controller = useContext(AppControllerContext)
  if (!controller) {
    throw new Error('useController must be used within an AppControllerProvider')
  }
  return controller
}
