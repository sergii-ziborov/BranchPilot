import type { GitHubPullRequestDiffFile } from '../../src/shared/branchPilot.js'

export function splitUnifiedDiffByFile(text: string): string[] {
  const normalized = text.replace(/\r\n/g, '\n')
  const lines = normalized.endsWith('\n') ? normalized.slice(0, -1).split('\n') : normalized.split('\n')
  const files: string[] = []
  let current: string[] = []

  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      if (current.length > 0) {
        files.push(`${current.join('\n')}\n`)
      }

      current = [line]
    } else if (current.length > 0) {
      current.push(line)
    }
  }

  if (current.length > 0) {
    files.push(`${current.join('\n')}\n`)
  }

  return files
}

export function inferDiffFileStatus(oldPath: string | undefined, newPath: string): GitHubPullRequestDiffFile['status'] {
  if (!oldPath) return 'added'
  if (newPath === '/dev/null') return 'deleted'
  if (oldPath !== newPath) return 'renamed'
  return 'modified'
}

export function countPatchLines(text: string, prefix: '+' | '-'): number {
  return text
    .split('\n')
    .filter((line) => line.startsWith(prefix) && !line.startsWith(`${prefix}${prefix}${prefix}`))
    .length
}
