import { AgentRunStore } from '../../lib/agentRunStore.js'
import type { AgentRunListOptions, AgentRunDetailOptions } from './queryOptions.js'
import { normalizeLimit } from './queryPrimitives.js'
import { loadProjectMemorySnapshot } from './snapshotStore.js'

export async function getAgentRuns(options: AgentRunListOptions) {
  const snapshot = await loadProjectMemorySnapshot(options)

  if (!options.agentRunDir) {
    return {
      scannedAt: snapshot.scannedAt,
      repository: snapshot.repository,
      totalCount: 0,
      runs: []
    }
  }

  const runs = await new AgentRunStore(options.agentRunDir)
    .getRecentSummaries(snapshot.repository.rootPath, normalizeLimit(options.limit))

  return {
    scannedAt: snapshot.scannedAt,
    repository: snapshot.repository,
    totalCount: runs.length,
    runs
  }
}

export async function getAgentRunDetail(options: AgentRunDetailOptions) {
  const snapshot = await loadProjectMemorySnapshot(options)

  const run = options.agentRunDir
    ? await new AgentRunStore(options.agentRunDir).getRun(snapshot.repository.rootPath, options.id)
    : null

  return {
    scannedAt: snapshot.scannedAt,
    repository: snapshot.repository,
    run
  }
}
