import { promises as fs } from 'node:fs'
import type {
  DiffContextRequest,
  DiffContextResult,
  DiffRequest,
  DiffResult
} from '../../src/shared/branchPilot.js'
import { parseUnifiedDiff } from './diffParser.js'
import {
  normalizeRelativePath,
  resolveRepositoryPath
} from './repositoryService.helpers.js'
import {
  MAX_DIFF_BYTES,
  MAX_DIFF_OUTPUT_BYTES
} from './repositoryService.base.js'
import { RepositoryServiceFileQueries } from './repositoryService.queries.files.js'

export abstract class RepositoryServiceDiffQueries extends RepositoryServiceFileQueries {
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
}

function splitTextLines(text: string): string[] {
  const normalized = text.replace(/\r\n/g, '\n')
  const trimmed = normalized.endsWith('\n') ? normalized.slice(0, -1) : normalized
  if (!trimmed) return []

  return trimmed.split('\n')
}

export function diffContainsBinaryMarker(text: string): boolean {
  return /(?:^|\n)(?:Binary files .+ differ|GIT binary patch)(?:\n|$)/.test(text)
}
