import type { MemoryQueryOptions } from '../memoryQueries.js'
import type { GitHubDesktopCredential } from '../../providers/githubCliService.auth.js'
import { git, requireRepositoryPath } from './gitCommand.js'
import { normalizeMaxBytes, truncateText } from './normalization.js'
import {
  githubGraphql,
  githubJson,
  githubText,
  resolveGitHubCredential,
  resolveGitHubRepo,
  type GitHubRepoRef
} from './githubClient.js'

const MAX_FAILED_JOBS = 3
const MAX_THREADS = 20

export interface CiStatusOptions extends MemoryQueryOptions {
  ref?: string
  prNumber?: number
  runLimit?: number
  failedLogBytes?: number
}

export interface PullRequestOptions extends MemoryQueryOptions {
  number?: number
  includeDiff?: boolean
  maxBytes?: number
}

export interface PullRequestListOptions extends MemoryQueryOptions {
  state?: 'open' | 'closed' | 'merged' | 'all'
  base?: string
  limit?: number
}

interface GhCheckContext {
  name?: string
  context?: string
  status?: string
  conclusion?: string | null
  state?: string
}

interface RestRun {
  id: number
  name?: string
  display_title?: string
  status?: string
  conclusion?: string | null
  html_url?: string
  created_at?: string
}

interface RestJob {
  id: number
  name: string
  conclusion?: string | null
  html_url?: string
  steps?: Array<{ name: string; conclusion?: string | null }>
}

// One-call CI triage: runs for a branch/PR, the failed jobs of the newest failed run, and a bounded
// tail of each failed job's log — instead of paging raw CI output into the conversation.
export async function getCiStatus(options: CiStatusOptions) {
  const repoPath = await requireRepositoryPath(options)
  const credential = await resolveGitHubCredential()
  const repo = await resolveGitHubRepo(repoPath)
  const branch = await resolveBranch(repoPath, repo, credential, options)
  const runLimit = Math.min(20, Math.max(1, Math.floor(options.runLimit ?? 5)))
  const data = await githubJson(credential, `/repos/${repo.owner}/${repo.repo}/actions/runs`, {
    branch,
    per_page: String(runLimit)
  }) as { workflow_runs?: RestRun[] }
  const runs = (data.workflow_runs ?? []).map((run) => ({
    id: run.id,
    workflow: run.name ?? '',
    title: run.display_title ?? '',
    status: run.status,
    conclusion: run.conclusion ?? null,
    createdAt: run.created_at,
    url: run.html_url
  }))

  if (!runs.length) {
    return {
      repository: { rootPath: repoPath },
      branch,
      runs,
      note: `No GitHub Actions runs found for branch ${branch}.`
    }
  }

  const failedRun = runs.find((run) => run.conclusion === 'failure') ?? null
  const failedJobs = failedRun ? await collectFailedJobs(credential, repo, failedRun.id, options) : []

  return {
    repository: { rootPath: repoPath },
    branch,
    runs,
    failedRun: failedRun ? { id: failedRun.id, workflow: failedRun.workflow, url: failedRun.url } : null,
    failedJobs
  }
}

// PRs with CI check rollups and review state in one GraphQL call. For review priority or merge risk,
// feed each candidate's changed files (get_pull_request) into repo-lens change_impact.
export async function listPullRequests(options: PullRequestListOptions) {
  const repoPath = await requireRepositoryPath(options)
  const credential = await resolveGitHubCredential()
  const repo = await resolveGitHubRepo(repoPath)
  const limit = Math.min(50, Math.max(1, Math.floor(options.limit ?? 20)))
  const stateMap: Record<string, string[] | null> = {
    open: ['OPEN'],
    closed: ['CLOSED'],
    merged: ['MERGED'],
    all: null
  }
  const states = stateMap[options.state ?? 'open'] ?? ['OPEN']
  const query = `query($owner: String!, $name: String!, $states: [PullRequestState!], $base: String, $first: Int!) {
    repository(owner: $owner, name: $name) {
      pullRequests(states: $states, baseRefName: $base, first: $first, orderBy: {field: UPDATED_AT, direction: DESC}) {
        nodes {
          number title isDraft state url updatedAt
          author { login }
          baseRefName headRefName additions deletions changedFiles reviewDecision
          commits(last: 1) { nodes { commit { statusCheckRollup { contexts(first: 100) { nodes {
            __typename
            ... on CheckRun { name status conclusion }
            ... on StatusContext { context state }
          } } } } } }
        }
      }
    }
  }`
  const data = await githubGraphql(credential, query, {
    owner: repo.owner,
    name: repo.repo,
    states,
    base: options.base?.trim() || null,
    first: limit
  }) as {
    repository?: { pullRequests?: { nodes?: Array<{
      number: number
      title?: string
      isDraft?: boolean
      state?: string
      url?: string
      updatedAt?: string
      author?: { login?: string }
      baseRefName?: string
      headRefName?: string
      additions?: number
      deletions?: number
      changedFiles?: number
      reviewDecision?: string | null
      commits?: { nodes?: Array<{ commit?: { statusCheckRollup?: { contexts?: { nodes?: GhCheckContext[] } } | null } }> }
    }> } }
  }

  return {
    repository: { rootPath: repoPath },
    pullRequests: (data.repository?.pullRequests?.nodes ?? []).map((pr) => ({
      number: pr.number,
      title: pr.title ?? '',
      author: pr.author?.login,
      state: pr.state,
      isDraft: pr.isDraft ?? false,
      base: pr.baseRefName,
      head: pr.headRefName,
      additions: pr.additions,
      deletions: pr.deletions,
      changedFiles: pr.changedFiles,
      reviewDecision: pr.reviewDecision || 'NONE',
      updatedAt: pr.updatedAt,
      url: pr.url,
      checks: summarizeChecks(pr.commits?.nodes?.[0]?.commit?.statusCheckRollup?.contexts?.nodes)
    }))
  }
}

// One-call PR context: metadata, changed files, review decision, recent comments, unresolved review
// threads, and an optional bounded diff — the whole review-ready picture in one place.
export async function getPullRequest(options: PullRequestOptions) {
  const repoPath = await requireRepositoryPath(options)
  const credential = await resolveGitHubCredential()
  const repo = await resolveGitHubRepo(repoPath)
  const number = options.number ?? await resolveCurrentBranchPr(repoPath, repo, credential)
  const pr = await githubJson(credential, `/repos/${repo.owner}/${repo.repo}/pulls/${number}`) as {
    number: number
    title?: string
    state?: string
    merged_at?: string | null
    draft?: boolean
    user?: { login?: string }
    html_url?: string
    base?: { ref?: string }
    head?: { ref?: string }
    additions?: number
    deletions?: number
    changed_files?: number
    body?: string | null
  }
  const files = await githubJson(credential, `/repos/${repo.owner}/${repo.repo}/pulls/${number}/files`, { per_page: '100' }) as Array<{
    filename: string
    additions: number
    deletions: number
  }>
  const review = await fetchReviewContext(credential, repo, number).catch(() => null)
  const maxBytes = normalizeMaxBytes(options.maxBytes)
  const diff = options.includeDiff
    ? truncateText(await githubText(credential, `/repos/${repo.owner}/${repo.repo}/pulls/${number}`, 'application/vnd.github.diff'), maxBytes)
    : undefined

  return {
    repository: { rootPath: repoPath },
    pullRequest: {
      number: pr.number,
      title: pr.title ?? '',
      state: pr.merged_at ? 'MERGED' : (pr.state ?? '').toUpperCase(),
      isDraft: pr.draft ?? false,
      author: pr.user?.login,
      url: pr.html_url,
      base: pr.base?.ref,
      head: pr.head?.ref,
      additions: pr.additions,
      deletions: pr.deletions,
      changedFiles: pr.changed_files,
      reviewDecision: review?.reviewDecision || 'NONE',
      body: truncateText(pr.body ?? '', 4_000)
    },
    files: files.map((file) => ({ path: file.filename, additions: file.additions, deletions: file.deletions })),
    recentComments: review?.recentComments ?? [],
    unresolvedThreads: review?.unresolvedThreads ?? null,
    ...(diff !== undefined ? { diff } : {})
  }
}

async function resolveCurrentBranchPr(repoPath: string, repo: GitHubRepoRef, credential: GitHubDesktopCredential): Promise<number> {
  const branch = (await git(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD'])).stdout.trim()
  const lookup = async (state: string) => {
    const prs = await githubJson(credential, `/repos/${repo.owner}/${repo.repo}/pulls`, {
      head: `${repo.owner}:${branch}`,
      state,
      sort: 'updated',
      direction: 'desc'
    }) as Array<{ number: number }>
    return prs[0]?.number
  }
  const number = await lookup('open') ?? await lookup('all')

  if (!number) {
    throw new Error(`No pull request found for branch ${branch}.`)
  }

  return number
}

// reviewDecision, last comments, and unresolved threads come from one GraphQL query — none of them
// exist in the REST pull payload.
async function fetchReviewContext(credential: GitHubDesktopCredential, repo: GitHubRepoRef, prNumber: number) {
  const query = `query($owner: String!, $name: String!, $number: Int!) {
    repository(owner: $owner, name: $name) {
      pullRequest(number: $number) {
        reviewDecision
        comments(last: 3) { nodes { author { login } body createdAt } }
        reviewThreads(first: 50) { nodes { isResolved path line comments(first: 5) { nodes { author { login } body } } } }
      }
    }
  }`
  const data = await githubGraphql(credential, query, { owner: repo.owner, name: repo.repo, number: prNumber }) as {
    repository?: { pullRequest?: {
      reviewDecision?: string | null
      comments?: { nodes?: Array<{ author?: { login?: string }; body?: string; createdAt?: string }> }
      reviewThreads?: { nodes?: Array<{
        isResolved?: boolean
        path?: string
        line?: number | null
        comments?: { nodes?: Array<{ author?: { login?: string }; body?: string }> }
      }> }
    } }
  }
  const pullRequest = data.repository?.pullRequest

  return {
    reviewDecision: pullRequest?.reviewDecision ?? null,
    recentComments: (pullRequest?.comments?.nodes ?? []).map((comment) => ({
      author: comment.author?.login,
      createdAt: comment.createdAt,
      body: truncateText(comment.body ?? '', 1_000)
    })),
    unresolvedThreads: (pullRequest?.reviewThreads?.nodes ?? [])
      .filter((thread) => thread.isResolved === false)
      .slice(0, MAX_THREADS)
      .map((thread) => ({
        path: thread.path,
        line: thread.line ?? null,
        comments: (thread.comments?.nodes ?? []).map((comment) => ({
          author: comment.author?.login,
          body: truncateText(comment.body ?? '', 500)
        }))
      }))
  }
}

async function collectFailedJobs(credential: GitHubDesktopCredential, repo: GitHubRepoRef, runId: number, options: CiStatusOptions) {
  const failedLogBytes = Math.min(60_000, Math.max(2_000, Math.floor(options.failedLogBytes ?? 12_000)))
  const data = await githubJson(credential, `/repos/${repo.owner}/${repo.repo}/actions/runs/${runId}/jobs`, { per_page: '50' }) as { jobs?: RestJob[] }
  const jobs = (data.jobs ?? []).filter((job) => job.conclusion === 'failure').slice(0, MAX_FAILED_JOBS)

  return Promise.all(jobs.map(async (job) => {
    let logTail: string

    try {
      const log = await githubText(credential, `/repos/${repo.owner}/${repo.repo}/actions/jobs/${job.id}/logs`)
      logTail = tailText(log, failedLogBytes)
    } catch (error) {
      logTail = `Could not fetch the job log: ${error instanceof Error ? error.message : 'unknown error'}`
    }

    return {
      name: job.name,
      url: job.html_url,
      failedStep: job.steps?.find((step) => step.conclusion === 'failure')?.name,
      logTail
    }
  }))
}

async function resolveBranch(repoPath: string, repo: GitHubRepoRef, credential: GitHubDesktopCredential, options: CiStatusOptions): Promise<string> {
  if (options.ref?.trim()) {
    return options.ref.trim()
  }

  if (options.prNumber) {
    const pr = await githubJson(credential, `/repos/${repo.owner}/${repo.repo}/pulls/${options.prNumber}`) as { head?: { ref?: string } }

    if (pr.head?.ref) {
      return pr.head.ref
    }
  }

  const result = await git(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD'])
  return result.stdout.trim()
}

// gh mixes CheckRun (status/conclusion) and StatusContext (state) shapes — normalize both into one
// passed/failed/pending rollup so the caller never parses the raw contexts.
function summarizeChecks(rollup: GhCheckContext[] | null | undefined) {
  if (!rollup?.length) {
    return { total: 0, passed: 0, failed: 0, pending: 0, failedNames: [] as string[] }
  }

  let passed = 0
  let failed = 0
  let pending = 0
  const failedNames: string[] = []

  for (const check of rollup) {
    const outcome = (check.conclusion ?? check.state ?? '').toUpperCase()

    if (outcome === 'SUCCESS' || outcome === 'NEUTRAL' || outcome === 'SKIPPED') {
      passed += 1
    } else if (['FAILURE', 'ERROR', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE'].includes(outcome)) {
      failed += 1
      const name = check.name ?? check.context

      if (name && failedNames.length < 5) {
        failedNames.push(name)
      }
    } else {
      pending += 1
    }
  }

  return { total: rollup.length, passed, failed, pending, failedNames }
}

// Failure detail almost always sits at the END of a CI log — keep the tail, not the head.
function tailText(text: string, maxBytes: number): string {
  const buffer = Buffer.from(text)

  if (buffer.length <= maxBytes) {
    return text
  }

  return `[…showing last ${maxBytes} bytes]\n${buffer.subarray(buffer.length - maxBytes).toString('utf8')}`
}
