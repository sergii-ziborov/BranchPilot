import { promises as fs } from 'node:fs'
import type { DiffHunk, DiffLine, DiffResult } from '../../src/shared/branchPilot.js'
import { readFilePrefix, resolveRepositoryPath } from './repositoryService.helpers.js'

interface UntrackedPreviewOptions {
  maxDiffBytes: number
  maxOutputBytes: number
}

export async function readUntrackedFilePreview(
  rootPath: string,
  filePath: string,
  options: UntrackedPreviewOptions
): Promise<DiffResult> {
  const fullPath = resolveRepositoryPath(rootPath, filePath)
  const fileStats = await fs.stat(fullPath)

  if (fileStats.isDirectory()) {
    return {
      filePath,
      staged: false,
      text: 'Untracked directory â€” open it to see individual files.',
      binary: false,
      tooLarge: false,
      files: []
    }
  }

  const file = await readFilePrefix(fullPath, options.maxOutputBytes)
  const binary = file.includes(0)
  const tooLarge = fileStats.size > options.maxDiffBytes
  const content = binary ? '' : file.toString('utf8').slice(0, options.maxDiffBytes)
  const lines = binary || tooLarge ? [] : splitPreviewLines(content)
  const text = binary ? 'Binary untracked file.' : buildUntrackedUnifiedDiff(filePath, lines)

  return {
    filePath,
    staged: false,
    text,
    binary,
    tooLarge,
    files: binary || tooLarge ? [] : [{
      newPath: filePath,
      hunks: [buildUntrackedHunk(filePath, lines)]
    }]
  }
}

function splitPreviewLines(content: string): string[] {
  const normalized = content.replace(/\r\n/g, '\n')

  if (!normalized) return []

  return normalized.endsWith('\n')
    ? normalized.slice(0, -1).split('\n')
    : normalized.split('\n')
}

function buildUntrackedHunk(filePath: string, lines: string[]): DiffHunk {
  const diffLines: DiffLine[] = lines.map((content, index) => ({
    type: 'add',
    content,
    newLineNumber: index + 1
  }))
  const header = `@@ -0,0 +1,${lines.length} @@`

  return {
    header,
    oldStart: 0,
    oldLines: 0,
    newStart: 1,
    newLines: lines.length,
    lines: diffLines,
    patch: buildUntrackedUnifiedDiff(filePath, lines)
  }
}

function buildUntrackedUnifiedDiff(filePath: string, lines: string[]): string {
  const body = lines.map((line) => `+${line}`)

  return [
    `diff --git a/${filePath} b/${filePath}`,
    'new file mode 100644',
    '--- /dev/null',
    `+++ b/${filePath}`,
    `@@ -0,0 +1,${lines.length} @@`,
    ...body
  ].join('\n')
}
