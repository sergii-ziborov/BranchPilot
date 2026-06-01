import type { BranchPilotError } from '../../src/shared/branchPilot.js'
import { CommandExecutionError } from './commandRunner.js'

export class BranchPilotUserError extends Error {
  constructor(
    public code: string,
    message: string,
    public details?: string
  ) {
    super(message)
  }
}

export function toBranchPilotError(error: unknown): BranchPilotError {
  if (error instanceof BranchPilotUserError) {
    return {
      code: error.code,
      message: error.message,
      details: error.details
    }
  }

  if (error instanceof CommandExecutionError) {
    const classified = classifyGitError(error.result.stderr || error.result.stdout)

    return {
      code: classified.code,
      message: classified.message,
      details: [error.result.stderr, error.result.stdout].filter(Boolean).join('\n')
    }
  }

  if (error instanceof Error) {
    return {
      code: 'unexpected_error',
      message: error.message
    }
  }

  return {
    code: 'unexpected_error',
    message: 'Unexpected error'
  }
}

function classifyGitError(output: string): { code: string; message: string } {
  const normalized = output.toLowerCase()

  if (normalized.includes('authentication failed') || normalized.includes('could not read username')) {
    return {
      code: 'git_auth_failed',
      message: 'Git authentication failed. Check the remote account or credential manager.'
    }
  }

  if (normalized.includes('no upstream branch')) {
    return {
      code: 'git_no_upstream',
      message: 'This branch has no upstream. Publish the branch before pushing normally.'
    }
  }

  if (normalized.includes('no remote repository specified')) {
    return {
      code: 'git_no_remote',
      message: 'This repository has no remotes configured.'
    }
  }

  if (normalized.includes('non-fast-forward') || normalized.includes('fetch first')) {
    return {
      code: 'git_non_fast_forward',
      message: 'Push was rejected because the remote has new commits. Fetch and review before pushing.'
    }
  }

  if (normalized.includes('not possible to fast-forward') || normalized.includes('divergent branches')) {
    return {
      code: 'git_pull_not_fast_forward',
      message: 'Pull could not fast-forward. Fetch and resolve the branch state manually.'
    }
  }

  if (normalized.includes('would be overwritten by checkout') || normalized.includes('please commit your changes or stash them')) {
    return {
      code: 'git_dirty_worktree',
      message: 'Local changes would be overwritten. Commit, discard, or stash them before switching.'
    }
  }

  if (normalized.includes('not fully merged')) {
    return {
      code: 'git_branch_not_merged',
      message: 'Git refused to delete this branch because it is not fully merged.'
    }
  }

  if (normalized.includes('cannot delete branch') && normalized.includes('checked out')) {
    return {
      code: 'git_current_branch',
      message: 'Cannot delete the checked-out branch. Switch branches first.'
    }
  }

  if (normalized.includes('automatic merge failed') || normalized.includes('fix conflicts')) {
    return {
      code: 'git_conflict',
      message: 'Git reported conflicts. Use the Merge view to resolve them.'
    }
  }

  return {
    code: 'git_command_failed',
    message: 'Git command failed. See details for the original Git output.'
  }
}
