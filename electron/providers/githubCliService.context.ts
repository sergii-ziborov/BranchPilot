import { CommandRunner } from '../lib/commandRunner.js'
import { BranchPilotUserError } from '../lib/errors.js'
import { GIT_EXECUTABLE, WHICH_EXECUTABLE, normalizeNativePath } from '../lib/platformExecutables.js'
import { normalizeGitHubRepositoryPath, type GitHubRepositoryInfo } from './githubCliService.shared.js'

/** Leaf context helpers: gh executable, repository root, remote + branch resolution. */

export async function resolveGhExecutable(runner: CommandRunner): Promise<string | undefined> {
  try {
    const result = await runner.run(WHICH_EXECUTABLE, ['gh'], {
      timeoutMs: 5_000
    })

    return result.stdout.trim() || 'gh'
  } catch {
    return undefined
  }
}

export async function resolveRepositoryRoot(runner: CommandRunner, repoPath: string): Promise<string> {
  const result = await runner.run(GIT_EXECUTABLE, ['rev-parse', '--show-toplevel'], {
    cwd: repoPath,
    timeoutMs: 10_000
  })

  return normalizeNativePath(result.stdout.trim())
}

export async function getGitHubRemoteUrl(runner: CommandRunner, rootPath: string): Promise<string> {
  return (await getGitHubRemote(runner, rootPath)).remoteUrl
}

export async function getGitHubRemote(runner: CommandRunner, rootPath: string): Promise<GitHubRepositoryInfo & { remoteName: string }> {
  const result = await runner.run(GIT_EXECUTABLE, ['remote', '-v'], {
    cwd: rootPath,
    allowedExitCodes: [0, 1],
    timeoutMs: 10_000
  })

  for (const line of result.stdout.split('\n')) {
    const match = line.trim().match(/^(\S+)\s+(\S+)\s+\((fetch|push)\)$/)
    const parsed = match ? parseGitHubRemoteUrl(match[2]) : undefined

    if (match && parsed) {
      return {
        remoteName: match[1],
        remoteUrl: match[2],
        owner: parsed.owner,
        repo: parsed.repo
      }
    }
  }

  throw new BranchPilotUserError('github_remote_missing', 'No GitHub remote was found for this repository.')
}

export async function getGitHubRepositoryInfo(runner: CommandRunner, rootPath: string): Promise<GitHubRepositoryInfo> {
  const remote = await getGitHubRemote(runner, rootPath)

  return {
    owner: remote.owner,
    repo: remote.repo,
    remoteUrl: remote.remoteUrl
  }
}

export async function checkoutGitHubPullRequestWithGit(
  runner: CommandRunner,
  rootPath: string,
  prNumber: number
): Promise<void> {
  const remote = await getGitHubRemote(runner, rootPath)
  const branchName = `branchpilot/pr-${prNumber}`

  await runner.run(GIT_EXECUTABLE, ['fetch', remote.remoteName, `pull/${prNumber}/head`], {
    cwd: rootPath,
    timeoutMs: 120_000
  })

  const branchExists = await runner.run(GIT_EXECUTABLE, ['rev-parse', '--verify', `refs/heads/${branchName}`], {
    cwd: rootPath,
    allowedExitCodes: [0, 1],
    timeoutMs: 10_000
  })

  if (branchExists.exitCode === 0) {
    await runner.run(GIT_EXECUTABLE, ['switch', branchName], {
      cwd: rootPath,
      timeoutMs: 30_000
    })
    await runner.run(GIT_EXECUTABLE, ['merge', '--ff-only', 'FETCH_HEAD'], {
      cwd: rootPath,
      timeoutMs: 120_000
    })
    return
  }

  await runner.run(GIT_EXECUTABLE, ['switch', '-c', branchName, 'FETCH_HEAD'], {
    cwd: rootPath,
    timeoutMs: 30_000
  })
}

export function parseGitHubRemoteUrl(remoteUrl: string): Pick<GitHubRepositoryInfo, 'owner' | 'repo'> | undefined {
  const trimmed = remoteUrl.trim()
  const scpMatch = trimmed.match(/^(?:[^@\s]+@)?github\.com:([^/\s]+)\/([^/\s]+?)(?:\.git)?$/i)

  if (scpMatch) {
    return normalizeGitHubRepositoryPath(scpMatch[1], scpMatch[2])
  }

  try {
    const parsedUrl = new URL(trimmed)

    if (parsedUrl.hostname.toLowerCase() !== 'github.com') {
      return undefined
    }

    const parts = parsedUrl.pathname
      .replace(/^\/+|\/+$/g, '')
      .split('/')
      .filter(Boolean)

    if (parts.length !== 2) {
      return undefined
    }

    return normalizeGitHubRepositoryPath(parts[0], parts[1])
  } catch {
    return undefined
  }
}

export async function getCurrentBranch(runner: CommandRunner, rootPath: string): Promise<string> {
  const result = await runner.run(GIT_EXECUTABLE, ['branch', '--show-current'], {
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

export async function assertHasUpstream(runner: CommandRunner, rootPath: string): Promise<void> {
  const upstream = await runner.run(GIT_EXECUTABLE, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], {
    cwd: rootPath,
    allowedExitCodes: [0, 128],
    timeoutMs: 10_000
  })

  if (upstream.exitCode !== 0 || !upstream.stdout.trim()) {
    throw new BranchPilotUserError('git_no_upstream', 'Publish this branch before creating a pull request.')
  }
}

export async function resolveDefaultBaseBranch(runner: CommandRunner, rootPath: string): Promise<string> {
  const originHead = await runner.run(GIT_EXECUTABLE, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'], {
    cwd: rootPath,
    allowedExitCodes: [0, 1],
    timeoutMs: 10_000
  })
  const ref = originHead.stdout.trim()

  return ref ? ref.replace(/^origin\//, '') : 'main'
}

export function normalizeBranchName(branchName: string, label: string): string {
  const trimmed = branchName.trim()

  if (!trimmed || trimmed.startsWith('-') || trimmed.includes('\0')) {
    throw new BranchPilotUserError('invalid_branch', `${label} is invalid.`)
  }

  return trimmed
}


