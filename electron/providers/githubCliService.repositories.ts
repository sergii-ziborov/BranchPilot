import { promises as fs } from 'node:fs'
import path from 'node:path'
import type {
  CreateGitHubRepositoryRequest,
  CreatedGitHubRepository,
  GitHubRepositorySummary
} from '../../src/shared/branchPilot.js'
import { CommandRunner } from '../lib/commandRunner.js'
import { BranchPilotUserError } from '../lib/errors.js'
import { GIT_EXECUTABLE } from '../lib/platformExecutables.js'
import { normalizeConfigValue, normalizeRemoteName } from '../lib/repositoryService.helpers.js'
import {
  getGitHubCliStatus,
  type GitHubApiClient,
  type GitHubCredentialProvider,
  type GitHubDesktopCredential
} from './githubCliService.auth.js'
import { getCurrentBranch, resolveRepositoryRoot } from './githubCliService.context.js'
import { normalizeGitHubRepository, parseGitHubJson } from './githubCliService.parsers.js'
import { isSafeGitHubPathSegment } from './githubCliService.shared.js'

export async function createGitHubRepositoryWithAuth(
  runner: CommandRunner,
  request: CreateGitHubRepositoryRequest,
  credentialProvider: GitHubCredentialProvider,
  apiClient: GitHubApiClient
): Promise<GitHubRepositorySummary> {
  const normalized = normalizeCreateGitHubRepositoryRequest(request)
  const auth = await resolveGitHubCreationAuth(runner, credentialProvider, apiClient)

  if (auth.provider === 'git-credential') {
    return apiClient.createRepository(auth.credential, normalized)
  }

  return createGitHubRepositoryWithGh(runner, auth.executable, normalized)
}

export async function publishLocalGitHubRepositoryWithAuth(
  runner: CommandRunner,
  request: CreateGitHubRepositoryRequest,
  credentialProvider: GitHubCredentialProvider,
  apiClient: GitHubApiClient
): Promise<Omit<CreatedGitHubRepository, 'snapshot'> & { rootPath: string }> {
  if (!request.confirmed) {
    throw new BranchPilotUserError('confirmation_required', 'Creating a GitHub repository requires confirmation.')
  }

  const normalized = normalizeCreateGitHubRepositoryRequest(request)
  const rootPath = await resolveRepositoryRoot(runner, request.repoPath)
  const currentBranch = await getCurrentBranch(runner, rootPath)
  const remoteName = normalizeRemoteName(normalized.remoteName || 'origin')
  const existingRemote = await runner.run(GIT_EXECUTABLE, ['remote', 'get-url', remoteName], {
    cwd: rootPath,
    allowedExitCodes: [0, 2],
    timeoutMs: 10_000
  })
  const existingRemoteUrl = existingRemote.exitCode === 0 ? existingRemote.stdout.trim() : ''

  // A remote already pointing at the repo we're about to create is the signature of
  // a half-finished publish ("origin set, but the GitHub repo was never created" —
  // e.g. an earlier publish that errored after `git remote add`). Reuse it and just
  // push, repairing the state, instead of dead-ending on git_remote_exists. Only a
  // remote pointing at a *different* repository is a genuine conflict.
  const reuseExistingRemote = existingRemoteUrl.length > 0 &&
    remoteMatchesRepository(existingRemoteUrl, normalized.owner, normalized.name)

  if (existingRemoteUrl.length > 0 && !reuseExistingRemote) {
    throw new BranchPilotUserError(
      'git_remote_exists',
      `Remote "${remoteName}" already points to a different repository (${existingRemoteUrl}).`
    )
  }

  if (normalized.gitUserName?.trim() || normalized.gitUserEmail?.trim()) {
    const name = normalizeConfigValue(normalized.gitUserName ?? '', 'Name')
    const email = normalizeConfigValue(normalized.gitUserEmail ?? '', 'Email')

    await runner.run(GIT_EXECUTABLE, ['config', '--local', 'user.name', name], { cwd: rootPath })
    await runner.run(GIT_EXECUTABLE, ['config', '--local', 'user.email', email], { cwd: rootPath })
  }

  const repository = await createGitHubRepositoryWithAuth(runner, normalized, credentialProvider, apiClient)
  const protocol = normalized.remoteProtocol === 'ssh' ? 'ssh' : 'https'
  const createdRemoteUrl = protocol === 'ssh'
    ? repository.sshUrl
    : `https://github.com/${repository.owner}/${repository.name}.git`
  // Repairing a half-finished publish keeps the remote the user already had;
  // a fresh publish uses the URL of the repository we just created.
  const remoteUrl = reuseExistingRemote ? existingRemoteUrl : createdRemoteUrl

  if (!remoteUrl) {
    throw new BranchPilotUserError('github_repo_create_failed', 'GitHub did not return a usable remote URL.')
  }

  if (!reuseExistingRemote) {
    await runner.run(GIT_EXECUTABLE, ['remote', 'add', remoteName, remoteUrl], {
      cwd: rootPath,
      timeoutMs: 10_000
    })
  }

  const starterFilesWritten = await writeRepositoryStarterFiles(rootPath, normalized)

  if (normalized.commitStarterFiles && starterFilesWritten.length > 0) {
    await runner.run(GIT_EXECUTABLE, ['add', '--', ...starterFilesWritten], {
      cwd: rootPath,
      timeoutMs: 10_000
    })
    await runner.run(GIT_EXECUTABLE, ['commit', '-m', 'Add repository starter files', '--', ...starterFilesWritten], {
      cwd: rootPath,
      timeoutMs: 30_000
    })
  }

  let pushed = false

  if (normalized.push !== false) {
    const hasHead = await runner.run(GIT_EXECUTABLE, ['rev-parse', '--verify', 'HEAD'], {
      cwd: rootPath,
      allowedExitCodes: [0, 128],
      timeoutMs: 10_000
    })

    if (hasHead.exitCode !== 0) {
      throw new BranchPilotUserError(
        'git_no_commits',
        'Create an initial commit before publishing, or enable starter file commit.'
      )
    }

    await runner.run(GIT_EXECUTABLE, ['push', '-u', remoteName, currentBranch], {
      cwd: rootPath,
      timeoutMs: 120_000
    })
    pushed = true
  }

  return {
    rootPath,
    name: repository.name,
    nameWithOwner: repository.nameWithOwner,
    owner: repository.owner,
    url: repository.url,
    sshUrl: repository.sshUrl,
    remoteName,
    remoteUrl,
    defaultBranch: repository.defaultBranch || currentBranch,
    pushed,
    starterFilesWritten
  }
}

async function resolveGitHubCreationAuth(
  runner: CommandRunner,
  credentialProvider: GitHubCredentialProvider,
  apiClient: GitHubApiClient
): Promise<
  | { provider: 'gh'; executable: string }
  | { provider: 'git-credential'; credential: GitHubDesktopCredential }
> {
  const status = await getGitHubCliStatus(runner, undefined, credentialProvider, apiClient)

  if (status.authProvider === 'gh' && status.executable) {
    return {
      provider: 'gh',
      executable: status.executable
    }
  }

  if (status.authProvider === 'git-credential') {
    const credential = await credentialProvider.getCredential()

    if (credential) {
      return {
        provider: 'git-credential',
        credential
      }
    }
  }

  if (status.state === 'missing') {
    throw new BranchPilotUserError(
      'github_auth_missing',
      'No GitHub authentication is available.',
      'Connect GitHub with GitHub CLI or Git Credential Manager.'
    )
  }

  throw new BranchPilotUserError(
    'github_auth_unauthenticated',
    'GitHub authentication is not ready.',
    'Connect GitHub with GitHub CLI or Git Credential Manager.'
  )
}

async function createGitHubRepositoryWithGh(
  runner: CommandRunner,
  executable: string,
  request: CreateGitHubRepositoryRequest
): Promise<GitHubRepositorySummary> {
  const viewerResult = await runner.run(executable, ['api', 'user'], {
    timeoutMs: 30_000
  })
  const viewer = parseGitHubJson(viewerResult.stdout, 'github_account_parse_failed', 'GitHub CLI did not return the authenticated user.')
  const viewerRecord = viewer && typeof viewer === 'object' && !Array.isArray(viewer)
    ? viewer as Record<string, unknown>
    : {}
  const viewerLogin = typeof viewerRecord.login === 'string' ? viewerRecord.login : ''
  const endpoint = request.owner === viewerLogin
    ? 'user/repos'
    : `orgs/${request.owner}/repos`
  const result = await runner.run(executable, [
    'api',
    '-X',
    'POST',
    endpoint,
    '-f',
    `name=${request.name}`,
    '-f',
    `description=${request.description}`,
    '-F',
    `private=${request.visibility === 'private' ? 'true' : 'false'}`,
    '-F',
    'auto_init=false'
  ], {
    timeoutMs: 60_000
  })

  return normalizeGitHubRepository(parseGitHubJson(result.stdout, 'github_repo_parse_failed', 'GitHub CLI did not return the created repository.'))
}

function normalizeCreateGitHubRepositoryRequest(request: CreateGitHubRepositoryRequest): CreateGitHubRepositoryRequest {
  const owner = request.owner.trim()
  const name = request.name.trim().replace(/\.git$/i, '')

  if (!isSafeGitHubPathSegment(owner)) {
    throw new BranchPilotUserError('invalid_github_owner', 'GitHub owner is invalid.')
  }

  if (!isSafeGitHubPathSegment(name) || name.startsWith('-')) {
    throw new BranchPilotUserError('invalid_github_repository', 'Repository name can contain letters, numbers, dots, underscores, and hyphens.')
  }

  return {
    ...request,
    owner,
    name,
    description: request.description.trim().slice(0, 350),
    visibility: request.visibility === 'private' ? 'private' : 'public',
    remoteName: request.remoteName?.trim() || 'origin',
    remoteProtocol: request.remoteProtocol === 'ssh' ? 'ssh' : 'https'
  }
}

async function writeRepositoryStarterFiles(rootPath: string, request: CreateGitHubRepositoryRequest): Promise<string[]> {
  const files = [
    { path: 'README.md', content: request.readme },
    { path: '.gitignore', content: request.gitignore }
  ].filter((file): file is { path: string; content: string } => Boolean(file.content?.trim()))
  const written: string[] = []

  for (const file of files) {
    const targetPath = path.join(rootPath, file.path)

    try {
      await fs.access(targetPath)
      continue
    } catch {
      await fs.writeFile(targetPath, ensureTrailingNewline(file.content), 'utf8')
      written.push(file.path)
    }
  }

  return written
}

function ensureTrailingNewline(content: string): string {
  return content.endsWith('\n') ? content : `${content}\n`
}

/**
 * True when `remoteUrl` refers to `owner/name` on GitHub, across the URL forms git
 * uses: `https://github.com/owner/name(.git)` and `git@github.com:owner/name(.git)`.
 * Used to recognize a dangling remote left by a half-finished publish so it can be
 * reused instead of blocking a fresh create.
 */
export function remoteMatchesRepository(remoteUrl: string, owner: string, name: string): boolean {
  const normalized = remoteUrl.trim().replace(/\.git$/i, '').replace(/\/+$/, '').toLowerCase()
  const target = `${owner}/${name}`.toLowerCase()

  // The separator before the owner is `/` for https and `:` for scp-style SSH.
  return normalized.endsWith(`/${target}`) || normalized.endsWith(`:${target}`)
}
