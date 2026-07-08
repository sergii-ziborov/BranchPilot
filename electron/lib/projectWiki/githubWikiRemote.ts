import type { ProjectMemoryRepository } from '../../../src/shared/branchPilot.js'
import type { CommandRunner } from '../commandRunner.js'
import { BranchPilotUserError } from '../errors.js'
import { GIT_EXECUTABLE } from '../platformExecutables.js'

export function githubWikiRemoteUrl(repository: ProjectMemoryRepository): string {
  const remoteUrl = repository.remoteUrl?.trim()

  if (!remoteUrl) {
    throw new BranchPilotUserError('github_wiki_no_remote', 'GitHub Wiki sync requires a GitHub remote URL.')
  }

  const sshMatch = remoteUrl.match(/^git@([^:]+):(.+?)(?:\.git)?$/i)

  if (sshMatch) {
    const host = sshMatch[1]
    const repoPath = sshMatch[2].replace(/\/+$/, '').replace(/\.wiki$/i, '')

    if (!isGitHubHost(host)) {
      throw new BranchPilotUserError('github_wiki_unsupported_remote', 'GitHub Wiki sync only supports GitHub remotes.')
    }

    return `git@${host}:${repoPath}.wiki.git`
  }

  try {
    const parsed = new URL(remoteUrl)

    if (!isGitHubHost(parsed.host)) {
      throw new BranchPilotUserError('github_wiki_unsupported_remote', 'GitHub Wiki sync only supports GitHub remotes.')
    }

    const repoPath = parsed.pathname.replace(/^\/+/, '').replace(/\.git$/i, '').replace(/\/+$/, '').replace(/\.wiki$/i, '')

    if (!repoPath.includes('/')) {
      throw new BranchPilotUserError('github_wiki_unsupported_remote', 'GitHub remote URL does not include owner and repository.')
    }

    return `${parsed.protocol}//${parsed.host}/${repoPath}.wiki.git`
  } catch (error) {
    if (error instanceof BranchPilotUserError) {
      throw error
    }

    throw new BranchPilotUserError('github_wiki_unsupported_remote', 'GitHub Wiki sync requires an HTTPS or SSH GitHub remote URL.')
  }
}

function isGitHubHost(host: string): boolean {
  return host.toLowerCase() === 'github.com'
}

export async function ensureGitIdentity(commandRunner: CommandRunner, cwd: string): Promise<void> {
  const userName = await readGitConfig(commandRunner, cwd, 'user.name')
  const userEmail = await readGitConfig(commandRunner, cwd, 'user.email')

  if (!userName) {
    await commandRunner.run(GIT_EXECUTABLE, ['config', 'user.name', 'BranchPilot'], { cwd })
  }

  if (!userEmail) {
    await commandRunner.run(GIT_EXECUTABLE, ['config', 'user.email', 'branchpilot@local'], { cwd })
  }
}

async function readGitConfig(commandRunner: CommandRunner, cwd: string, key: string): Promise<string> {
  const result = await commandRunner.run(GIT_EXECUTABLE, ['config', '--get', key], {
    cwd,
    allowedExitCodes: [0, 1],
    maxOutputBytes: 4000
  })

  return result.stdout.trim()
}

export function errorMessage(error: unknown): string {
  const result = (error as { result?: { stderr?: string; stdout?: string } })?.result
  const details = [result?.stderr, result?.stdout, error instanceof Error ? error.message : String(error)]
    .filter(Boolean)
    .join('\n')

  return details || 'Unknown error'
}
