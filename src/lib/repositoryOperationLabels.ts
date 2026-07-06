export function isRepositoryTransitionOperation(operationLabel: string | null): boolean {
  if (!operationLabel) return false
  return (
    operationLabel === 'Opening repository...' ||
    operationLabel === 'Opening worktree...' ||
    operationLabel === 'Opening submodule...' ||
    operationLabel.startsWith('Cloning ')
  )
}

export function isRepositorySyncOperation(operationLabel: string | null): boolean {
  if (!operationLabel) return false
  return [
    'Fetching origin...',
    'Pulling origin...',
    'Pushing origin...',
    'Force pushing with lease...',
    'Committing and pushing...',
    'Fetch complete...',
    'Pull complete...',
    'Push complete...',
    'Force push complete...'
  ].includes(operationLabel)
}

export function repositorySyncOperationLabel(operationLabel: string | null): string {
  if (!operationLabel) return 'Syncing repository'
  if (operationLabel.startsWith('Fetch')) return 'Fetching origin'
  if (operationLabel.startsWith('Pull')) return 'Pulling origin'
  if (operationLabel.startsWith('Push')) return 'Pushing origin'
  if (operationLabel.startsWith('Force')) return 'Force pushing'
  if (operationLabel.startsWith('Committing and pushing')) return 'Committing and pushing'
  return operationLabel.replace(/\.\.\.$/, '')
}
