import type { ProviderStatus } from '../../src/shared/branchPilot.js'
import { CommandRunner } from '../lib/commandRunner.js'
import {
  getGitHubCliStatus,
  type GitHubApiClient,
  type GitHubCredentialProvider
} from './githubCliService.js'

export interface ProviderAdapter {
  id: ProviderStatus['id']
  label: string
  state: ProviderStatus['state']
}

export interface ProviderStatusOptions {
  githubCredentialProvider?: GitHubCredentialProvider
  githubApiClient?: GitHubApiClient
}

export async function listProviderStatuses(
  runner: CommandRunner,
  options: ProviderStatusOptions = {}
): Promise<ProviderStatus[]> {
  const github = await getGitHubCliStatus(
    runner,
    undefined,
    options.githubCredentialProvider,
    options.githubApiClient
  )

  return [
    { id: 'github', label: 'GitHub', state: mapGitHubState(github.state) },
    { id: 'gitlab', label: 'GitLab', state: 'planned' },
    { id: 'bitbucket', label: 'Bitbucket', state: 'planned' }
  ]
}

function mapGitHubState(state: 'missing' | 'unauthenticated' | 'authenticated'): ProviderStatus['state'] {
  if (state === 'authenticated') return 'connected'
  if (state === 'unauthenticated') return 'unauthenticated'
  return 'missing'
}
