import type { MemoryQueryOptions } from '../memoryQueries.js'
import { getProjectHealth } from '../memory/projectHealth.js'
import { requireRepositoryPath } from './gitCommand.js'
import { getRepositoryStatus } from './statusQueries.js'
import { listRepositoryRefs } from './refQueries.js'
import { searchCommitHistory } from './historyQueries.js'

const OVERVIEW_CHANGE_LIMIT = 20
const OVERVIEW_COMMIT_LIMIT = 10
const OVERVIEW_HEALTH_LIMIT = 5
const OVERVIEW_BRANCH_LIMIT = 5

// One orientation call for the start of an assistant session: live status + refs summary +
// recent commits + top health files. Replaces the 4-call startup dance the workflow prompts
// otherwise require. Health comes from Project Memory and degrades to a note without a snapshot.
export async function getLiveOverview(options: MemoryQueryOptions) {
  const repoPath = await requireRepositoryPath(options)
  const [status, refs, history, health] = await Promise.all([
    getRepositoryStatus(options),
    listRepositoryRefs(options),
    searchCommitHistory({ ...options, limit: OVERVIEW_COMMIT_LIMIT }),
    getProjectHealth({ ...options, limit: OVERVIEW_HEALTH_LIMIT }).catch(() => null)
  ])

  return {
    repository: {
      rootPath: repoPath
    },
    branch: status.branch,
    clean: status.clean,
    counts: status.counts,
    changes: status.changes.slice(0, OVERVIEW_CHANGE_LIMIT),
    changesTruncated: status.changes.length > OVERVIEW_CHANGE_LIMIT,
    refs: {
      localBranchCount: refs.localBranches.length,
      remoteBranchCount: refs.remoteBranches.length,
      tagCount: refs.tags.length,
      worktreeCount: refs.worktrees.length,
      remotes: refs.remotes.map((remote) => remote.name),
      recentLocalBranches: [...refs.localBranches]
        .sort((left, right) => (right.committedAt ?? '').localeCompare(left.committedAt ?? ''))
        .slice(0, OVERVIEW_BRANCH_LIMIT)
        .map((branch) => branch.name)
    },
    recentCommits: history.commits,
    health: health
      ? {
        scannedAt: health.scannedAt,
        summary: health.summary,
        topFiles: health.files
      }
      : {
        note: 'Project Memory snapshot unavailable — scan Project Memory in BranchPilot for file-level health signals.'
      }
  }
}
