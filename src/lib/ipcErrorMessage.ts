export function friendlyIpcErrorMessage(message: string, fallback: string): string {
  if (/No handler registered for/i.test(message)) {
    return 'Electron main process is stale. Restart BranchPilot so the new IPC handlers are registered.'
  }

  return message || fallback
}
