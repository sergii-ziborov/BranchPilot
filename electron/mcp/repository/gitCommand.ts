import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import type { MemoryQueryOptions } from '../memoryQueries.js'
import { GIT_EXECUTABLE } from '../../lib/platformExecutables.js'

const execFileAsync = promisify(execFile)

export async function requireRepositoryPath(options: MemoryQueryOptions): Promise<string> {
  const repoPath = options.repoPath?.trim()

  if (!repoPath) {
    throw new Error('Repository path is required. Recopy the BranchPilot MCP config from Reports > MCP.')
  }

  const resolved = path.resolve(repoPath)
  const stat = await fs.stat(resolved).catch(() => null)

  if (!stat?.isDirectory()) {
    throw new Error(`Repository path does not exist: ${repoPath}`)
  }

  return resolved
}

export async function git(repoPath: string, args: string[], maxBuffer = 4_000_000) {
  try {
    const result = await execFileAsync(GIT_EXECUTABLE, args, {
      cwd: repoPath,
      encoding: 'utf8',
      maxBuffer,
      windowsHide: true
    })

    return {
      stdout: result.stdout,
      stderr: result.stderr
    }
  } catch (error) {
    const details = error as { stdout?: string; stderr?: string; message?: string }
    const message = [details.stderr, details.stdout, details.message]
      .filter(Boolean)
      .join('\n')
      .trim()

    throw new Error(message || `Git command failed: git ${args.join(' ')}`, {
      cause: error
    })
  }
}
