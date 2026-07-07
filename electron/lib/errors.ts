import type { BranchPilotError } from '../../src/shared/branchPilot.js'
import { CommandExecutionError } from './commandRunner.js'
import { isGitExecutable } from './platformExecutables.js'

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
    if (!isGitExecutable(error.result.command)) {
      const classified = classifyCommandError(error.result.command)

      return {
        code: classified.code,
        message: classified.message,
        details: commandFailureDetails(error)
      }
    }

    const classified = classifyGitError(error.result.stderr || error.result.stdout)

    return {
      code: classified.code,
      message: classified.message,
      details: commandFailureDetails(error)
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

function classifyCommandError(command: string): { code: string; message: string } {
  const normalized = command.toLowerCase()

  if (/(^|[\\/])codex(?:\.cmd|\.exe)?$/i.test(command) || normalized.includes('branchpilot-codex')) {
    return {
      code: 'assistant_failed',
      message: 'Codex agent failed. See details for the CLI output.'
    }
  }

  if (/(^|[\\/])claude(?:\.cmd|\.exe)?$/i.test(command) || normalized.includes('branchpilot-claude')) {
    return {
      code: 'assistant_failed',
      message: 'Claude Code agent failed. See details for the CLI output.'
    }
  }

  if (/(^|[\\/])gh(?:\.cmd|\.exe)?$/i.test(command)) {
    return {
      code: 'provider_command_failed',
      message: 'GitHub CLI command failed. See details for the original output.'
    }
  }

  return {
    code: 'command_failed',
    message: 'Command failed. See details for the original output.'
  }
}

function commandFailureDetails(error: CommandExecutionError): string {
  const result = error.result
  const commandLine = [result.command, ...result.args].join(' ')
  const output = [result.stderr, result.stdout].filter(Boolean).join('\n').trim()

  return [
    `Command: ${commandLine}`,
    output
  ].filter(Boolean).join('\n\n')
}

function classifyGitError(output: string): { code: string; message: string } {
  const normalized = output.toLowerCase()

  if (
    normalized.includes('authentication failed') ||
    normalized.includes('could not read username') ||
    normalized.includes('permission denied (publickey)')
  ) {
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

  if (normalized.includes('repository not found') || (normalized.includes('not found') && normalized.includes('repository'))) {
    return {
      code: 'git_repository_not_found',
      message: 'Remote repository was not found, or this account does not have access.'
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

  if (normalized.includes('automatic merge failed') || normalized.includes('fix conflicts') || normalized.includes('merge conflict')) {
    return {
      code: 'git_conflict',
      message: 'Git reported conflicts. Use the Merge view to resolve them.'
    }
  }

  if (normalized.includes('patch does not apply') || normalized.includes('patch failed')) {
    return {
      code: 'git_patch_failed',
      message: 'The hunk could not be applied. Refresh the repository and try again.'
    }
  }

  return {
    code: 'git_command_failed',
    message: 'Git command failed. See details for the original Git output.'
  }
}
