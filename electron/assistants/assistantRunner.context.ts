import { promises as fs } from 'node:fs'
import path from 'node:path'
import type {
  ReviewScope
} from '../../src/shared/branchPilot.js'
import { CommandRunner } from '../lib/commandRunner.js'
import { BranchPilotUserError } from '../lib/errors.js'
import { GIT_EXECUTABLE, normalizeNativePath } from '../lib/platformExecutables.js'
import {
  MAX_ASSISTANT_REVIEW_DIFF_BYTES
} from './assistantRunner.schemas.js'
import {
  truncateText
} from './assistantRunner.prompts.js'
import {
  normalizeBranchName
} from './assistantRunner.parsers.js'

export async function resolveRepositoryRoot(runner: CommandRunner, repoPath: string): Promise<string> {
  const result = await runner.run(GIT_EXECUTABLE, ['rev-parse', '--show-toplevel'], {
    cwd: repoPath,
    timeoutMs: 10_000
  })

  return normalizeNativePath(result.stdout.trim())
}

export async function readOptionalFile(filePath: string, maxBytes: number): Promise<string> {
  try {
    const raw = await fs.readFile(filePath, 'utf8')
    return truncateText(raw, maxBytes).text
  } catch {
    return ''
  }
}

export async function readFirstExistingFile(rootPath: string, candidates: string[], maxBytes: number): Promise<string> {
  for (const candidate of candidates) {
    const content = await readOptionalFile(path.join(rootPath, candidate), maxBytes)

    if (content.trim()) {
      return content
    }
  }

  return ''
}

export async function getCurrentBranch(runner: CommandRunner, rootPath: string): Promise<string> {
  const result = await runner.run(GIT_EXECUTABLE, ['branch', '--show-current'], {
    cwd: rootPath,
    allowedExitCodes: [0, 1],
    timeoutMs: 10_000
  })
  const branch = result.stdout.trim()

  if (!branch) {
    throw new BranchPilotUserError('git_detached_head', 'Cannot generate pull request text from a detached HEAD.')
  }

  return branch
}

export async function getBranchLabel(runner: CommandRunner, rootPath: string): Promise<string> {
  const result = await runner.run(GIT_EXECUTABLE, ['branch', '--show-current'], {
    cwd: rootPath,
    allowedExitCodes: [0, 1],
    timeoutMs: 10_000
  })

  return result.stdout.trim() || 'Detached HEAD'
}

export async function buildReviewContext(
  runner: CommandRunner,
  rootPath: string,
  scope: ReviewScope
): Promise<{
  branch: string
  baseBranch?: string
  status: string
  commits: string
  diff: string
  truncated: boolean
}> {
  const branch = await getBranchLabel(runner, rootPath)
  const status = await runner.run(GIT_EXECUTABLE, ['status', '--short'], {
    cwd: rootPath,
    timeoutMs: 10_000
  })
  const recentCommits = await runner.run(GIT_EXECUTABLE, [
    'log',
    '--max-count=5',
    '--pretty=format:%h%x00%s%x00%an'
  ], {
    cwd: rootPath,
    allowedExitCodes: [0, 128],
    timeoutMs: 30_000
  })

  if (scope === 'staged') {
    const diff = await runner.run(GIT_EXECUTABLE, ['diff', '--cached', '--no-ext-diff'], {
      cwd: rootPath,
      allowedExitCodes: [0, 1],
      timeoutMs: 30_000
    })
    const truncated = truncateText(diff.stdout, MAX_ASSISTANT_REVIEW_DIFF_BYTES)

    return {
      branch,
      status: status.stdout,
      commits: recentCommits.stdout,
      diff: truncated.text,
      truncated: truncated.truncated
    }
  }

  if (scope === 'unstaged') {
    const diff = await runner.run(GIT_EXECUTABLE, ['diff', '--no-ext-diff'], {
      cwd: rootPath,
      allowedExitCodes: [0, 1],
      timeoutMs: 30_000
    })
    const truncated = truncateText(diff.stdout, MAX_ASSISTANT_REVIEW_DIFF_BYTES)

    return {
      branch,
      status: status.stdout,
      commits: recentCommits.stdout,
      diff: truncated.text,
      truncated: truncated.truncated
    }
  }

  const base = await resolveDefaultBaseRef(runner, rootPath)
  const commits = await runner.run(GIT_EXECUTABLE, [
    'log',
    '--max-count=50',
    '--pretty=format:%h%x00%s%x00%an',
    `${base.baseRef}..HEAD`
  ], {
    cwd: rootPath,
    allowedExitCodes: [0, 128],
    timeoutMs: 30_000
  })
  const diff = await runner.run(GIT_EXECUTABLE, ['diff', '--no-ext-diff', `${base.baseRef}...HEAD`], {
    cwd: rootPath,
    allowedExitCodes: [0, 1],
    timeoutMs: 30_000
  })
  const truncated = truncateText(diff.stdout, MAX_ASSISTANT_REVIEW_DIFF_BYTES)

  return {
    branch,
    baseBranch: base.baseBranch,
    status: status.stdout,
    commits: commits.stdout,
    diff: truncated.text,
    truncated: truncated.truncated
  }
}

export async function resolveDefaultBaseRef(
  runner: CommandRunner,
  rootPath: string
): Promise<{ baseBranch: string; baseRef: string }> {
  const originHead = await runner.run(GIT_EXECUTABLE, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'], {
    cwd: rootPath,
    allowedExitCodes: [0, 1],
    timeoutMs: 10_000
  })
  const originHeadRef = originHead.stdout.trim()

  if (originHead.exitCode === 0 && originHeadRef) {
    return {
      baseBranch: originHeadRef.replace(/^origin\//, ''),
      baseRef: originHeadRef
    }
  }

  return resolveBaseRef(runner, rootPath, 'main')
}

export async function resolveBaseRef(
  runner: CommandRunner,
  rootPath: string,
  baseBranch: string
): Promise<{ baseBranch: string; baseRef: string }> {
  const normalizedBase = normalizeBranchName(baseBranch, 'Base branch').replace(/^origin\//, '')
  const remoteRef = `origin/${normalizedBase}`

  if (await refExists(runner, rootPath, remoteRef)) {
    return {
      baseBranch: normalizedBase,
      baseRef: remoteRef
    }
  }

  if (await refExists(runner, rootPath, normalizedBase)) {
    return {
      baseBranch: normalizedBase,
      baseRef: normalizedBase
    }
  }

  throw new BranchPilotUserError('invalid_base_branch', `Base branch "${normalizedBase}" was not found locally.`)
}

export async function refExists(runner: CommandRunner, rootPath: string, ref: string): Promise<boolean> {
  const result = await runner.run(GIT_EXECUTABLE, ['rev-parse', '--verify', '--quiet', ref], {
    cwd: rootPath,
    allowedExitCodes: [0, 1],
    timeoutMs: 10_000
  })

  return result.exitCode === 0
}

