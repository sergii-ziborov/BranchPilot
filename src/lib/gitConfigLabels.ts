import type { GitConfigSnapshot } from '../shared/branchPilot'

/** Describe the resolved default branch and where it was inferred from. */
export function gitDefaultBranchLabel(config: GitConfigSnapshot | null): string {
  if (!config?.defaultBranch) {
    return 'Unset'
  }

  if (config.defaultBranchSource === 'remote') {
    return `${config.defaultBranch} (${config.defaultBranchRemote ?? 'remote'}/HEAD)`
  }

  if (config.defaultBranchSource === 'local') {
    return `${config.defaultBranch} (local branch fallback)`
  }

  if (config.defaultBranchSource === 'current') {
    return `${config.defaultBranch} (current branch fallback)`
  }

  return config.defaultBranch
}

/** Describe commit-signing state and its configuration source (read-only). */
export function gitSigningLabel(config: GitConfigSnapshot | null): string {
  if (!config || config.commitSigningSource === 'unset') {
    return 'Unset'
  }

  const state = config.commitSigningEnabled ? 'Enabled' : 'Disabled'
  const source = config.commitSigningSource === 'local' ? 'repository local' : 'global'

  return `${state} (${source}, read-only)`
}
