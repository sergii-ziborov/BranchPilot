import { STALE_BRANCH_THRESHOLD_DAYS } from './repositoryService.constants.js'
import type {
  BranchSummary,
  DashboardStaleBranch,
  ExportPatchRequest
} from '../../src/shared/branchPilot.js'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { parseUnifiedDiff } from './diffParser.js'
import { BranchPilotUserError } from './errors.js'
import { normalizeRelativePath } from './repositoryService.parsers.js'

export * from './repositoryService.parsers.js'

/** Pure helpers: path/name normalizers for RepositoryService. */

export function normalizeHunkPatch(patch: string, filePath: string): string {
  if (!patch.trim() || patch.includes('\0')) {
    throw new BranchPilotUserError('invalid_hunk_patch', 'Hunk patch is invalid.')
  }

  const files = parseUnifiedDiff(patch)

  if (files.length !== 1 || files[0].hunks.length !== 1) {
    throw new BranchPilotUserError('invalid_hunk_patch', 'Hunk patch must contain exactly one file hunk.')
  }

  const paths = [files[0].oldPath, files[0].newPath]
    .filter((candidate): candidate is string => Boolean(candidate) && candidate !== '/dev/null')
    .map((candidate) => normalizeRelativePath(candidate))

  if (!paths.includes(filePath)) {
    throw new BranchPilotUserError('invalid_hunk_patch', 'Hunk patch does not match the selected file.')
  }

  return patch.endsWith('\n') ? patch : `${patch}\n`
}


export function staleBranchesForRepository(repoPath: string, repoName: string, branches: BranchSummary[]): DashboardStaleBranch[] {
  const now = Date.now()

  return branches
    .filter((branch) => !branch.current && Boolean(branch.lastCommitAt))
    .map((branch) => {
      const committedAt = Date.parse(branch.lastCommitAt ?? '')
      const daysSinceCommit = Number.isNaN(committedAt)
        ? 0
        : Math.floor((now - committedAt) / (1000 * 60 * 60 * 24))

      return {
        repoPath,
        repoName,
        name: branch.name,
        lastCommitAt: branch.lastCommitAt ?? '',
        daysSinceCommit
      }
    })
    .filter((branch) => branch.daysSinceCommit >= STALE_BRANCH_THRESHOLD_DAYS)
    .sort((first, second) => second.daysSinceCommit - first.daysSinceCommit)
}

export function normalizeBranchName(branchName: string): string {
  const trimmed = branchName.trim()

  if (!trimmed || trimmed.startsWith('-') || trimmed.includes('\0')) {
    throw new BranchPilotUserError('invalid_branch', 'Invalid branch name.')
  }

  return trimmed
}

export function normalizeGitRef(ref: string): string {
  const trimmed = ref.trim()

  if (!trimmed || trimmed.startsWith('-') || trimmed.includes('\0')) {
    throw new BranchPilotUserError('invalid_ref', 'Invalid base ref.')
  }

  return trimmed
}

export function normalizeTagName(tagName: string): string {
  const trimmed = tagName.trim()

  if (!trimmed || trimmed.startsWith('-') || trimmed.includes('\0')) {
    throw new BranchPilotUserError('invalid_tag', 'Invalid tag name.')
  }

  return trimmed
}

export function normalizeRemoteName(name: string): string {
  const trimmed = name.trim()

  if (!/^[A-Za-z0-9._-]+$/.test(trimmed) || trimmed.startsWith('-')) {
    throw new BranchPilotUserError('invalid_remote', 'Remote name can contain letters, numbers, dots, underscores, and hyphens.')
  }

  return trimmed
}

export function normalizeRemoteUrl(url: string): string {
  const trimmed = url.trim()

  if (!trimmed || trimmed.includes('\0') || trimmed.startsWith('-')) {
    throw new BranchPilotUserError('invalid_remote_url', 'Remote URL is required.')
  }

  return trimmed
}

export function normalizeCloneRemoteUrl(remoteUrl: string): string {
  const trimmed = remoteUrl.trim()

  if (!trimmed || trimmed.includes('\0') || trimmed.startsWith('-')) {
    throw new BranchPilotUserError('invalid_clone_url', 'Clone URL is required.')
  }

  return trimmed
}

export function normalizeCloneParentPath(targetParentPath: string | undefined): string {
  const trimmed = targetParentPath?.trim()

  if (!trimmed || trimmed.includes('\0') || !path.isAbsolute(trimmed)) {
    throw new BranchPilotUserError('invalid_clone_target', 'Choose a folder to clone into.')
  }

  return path.resolve(trimmed)
}

export function normalizeCloneTargetName(targetName: string): string {
  const trimmed = targetName.trim()

  if (!/^[A-Za-z0-9._ -]+$/.test(trimmed) || trimmed.startsWith('.') || trimmed.includes('..')) {
    throw new BranchPilotUserError('invalid_clone_target', 'Clone folder name is invalid.')
  }

  return trimmed
}

export function cloneNameFromRemoteUrl(remoteUrl: string): string {
  const trimmed = remoteUrl.trim()
  const pathname = remoteUrlPathname(trimmed)
  const basename = path.basename(pathname).replace(/\.git$/i, '')

  return basename || 'repository'
}

export function remoteUrlPathname(remoteUrl: string): string {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(remoteUrl)) {
    try {
      return new URL(remoteUrl).pathname
    } catch {
      return remoteUrl
    }
  }

  const scpLike = /^(?:[^@\s]+@)?[^:\s]+:(?<path>[^\\\s]+)$/.exec(remoteUrl)

  if (scpLike?.groups?.path) {
    return scpLike.groups.path
  }

  return remoteUrl
}

export function normalizeWorktreePath(rootPath: string, targetPath: string | undefined, options: { allowInsideRoot?: boolean } = {}): string {
  const trimmed = targetPath?.trim()

  if (!trimmed || trimmed.includes('\0') || !path.isAbsolute(trimmed)) {
    throw new BranchPilotUserError('invalid_worktree_path', 'Worktree target path is required.')
  }

  const normalizedTarget = path.resolve(trimmed)
  const normalizedRoot = path.resolve(rootPath)

  if (!options.allowInsideRoot && (
    normalizedTarget === normalizedRoot
    || normalizedTarget.startsWith(`${normalizedRoot}${path.sep}`)
  )) {
    throw new BranchPilotUserError('invalid_worktree_path', 'Choose a worktree folder outside the current repository.')
  }

  return normalizedTarget
}

export async function normalizeExistingWorktreePath(rootPath: string, targetPath: string | undefined): Promise<string> {
  const normalizedTarget = normalizeWorktreePath(rootPath, targetPath, { allowInsideRoot: true })

  try {
    return path.resolve(await fs.realpath(normalizedTarget))
  } catch {
    return normalizedTarget
  }
}

export async function assertWorktreeTargetAvailable(targetPath: string): Promise<void> {
  if (await pathExists(targetPath)) {
    throw new BranchPilotUserError('worktree_path_exists', 'Worktree target folder already exists.')
  }
}

export function normalizePatchScope(scope: ExportPatchRequest['scope']): ExportPatchRequest['scope'] {
  if (scope !== 'working-tree' && scope !== 'staged') {
    throw new BranchPilotUserError('invalid_patch_scope', 'Invalid patch scope.')
  }

  return scope
}

export function normalizePatchOutputPath(outputPath?: string): string {
  const normalized = normalizePatchFilePath(outputPath, 'Patch output path is required.')

  if (!normalized.endsWith('.patch') && !normalized.endsWith('.diff')) {
    return `${normalized}.patch`
  }

  return normalized
}

export function normalizePatchInputPath(patchPath?: string): string {
  return normalizePatchFilePath(patchPath, 'Patch file path is required.')
}

export async function assertPatchFileExists(patchPath: string): Promise<void> {
  try {
    await fs.access(patchPath)
  } catch {
    throw new BranchPilotUserError('patch_not_found', 'Patch file could not be read.')
  }
}

export function normalizePatchFilePath(filePath: string | undefined, message: string): string {
  const trimmed = filePath?.trim()

  if (!trimmed || trimmed.includes('\0') || !path.isAbsolute(trimmed)) {
    throw new BranchPilotUserError('invalid_patch_path', message)
  }

  return trimmed
}

export function normalizeCommitSha(commitSha: string): string {
  const trimmed = commitSha.trim()

  if (!/^[a-fA-F0-9]{7,40}$/.test(trimmed)) {
    throw new BranchPilotUserError('invalid_commit', 'Invalid commit identifier.')
  }

  return trimmed
}

export function normalizeConfigValue(value: string, label: string): string {
  const trimmed = value.trim()

  if (!trimmed || trimmed.includes('\0')) {
    throw new BranchPilotUserError('invalid_git_config', `${label} is required.`)
  }

  return trimmed
}

export function normalizeStashMessage(message: string): string {
  const trimmed = message.trim()

  if (!trimmed || trimmed.includes('\0')) {
    throw new BranchPilotUserError('invalid_stash_message', 'Stash message is required.')
  }

  return trimmed
}

export function normalizeStashRef(stashRef: string): string {
  const trimmed = stashRef.trim()

  if (!/^stash@\{\d+\}$/.test(trimmed)) {
    throw new BranchPilotUserError('invalid_stash_ref', 'Invalid stash reference.')
  }

  return trimmed
}

export const MAX_IMAGE_PREVIEW_BYTES = 8 * 1024 * 1024

const IMAGE_MIME_BY_EXTENSION: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.avif': 'image/avif'
}

export function imageMimeFromPath(filePath: string): string | undefined {
  const dot = filePath.lastIndexOf('.')
  if (dot < 0) return undefined
  return IMAGE_MIME_BY_EXTENSION[filePath.slice(dot).toLowerCase()]
}

export function resolveRepositoryPath(rootPath: string, relativePath: string): string {
  const fullPath = path.resolve(rootPath, normalizeRelativePath(relativePath))
  const normalizedRoot = path.resolve(rootPath)

  if (!fullPath.startsWith(`${normalizedRoot}${path.sep}`) && fullPath !== normalizedRoot) {
    throw new BranchPilotUserError('invalid_path', 'Path escapes repository root.')
  }

  return fullPath
}

export async function readFilePrefix(filePath: string, maxBytes: number): Promise<Buffer> {
  const file = await fs.open(filePath, 'r')

  try {
    const buffer = Buffer.alloc(Math.max(0, maxBytes))
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0)

    return buffer.subarray(0, bytesRead)
  } finally {
    await file.close()
  }
}

export async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}
