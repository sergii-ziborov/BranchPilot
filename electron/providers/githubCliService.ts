import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type {
  CreatePullRequestRequest,
  CreatedPullRequest,
  GitHubCliStatus
} from '../../src/shared/branchPilot.js'
import { CommandRunner } from '../lib/commandRunner.js'
import { BranchPilotUserError } from '../lib/errors.js'

const GITHUB_REMOTE_PATTERN = /(?:github\.com[:/])([^/\s]+)\/([^/\s]+?)(?:\.git)?$/i

export async function getGitHubCliStatus(runner: CommandRunner, repoPath?: string): Promise<GitHubCliStatus> {
  const executable = await resolveGhExecutable(runner)

  if (!executable) {
    return {
      state: 'missing',
      installed: false,
      authenticated: false,
      message: 'GitHub CLI is not installed.'
    }
  }

  const auth = await runner.run(executable, ['auth', 'status'], {
    cwd: repoPath,
    allowedExitCodes: [0, 1],
    timeoutMs: 15_000
  })

  if (auth.exitCode === 0) {
    return {
      state: 'authenticated',
      installed: true,
      authenticated: true,
      executable,
      username: parseGitHubUsername([auth.stdout, auth.stderr].filter(Boolean).join('\n')),
      message: 'GitHub CLI is authenticated.'
    }
  }

  return {
    state: 'unauthenticated',
    installed: true,
    authenticated: false,
    executable,
    message: 'GitHub CLI is installed but not authenticated. Run gh auth login.'
  }
}

export async function createGitHubPullRequest(
  runner: CommandRunner,
  request: CreatePullRequestRequest
): Promise<CreatedPullRequest> {
  const rootPath = await resolveRepositoryRoot(runner, request.repoPath)
  const status = await getGitHubCliStatus(runner, rootPath)

  if (status.state === 'missing') {
    throw new BranchPilotUserError('github_cli_missing', 'GitHub CLI is not installed.')
  }

  if (status.state !== 'authenticated' || !status.executable) {
    throw new BranchPilotUserError('github_cli_unauthenticated', 'Run gh auth login before creating a pull request.')
  }

  await getGitHubRemoteUrl(runner, rootPath)
  const currentBranch = await getCurrentBranch(runner, rootPath)
  const headBranch = normalizeBranchName(request.headBranch || currentBranch, 'Head branch')

  if (headBranch !== currentBranch) {
    throw new BranchPilotUserError('invalid_branch', 'Only the checked-out branch can be used as the pull request head.')
  }

  await assertHasUpstream(runner, rootPath)

  const title = request.title.trim()

  if (!title) {
    throw new BranchPilotUserError('invalid_pr_title', 'Pull request title is required.')
  }

  const baseBranch = normalizeBranchName(request.baseBranch || await resolveDefaultBaseBranch(runner, rootPath), 'Base branch')
  const bodyFile = path.join(os.tmpdir(), `branchpilot-pr-${Date.now()}.md`)

  await fs.writeFile(bodyFile, request.description.trim(), 'utf8')

  try {
    const result = await runner.run(status.executable, [
      'pr',
      'create',
      '--title',
      title,
      '--body-file',
      bodyFile,
      '--base',
      baseBranch,
      '--head',
      headBranch
    ], {
      cwd: rootPath,
      timeoutMs: 120_000
    })

    return {
      url: parsePullRequestUrl(result.stdout),
      title,
      baseBranch,
      headBranch
    }
  } finally {
    await fs.rm(bodyFile, { force: true })
  }
}

export async function isGitHubRepository(runner: CommandRunner, repoPath: string): Promise<boolean> {
  try {
    await getGitHubRemoteUrl(runner, await resolveRepositoryRoot(runner, repoPath))
    return true
  } catch {
    return false
  }
}

async function resolveGhExecutable(runner: CommandRunner): Promise<string | undefined> {
  try {
    const result = await runner.run('/usr/bin/which', ['gh'], {
      timeoutMs: 5_000
    })

    return result.stdout.trim() || 'gh'
  } catch {
    return undefined
  }
}

async function resolveRepositoryRoot(runner: CommandRunner, repoPath: string): Promise<string> {
  const result = await runner.run('/usr/bin/git', ['rev-parse', '--show-toplevel'], {
    cwd: repoPath,
    timeoutMs: 10_000
  })

  return result.stdout.trim()
}

async function getGitHubRemoteUrl(runner: CommandRunner, rootPath: string): Promise<string> {
  const result = await runner.run('/usr/bin/git', ['remote', '-v'], {
    cwd: rootPath,
    allowedExitCodes: [0, 1],
    timeoutMs: 10_000
  })

  for (const line of result.stdout.split('\n')) {
    const match = line.trim().match(/^(\S+)\s+(\S+)\s+\((fetch|push)\)$/)

    if (match && GITHUB_REMOTE_PATTERN.test(match[2])) {
      return match[2]
    }
  }

  throw new BranchPilotUserError('github_remote_missing', 'No GitHub remote was found for this repository.')
}

async function getCurrentBranch(runner: CommandRunner, rootPath: string): Promise<string> {
  const result = await runner.run('/usr/bin/git', ['branch', '--show-current'], {
    cwd: rootPath,
    allowedExitCodes: [0, 1],
    timeoutMs: 10_000
  })
  const branch = result.stdout.trim()

  if (!branch) {
    throw new BranchPilotUserError('git_detached_head', 'Cannot create a pull request from a detached HEAD.')
  }

  return branch
}

async function assertHasUpstream(runner: CommandRunner, rootPath: string): Promise<void> {
  const upstream = await runner.run('/usr/bin/git', ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], {
    cwd: rootPath,
    allowedExitCodes: [0, 128],
    timeoutMs: 10_000
  })

  if (upstream.exitCode !== 0 || !upstream.stdout.trim()) {
    throw new BranchPilotUserError('git_no_upstream', 'Publish this branch before creating a pull request.')
  }
}

async function resolveDefaultBaseBranch(runner: CommandRunner, rootPath: string): Promise<string> {
  const originHead = await runner.run('/usr/bin/git', ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'], {
    cwd: rootPath,
    allowedExitCodes: [0, 1],
    timeoutMs: 10_000
  })
  const ref = originHead.stdout.trim()

  return ref ? ref.replace(/^origin\//, '') : 'main'
}

function normalizeBranchName(branchName: string, label: string): string {
  const trimmed = branchName.trim()

  if (!trimmed || trimmed.startsWith('-') || trimmed.includes('\0')) {
    throw new BranchPilotUserError('invalid_branch', `${label} is invalid.`)
  }

  return trimmed
}

function parseGitHubUsername(output: string): string | undefined {
  return output.match(/Logged in to [^\s]+ account ([^\s]+)/)?.[1]
}

function parsePullRequestUrl(output: string): string {
  const url = output.match(/https:\/\/github\.com\/[^\s]+\/[^\s]+\/pull\/\d+/)?.[0]

  if (!url) {
    throw new BranchPilotUserError('github_pr_parse_failed', 'GitHub CLI did not return a pull request URL.', output)
  }

  return url
}
