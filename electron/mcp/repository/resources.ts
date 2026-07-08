import type { MemoryQueryOptions } from '../memoryQueries.js'
import { getRepositoryStatus } from './statusQueries.js'
import { listRepositoryRefs } from './refQueries.js'
import { listRepositoryFiles } from './fileQueries.js'
import { getRepositoryDiff } from './diffQueries.js'

export const REPOSITORY_RESOURCE_URIS = [
  'branchpilot://repo/current/live-status',
  'branchpilot://repo/current/worktree',
  'branchpilot://repo/current/refs',
  'branchpilot://repo/current/diff'
] as const

export async function getRepositoryResourcePayload(options: MemoryQueryOptions, uri: string): Promise<unknown> {
  if (uri === 'branchpilot://repo/current/live-status') {
    return getRepositoryStatus(options)
  }

  if (uri === 'branchpilot://repo/current/worktree') {
    return listRepositoryFiles({ ...options, limit: 200 })
  }

  if (uri === 'branchpilot://repo/current/refs') {
    return listRepositoryRefs(options)
  }

  if (uri === 'branchpilot://repo/current/diff') {
    return getRepositoryDiff({ ...options, mode: 'all', maxBytes: 80_000 })
  }

  throw new Error(`Unknown BranchPilot repository resource: ${uri}`)
}
