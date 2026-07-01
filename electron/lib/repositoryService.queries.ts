import { promises as fs } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import type {
  CommitCard,
  CommitDetails,
  CommitDetailsRequest,
  CommitSearchTextRequest,
  CommitSearchTextResult,
  CommitFileCompareRequest,
  CommitFileChange,
  CommitFileContentRequest,
  CommitFileContentResult,
  CommitFileDiffRequest,
  CommitSummary,
  DiffContextRequest,
  DiffContextResult,
  DiffRequest,
  DiffResult,
  FileChange,
  RecentRepository,
  RepositoryFileChunkRequest,
  RepositoryFileChunkResult,
  RepositoryFileContentRequest,
  RepositoryFileContentResult,
  RepositoryFileEntry,
  RepositorySnapshot,
  RepositoryStatus,
  RepositorySummary
} from '../../src/shared/branchPilot.js'
import { parseUnifiedDiff } from './diffParser.js'
import { parseGitStatus } from './gitStatusParser.js'
import {
  normalizeCommitSha,
  normalizeRelativePath,
  parseCommitHistory,
  pathExists,
  resolveRepositoryPath
} from './repositoryService.helpers.js'
import {
  MAX_DIFF_BYTES,
  MAX_DIFF_OUTPUT_BYTES
} from './repositoryService.base.js'
import { RepositoryServiceBase } from './repositoryService.base.js'
import { BranchPilotUserError } from './errors.js'

const MAX_COMMIT_FILE_CONTENT_BYTES = 900_000
const MAX_COMMIT_FILE_CONTENT_OUTPUT_BYTES = MAX_COMMIT_FILE_CONTENT_BYTES + 1
const MAX_COMMIT_SEARCH_DIFF_BYTES = 400_000
const MAX_COMMIT_SEARCH_DIFF_OUTPUT_BYTES = MAX_COMMIT_SEARCH_DIFF_BYTES + 1
const MAX_REPOSITORY_FILE_CONTENT_BYTES = 900_000
const DEFAULT_REPOSITORY_FILE_CHUNK_BYTES = 96_000
const MAX_REPOSITORY_FILE_CHUNK_BYTES = 192_000

export abstract class RepositoryServiceQueries extends RepositoryServiceBase {
  async getRecentRepositories(): Promise<RecentRepository[]> {
    return this.settings.getRecentRepositories()
  }

  async getSnapshot(repoPath: string): Promise<RepositorySnapshot> {
    const rootPath = await this.resolveRepositoryRoot(repoPath)
    const { summary, status } = await this.getRepositoryStatusContext(rootPath, { includeGitIdentity: true })
    const [branches, remoteBranches, tags, worktrees, submodules, lfs, recentRepositories] = await Promise.all([
      this.listBranches(rootPath),
      this.listRemoteBranches(rootPath),
      this.listTags(rootPath),
      this.listRepositoryWorktrees(rootPath),
      this.listRepositorySubmodules(rootPath),
      this.getRepositoryGitLfsSummary(rootPath),
      this.settings.getRecentRepositories()
    ])

    return this.cacheSnapshot({
      summary,
      status,
      branches,
      remoteBranches,
      tags,
      worktrees,
      submodules,
      lfs,
      recentRepositories
    })
  }

  async listRepositoryFiles(repoPath: string): Promise<RepositoryFileEntry[]> {
    const rootPath = await this.resolveRepositoryRoot(repoPath)
    const result = await this.git(rootPath, ['ls-files', '-co', '--exclude-standard', '-z'])

    return result.stdout
      .split('\0')
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b))
      .map((filePath) => ({ path: normalizeRelativePath(filePath) }))
  }

  async getRepositoryFileContent(request: RepositoryFileContentRequest): Promise<RepositoryFileContentResult> {
    const rootPath = await this.resolveRepositoryRoot(request.repoPath)
    const filePath = normalizeRelativePath(request.filePath)
    const absolutePath = resolveRepositoryPath(rootPath, filePath)
    const stats = await fs.stat(absolutePath).catch(() => undefined)

    if (!stats?.isFile()) {
      throw new BranchPilotUserError('file_not_found', 'File is not available in the working tree.')
    }
    if (stats.size > MAX_REPOSITORY_FILE_CONTENT_BYTES) {
      return { filePath, text: '', binary: false, tooLarge: true }
    }

    const text = await fs.readFile(absolutePath, 'utf8')
    const binary = text.includes('\0')

    return {
      filePath,
      text: binary ? '' : text,
      binary,
      tooLarge: false
    }
  }

  async getRepositoryFileChunk(request: RepositoryFileChunkRequest): Promise<RepositoryFileChunkResult> {
    const rootPath = await this.resolveRepositoryRoot(request.repoPath)
    const filePath = normalizeRelativePath(request.filePath)
    const absolutePath = resolveRepositoryPath(rootPath, filePath)
    const stats = await fs.stat(absolutePath).catch(() => undefined)

    if (!stats?.isFile()) {
      throw new BranchPilotUserError('file_not_found', 'File is not available in the working tree.')
    }

    const requestedOffset = Number.isFinite(request.offset) ? Math.max(0, Math.floor(request.offset)) : 0
    const startOffset = Math.min(requestedOffset, stats.size)
    const requestedMaxBytes = request.maxBytes && Number.isFinite(request.maxBytes)
      ? Math.floor(request.maxBytes)
      : DEFAULT_REPOSITORY_FILE_CHUNK_BYTES
    const maxBytes = Math.min(
      MAX_REPOSITORY_FILE_CHUNK_BYTES,
      Math.max(1, requestedMaxBytes)
    )
    const bytesToRead = Math.min(maxBytes, Math.max(0, stats.size - startOffset))

    if (bytesToRead === 0) {
      return {
        filePath,
        text: '',
        base64: request.mode === 'bytes' ? '' : undefined,
        binary: request.mode === 'bytes',
        byteSize: stats.size,
        startOffset,
        endOffset: startOffset,
        hasMore: false
      }
    }

    const file = await fs.open(absolutePath, 'r')
    try {
      const buffer = Buffer.alloc(bytesToRead)
      const { bytesRead } = await file.read(buffer, 0, bytesToRead, startOffset)
      let chunk = buffer.subarray(0, bytesRead)
      let endOffset = startOffset + bytesRead

      if (request.mode === 'bytes') {
        return {
          filePath,
          text: '',
          base64: chunk.toString('base64'),
          binary: true,
          byteSize: stats.size,
          startOffset,
          endOffset,
          hasMore: endOffset < stats.size
        }
      }

      if (chunk.includes(0)) {
        return {
          filePath,
          text: '',
          binary: true,
          byteSize: stats.size,
          startOffset,
          endOffset,
          hasMore: endOffset < stats.size
        }
      }

      if (endOffset < stats.size) {
        const lastLineBreak = chunk.lastIndexOf(0x0a)
        if (lastLineBreak > 0) {
          chunk = chunk.subarray(0, lastLineBreak + 1)
          endOffset = startOffset + lastLineBreak + 1
        }
      }

      return {
        filePath,
        text: chunk.toString('utf8'),
        binary: false,
        byteSize: stats.size,
        startOffset,
        endOffset,
        hasMore: endOffset < stats.size
      }
    } finally {
      await file.close()
    }
  }

  protected async getStatusOnlySnapshot(rootPath: string): Promise<RepositorySnapshot> {
    const cachedSnapshot = this.snapshotCache.get(rootPath)

    if (!cachedSnapshot) {
      return this.getSnapshot(rootPath)
    }

    const { summary, status } = await this.getRepositoryStatusContext(rootPath, { includeGitIdentity: true })
    const recentRepositories = await this.settings.getRecentRepositories()

    return this.cacheSnapshot({
      ...cachedSnapshot,
      summary,
      status,
      recentRepositories
    })
  }

  protected async getRepositoryStatusContext(rootPath: string, options: {
    includeGitIdentity?: boolean
  } = {}): Promise<{
    summary: RepositorySummary
    status: RepositoryStatus
  }> {
    let statusOutput = await this.git(rootPath, ['status', '--porcelain=v2', '-z', '--branch', '--untracked-files=all'])
    let parsedStatus = parseGitStatus(statusOutput.stdout)

    if (await this.pruneMissingStagedAdds(rootPath, parsedStatus.changes)) {
      statusOutput = await this.git(rootPath, ['status', '--porcelain=v2', '-z', '--branch', '--untracked-files=all'])
      parsedStatus = parseGitStatus(statusOutput.stdout)
    }
    const gitUserName = options.includeGitIdentity ? this.getConfig(rootPath, 'user.name') : Promise.resolve(undefined)
    const gitUserEmail = options.includeGitIdentity ? this.getConfig(rootPath, 'user.email') : Promise.resolve(undefined)
    const [remote, resolvedUserName, resolvedUserEmail, merge] = await Promise.all([
      this.getPrimaryRemote(rootPath),
      gitUserName,
      gitUserEmail,
      this.getMergeState(rootPath, parsedStatus.conflicts)
    ])

    const summary: RepositorySummary = {
      rootPath,
      name: path.basename(rootPath),
      currentBranch: parsedStatus.branch || 'Unknown',
      headOid: parsedStatus.headOid,
      upstream: parsedStatus.upstream,
      ahead: parsedStatus.ahead,
      behind: parsedStatus.behind,
      remoteName: remote?.name,
      remoteUrl: remote?.url,
      isDetached: parsedStatus.isDetached,
      gitUserName: resolvedUserName,
      gitUserEmail: resolvedUserEmail
    }

    return {
      summary,
      status: {
        summary,
        changes: parsedStatus.changes,
        counts: parsedStatus.counts,
        merge
      }
    }
  }

  private async pruneMissingStagedAdds(rootPath: string, changes: FileChange[]): Promise<boolean> {
    const missingStagedAdds: string[] = []

    for (const change of changes) {
      if (change.stagedStatus !== 'A' || change.unstagedStatus !== 'D') continue

      const relativePath = normalizeRelativePath(change.path)
      if (!await pathExists(path.join(rootPath, relativePath))) {
        missingStagedAdds.push(relativePath)
      }
    }

    if (missingStagedAdds.length === 0) return false

    await this.git(rootPath, ['restore', '--staged', '--', ...missingStagedAdds])
    return true
  }

  async getDiff(request: DiffRequest): Promise<DiffResult> {
    const rootPath = await this.resolveRepositoryRoot(request.repoPath)
    const relativePath = normalizeRelativePath(request.filePath)

    if (!request.staged && await this.isUntracked(rootPath, relativePath)) {
      return this.getUntrackedFilePreview(rootPath, relativePath)
    }

    const context = Number.isFinite(request.contextLines) ? Math.max(0, Math.min(100000, Math.trunc(request.contextLines as number))) : 3
    const args = ['diff', '--no-ext-diff', `--unified=${context}`]

    if (request.staged) {
      args.push('--cached')
    }

    if (request.ignoreWhitespace) {
      args.push('--ignore-all-space')
    }

    args.push('--', relativePath)

    const result = await this.git(rootPath, args, {
      allowedExitCodes: [0, 1],
      maxOutputBytes: MAX_DIFF_OUTPUT_BYTES
    })
    const binary = diffContainsBinaryMarker(result.stdout)
    const tooLarge = Boolean(result.stdoutTruncated) || result.stdout.length > MAX_DIFF_BYTES

    const text = tooLarge ? result.stdout.slice(0, MAX_DIFF_BYTES) : result.stdout

    return {
      filePath: relativePath,
      staged: request.staged,
      text,
      binary,
      tooLarge,
      files: binary || tooLarge ? [] : parseUnifiedDiff(text)
    }
  }

  async getDiffContext(request: DiffContextRequest): Promise<DiffContextResult> {
    const rootPath = await this.resolveRepositoryRoot(request.repoPath)
    const relativePath = normalizeRelativePath(request.filePath)
    const maxLines = Math.max(0, Math.min(20, Math.trunc(Number(request.maxLines) || 0)))
    const requestedStart = Math.max(1, Math.trunc(Number(request.lineStart) || 1))

    if (maxLines === 0) {
      return {
        filePath: relativePath,
        staged: request.staged,
        lineStart: requestedStart,
        lineEnd: requestedStart - 1,
        totalLines: 0,
        lines: [],
        hasMoreBefore: requestedStart > 1,
        hasMoreAfter: false
      }
    }

    const text = await this.readDiffContextText(rootPath, relativePath, request.staged)
    const lines = splitTextLines(text)
    const totalLines = lines.length
    const lineStart = Math.min(requestedStart, Math.max(totalLines, 1))
    const lineEnd = Math.min(totalLines, lineStart + maxLines - 1)
    const contextLines = lineStart <= lineEnd
      ? lines.slice(lineStart - 1, lineEnd).map((content, index) => {
        const lineNumber = lineStart + index
        return {
          type: 'context' as const,
          content,
          oldLineNumber: lineNumber,
          newLineNumber: lineNumber
        }
      })
      : []

    return {
      filePath: relativePath,
      staged: request.staged,
      lineStart,
      lineEnd,
      totalLines,
      lines: contextLines,
      hasMoreBefore: lineStart > 1,
      hasMoreAfter: lineEnd < totalLines
    }
  }

  private async readDiffContextText(rootPath: string, relativePath: string, staged: boolean): Promise<string> {
    const tryIndex = async () => this.readGitText(rootPath, `:${relativePath}`)
    const tryHead = async () => this.readGitText(rootPath, `HEAD:${relativePath}`)
    const tryWorkingTree = async () => fs.readFile(resolveRepositoryPath(rootPath, relativePath), 'utf8')

    if (staged) {
      return tryIndex().catch(() => tryHead())
    }

    return tryWorkingTree()
      .catch(() => tryIndex())
      .catch(() => tryHead())
  }

  private async readGitText(rootPath: string, ref: string): Promise<string> {
    const result = await this.git(rootPath, ['show', ref], {
      allowedExitCodes: [0, 128],
      maxOutputBytes: MAX_DIFF_OUTPUT_BYTES
    })

    if (result.exitCode !== 0) {
      throw new Error(result.stderr.trim() || `Git object not found: ${ref}`)
    }

    return result.stdout
  }

  async getHistory(repoPath: string): Promise<CommitSummary[]> {
    const rootPath = await this.resolveRepositoryRoot(repoPath)
    const result = await this.git(rootPath, [
      '-c',
      'color.ui=always',
      'log',
      '--graph',
      '--color=always',
      '--topo-order',
      'HEAD',
      '--branches',
      '--remotes',
      '--max-count=200',
      '--date=iso-strict',
      '--pretty=format:%x1f%H%x00%h%x00%s%x00%P%x00%an%x00%ae%x00%ad'
    ], {
      allowedExitCodes: [0, 128]
    })

    if (result.exitCode !== 0 || !result.stdout.trim()) {
      return []
    }

    return parseCommitHistory(result.stdout)
  }

  private async resolveCommitRevision(rootPath: string, revision: string): Promise<string> {
    const trimmed = revision.trim()

    if (/^[a-fA-F0-9]{7,40}$/.test(trimmed)) {
      return normalizeCommitSha(trimmed)
    }

    if (!trimmed || trimmed.includes('\0') || trimmed.startsWith('-') || trimmed.includes('..')) {
      throw new BranchPilotUserError('invalid_commit', 'Invalid commit identifier.')
    }

    const result = await this.git(rootPath, ['rev-parse', '--verify', `${trimmed}^{commit}`])
    return normalizeCommitSha(result.stdout.trim().split(/\s+/)[0] ?? '')
  }

  async getCommitDetails(request: CommitDetailsRequest): Promise<CommitDetails> {
    const rootPath = await this.resolveRepositoryRoot(request.repoPath)
    const commitSha = await this.resolveCommitRevision(rootPath, request.commitSha)
    const metadata = await this.git(rootPath, [
      'show',
      '-s',
      '--date=iso-strict',
      '--format=%H%x00%h%x00%s%x00%b%x00%P%x00%an%x00%ae%x00%ad',
      commitSha
    ])
    const [sha, shortSha, subject, body, parentShasText, authorName, authorEmail, authoredAt] = metadata.stdout.split('\0')

    const parentShas = parentShasText ? parentShasText.split(' ').filter(Boolean) : []

    return {
      sha,
      shortSha,
      subject,
      parentShas,
      body: body.trim(),
      authorName,
      authorEmail,
      authoredAt: authoredAt.trim(),
      files: await this.getCommitFiles(rootPath, commitSha, parentShas),
      containingBranches: await this.getCommitContainingBranches(rootPath, commitSha)
    }
  }

  async getCommitCard(request: CommitDetailsRequest): Promise<CommitCard> {
    const rootPath = await this.resolveRepositoryRoot(request.repoPath)
    const commitSha = await this.resolveCommitRevision(rootPath, request.commitSha)
    const metadata = await this.git(rootPath, [
      'show',
      '-s',
      '--date=iso-strict',
      '--format=%H%x00%h%x00%s%x00%b%x00%an%x00%ae%x00%ad%x00%D',
      commitSha
    ])
    const [sha, shortSha, subject, body, authorName, authorEmail, authoredAt, refNames] = metadata.stdout.split('\0')

    // Diff summary against the first parent (matches what GitLens shows for merges too).
    const stat = await this.git(rootPath, ['show', '--shortstat', '--first-parent', '--format=', commitSha], {
      allowedExitCodes: [0, 1]
    })
    const { filesChanged, insertions, deletions } = parseShortStat(stat.stdout)
    const { tags, branches } = parseRefNames(refNames ?? '')

    return {
      sha,
      shortSha: shortSha || sha.slice(0, 7),
      subject: subject || '',
      body: (body ?? '').trim(),
      authorName: authorName || '',
      authorEmail: authorEmail || '',
      authoredAt: (authoredAt ?? '').trim(),
      avatarUrl: gravatarUrl(authorEmail),
      filesChanged,
      insertions,
      deletions,
      tags,
      branches
    }
  }

  async getCommitSearchText(request: CommitSearchTextRequest): Promise<CommitSearchTextResult> {
    const rootPath = await this.resolveRepositoryRoot(request.repoPath)
    const commitSha = await this.resolveCommitRevision(rootPath, request.commitSha)
    const parentShas = await this.getCommitParentShas(rootPath, commitSha)
    const files = await this.getCommitFiles(rootPath, commitSha, parentShas)
    const args = parentShas.length === 0
      ? ['show', '--format=', '--no-ext-diff', '--find-renames', '--unified=0', '--no-color', commitSha]
      : ['diff', '--no-ext-diff', '--find-renames', '--unified=0', '--no-color', ...this.commitDiffRefs(commitSha, parentShas)]
    const result = await this.git(rootPath, args, {
      allowedExitCodes: [0, 1],
      maxOutputBytes: MAX_COMMIT_SEARCH_DIFF_OUTPUT_BYTES
    })
    const diffText = result.stdout.length > MAX_COMMIT_SEARCH_DIFF_BYTES
      ? result.stdout.slice(0, MAX_COMMIT_SEARCH_DIFF_BYTES)
      : result.stdout

    return {
      commitSha,
      filesText: commitFilesSearchText(files),
      changesText: commitDiffSearchText(diffText),
      truncated: Boolean(result.stdoutTruncated) || result.stdout.length > MAX_COMMIT_SEARCH_DIFF_BYTES
    }
  }

  async getCommitFileDiff(request: CommitFileDiffRequest): Promise<DiffResult> {
    const rootPath = await this.resolveRepositoryRoot(request.repoPath)
    const commitSha = await this.resolveCommitRevision(rootPath, request.commitSha)
    const filePath = normalizeRelativePath(request.filePath)
    const parentShas = await this.getCommitParentShas(rootPath, commitSha)
    const args = parentShas.length === 0
      ? ['show', '--format=', '--no-ext-diff', '--find-renames', commitSha, '--', filePath]
      : ['diff', '--no-ext-diff', '--find-renames', ...this.commitDiffRefs(commitSha, parentShas), '--', filePath]
    const result = await this.git(rootPath, args, {
      allowedExitCodes: [0, 1],
      maxOutputBytes: MAX_DIFF_OUTPUT_BYTES
    })
    const binary = diffContainsBinaryMarker(result.stdout)
    const tooLarge = Boolean(result.stdoutTruncated) || result.stdout.length > MAX_DIFF_BYTES

    const text = tooLarge ? result.stdout.slice(0, MAX_DIFF_BYTES) : result.stdout

    return {
      filePath,
      staged: false,
      text,
      binary,
      tooLarge,
      files: binary || tooLarge ? [] : parseUnifiedDiff(text)
    }
  }

  async getCommitFileContent(request: CommitFileContentRequest): Promise<CommitFileContentResult> {
    const rootPath = await this.resolveRepositoryRoot(request.repoPath)
    const commitSha = await this.resolveCommitRevision(rootPath, request.commitSha)
    const filePath = normalizeRelativePath(request.filePath)
    const result = await this.git(rootPath, ['cat-file', 'blob', `${commitSha}:${filePath}`], {
      maxOutputBytes: MAX_COMMIT_FILE_CONTENT_OUTPUT_BYTES
    })
    const tooLarge = Boolean(result.stdoutTruncated) || result.stdout.length > MAX_COMMIT_FILE_CONTENT_BYTES
    const text = tooLarge ? result.stdout.slice(0, MAX_COMMIT_FILE_CONTENT_BYTES) : result.stdout
    const binary = text.includes('\0')

    return {
      commitSha,
      filePath,
      text: binary ? '' : text,
      binary,
      tooLarge
    }
  }

  async getCommitFileCompareDiff(request: CommitFileCompareRequest): Promise<DiffResult> {
    const rootPath = await this.resolveRepositoryRoot(request.repoPath)
    const commitSha = await this.resolveCommitRevision(rootPath, request.commitSha)
    const compareCommitSha = await this.resolveCommitRevision(rootPath, request.compareCommitSha)
    const filePath = normalizeRelativePath(request.filePath)
    const result = await this.git(rootPath, ['diff', '--no-ext-diff', '--find-renames', compareCommitSha, commitSha, '--', filePath], {
      allowedExitCodes: [0, 1],
      maxOutputBytes: MAX_DIFF_OUTPUT_BYTES
    })
    const binary = diffContainsBinaryMarker(result.stdout)
    const tooLarge = Boolean(result.stdoutTruncated) || result.stdout.length > MAX_DIFF_BYTES
    const text = tooLarge ? result.stdout.slice(0, MAX_DIFF_BYTES) : result.stdout

    return {
      filePath,
      staged: false,
      text,
      binary,
      tooLarge,
      files: binary || tooLarge ? [] : parseUnifiedDiff(text)
    }
  }



}

function splitTextLines(text: string): string[] {
  const normalized = text.replace(/\r\n/g, '\n')
  const trimmed = normalized.endsWith('\n') ? normalized.slice(0, -1) : normalized
  if (!trimmed) return []

  return trimmed.split('\n')
}

function diffContainsBinaryMarker(text: string): boolean {
  return /(?:^|\n)(?:Binary files .+ differ|GIT binary patch)(?:\n|$)/.test(text)
}

function parseShortStat(output: string): { filesChanged: number; insertions: number; deletions: number } {
  const files = /(\d+)\s+files?\s+changed/.exec(output)
  const inserted = /(\d+)\s+insertions?\(\+\)/.exec(output)
  const deleted = /(\d+)\s+deletions?\(-\)/.exec(output)

  return {
    filesChanged: files ? Number(files[1]) : 0,
    insertions: inserted ? Number(inserted[1]) : 0,
    deletions: deleted ? Number(deleted[1]) : 0
  }
}

function commitFilesSearchText(files: CommitFileChange[]): string {
  return files
    .flatMap((file) => [file.path, file.originalPath, file.status, file.rawStatus])
    .filter((value): value is string => Boolean(value))
    .join('\n')
}

function commitDiffSearchText(diffText: string): string {
  const lines: string[] = []

  for (const line of diffText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')) {
    if (!line) continue

    if (line.startsWith('@@')) {
      lines.push(line)
      continue
    }

    if (line.startsWith('Binary files ') || line.startsWith('GIT binary patch')) {
      lines.push(line)
      continue
    }

    if (line.startsWith('+++') || line.startsWith('---')) continue
    if (!line.startsWith('+') && !line.startsWith('-')) continue

    lines.push(line, line.slice(1))
  }

  return lines.join('\n')
}

function parseRefNames(refNames: string): { tags: string[]; branches: string[] } {
  const tags: string[] = []
  const branches: string[] = []

  for (const raw of refNames.split(',')) {
    const entry = raw.trim()
    if (!entry) continue
    if (entry.startsWith('tag: ')) {
      tags.push(entry.slice('tag: '.length).trim())
    } else {
      const name = entry.startsWith('HEAD -> ') ? entry.slice('HEAD -> '.length).trim() : entry
      if (name && name !== 'HEAD' && !name.endsWith('/HEAD')) branches.push(name)
    }
  }

  return { tags, branches }
}

function gravatarUrl(email: string): string | undefined {
  const normalized = (email ?? '').trim().toLowerCase()
  if (!normalized) return undefined
  const hash = createHash('md5').update(normalized).digest('hex')
  return `https://www.gravatar.com/avatar/${hash}?s=72&d=404`
}
