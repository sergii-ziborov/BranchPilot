import type { createIpcHelpers } from './ipcHelpers.js'
import { registerRepositoryHandlers } from './handlers/repository.js'
import { registerGitHandlers } from './handlers/git.js'
import { registerProviderHandlers } from './handlers/providers.js'
import { registerAssistantHandlers } from './handlers/assistants.js'
import type { RegisterIpcHandlersServices } from './ipcTypes.js'

export type { RegisterIpcHandlersServices } from './ipcTypes.js'

export function registerIpcHandlers(
  helpers: ReturnType<typeof createIpcHelpers>,
  services: RegisterIpcHandlersServices
) {
  registerRepositoryHandlers(helpers, services)
  registerGitHandlers(helpers, services)
  registerProviderHandlers(helpers, services)
  registerAssistantHandlers(helpers, services)
}
