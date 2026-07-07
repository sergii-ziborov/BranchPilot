export function friendlyIpcErrorMessage(message: string, fallback: string, details?: string): string {
  if (/No handler registered for/i.test(message)) {
    return 'Electron main process is stale. Restart BranchPilot so the new IPC handlers are registered.'
  }

  const visibleMessage = message || fallback
  const visibleDetails = details?.trim()

  if (!visibleDetails || visibleMessage.includes(visibleDetails)) {
    return visibleMessage
  }

  return `${visibleMessage}\n\n${visibleDetails}`
}
