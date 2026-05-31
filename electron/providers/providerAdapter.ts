import type { ProviderStatus } from '../../src/shared/branchPilot.js'

export interface ProviderAdapter {
  id: ProviderStatus['id']
  label: string
  state: ProviderStatus['state']
}

export function listProviderStatuses(): ProviderStatus[] {
  return [
    { id: 'github', label: 'GitHub', state: 'planned' },
    { id: 'gitlab', label: 'GitLab', state: 'planned' },
    { id: 'bitbucket', label: 'Bitbucket', state: 'planned' }
  ]
}
