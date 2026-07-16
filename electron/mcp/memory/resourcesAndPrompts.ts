import { getAgentActivity, getProjectSummary } from './memoryLookups.js'
import { getProjectHealth } from './projectHealth.js'
import type { MemoryQueryOptions } from './queryOptions.js'
import { loadProjectMemorySnapshot, loadProjectWikiSnapshot } from './snapshotStore.js'

export const MCP_RESOURCE_URIS = [
  'branchpilot://repo/current/summary',
  'branchpilot://repo/current/health',
  'branchpilot://repo/current/tree',
  'branchpilot://repo/current/commits',
  'branchpilot://repo/current/activity',
  'branchpilot://repo/current/wiki'
] as const

const MAX_RESOURCE_ITEMS = 500

export async function getResourcePayload(options: MemoryQueryOptions, uri: string): Promise<unknown> {
  const snapshot = await loadProjectMemorySnapshot(options)

  if (uri === 'branchpilot://repo/current/summary') {
    return getProjectSummary(options)
  }

  if (uri === 'branchpilot://repo/current/health') {
    return getProjectHealth({ ...options, limit: 100 })
  }

  if (uri === 'branchpilot://repo/current/tree') {
    return {
      scannedAt: snapshot.scannedAt,
      repository: snapshot.repository,
      files: snapshot.files.slice(0, MAX_RESOURCE_ITEMS)
    }
  }

  if (uri === 'branchpilot://repo/current/commits') {
    return {
      scannedAt: snapshot.scannedAt,
      repository: snapshot.repository,
      commits: snapshot.recentCommits
    }
  }

  if (uri === 'branchpilot://repo/current/activity') {
    return getAgentActivity({ ...options, limit: 100 })
  }

  if (uri === 'branchpilot://repo/current/wiki') {
    return loadProjectWikiSnapshot(options)
  }

  throw new Error(`Unknown BranchPilot resource: ${uri}`)
}

export function getPromptText(name: string): string {
  if (name === 'review-current-work') {
    return [
      'Use BranchPilot to understand current local work before reviewing changes.',
      'Start with project_summary, get_project_health, get_repository_status, and get_repository_diff, then read affected modules with list_repository_files/read_repository_file.',
      'If the repo-lens MCP is attached, use its graph tools and code search to trace symbols, callers, and dependents.',
      'Focus on consistency, security, correctness, and maintainability. Do not mutate files from MCP.'
    ].join('\n')
  }

  if (name === 'prepare-change-plan') {
    return [
      'Use BranchPilot Project Memory and live repository tools to map relevant files, health, recent commits, and current worktree state.',
      'Use get_project_health and get_repository_diff to identify high-risk files and current changes; list_repository_refs for branch context.',
      'If the repo-lens MCP is attached, use it to trace who imports/calls the code you plan to change.',
      'Return a concise implementation plan with risks, tests, and files likely to change.'
    ].join('\n')
  }

  if (name === 'explain-module') {
    return [
      'Use list_repository_files and read_repository_file to inspect the requested module, and get_file_history/get_repository_blame for how it evolved.',
      'If the repo-lens MCP is attached, use get_node/get_neighbors and read_source for symbol structure, callers, and dependents.',
      'Summarize responsibilities, important symbols, dependencies, and likely extension points.',
      'Mention Project Memory scannedAt so the user understands freshness.'
    ].join('\n')
  }

  if (name === 'summarize-recent-work') {
    return [
      'Use search_commit_history, get_recent_commits, get_agent_activity, and project_summary to summarize recent project work.',
      'Group changes by theme and identify follow-up work. Do not invent commits not present in Git, Project Memory, or Activity Log.'
    ].join('\n')
  }

  throw new Error(`Unknown BranchPilot prompt: ${name}`)
}

export function toJsonText(payload: unknown): string {
  return JSON.stringify(payload, null, 2)
}
