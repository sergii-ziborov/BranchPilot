import { createHash } from 'node:crypto'
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
  DiffResult
} from '../../src/shared/branchPilot.js'
import { parseUnifiedDiff } from './diffParser.js'
import {
  normalizeCommitSha,
  normalizeRelativePath,
  parseCommitHistory
} from './repositoryService.helpers.js'
import {
  MAX_DIFF_BYTES,
  MAX_DIFF_OUTPUT_BYTES
} from './repositoryService.base.js'
import {
  RepositoryServiceDiffQueries,
  diffContainsBinaryMarker
} from './repositoryService.queries.diffs.js'
import { BranchPilotUserError } from './errors.js'

const MAX_COMMIT_FILE_CONTENT_BYTES = 900_000
const MAX_COMMIT_FILE_CONTENT_OUTPUT_BYTES = MAX_COMMIT_FILE_CONTENT_BYTES + 1
const MAX_COMMIT_SEARCH_DIFF_BYTES = 400_000
const MAX_COMMIT_SEARCH_DIFF_OUTPUT_BYTES = MAX_COMMIT_SEARCH_DIFF_BYTES + 1

export abstract class RepositoryServiceCommitQueries extends RepositoryServiceDiffQueries {
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
