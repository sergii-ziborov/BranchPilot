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
    return {
      code: error.code,
      message: error.message,
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
