import { RepositoryServiceCommitQueries } from './repositoryService.queries.commits.js'

/**
 * Read-only repository queries, composed from focused layers:
 * - repositoryService.queries.snapshot.ts - snapshot and status context
 * - repositoryService.queries.files.ts - file listing, content, chunks, search
 * - repositoryService.queries.diffs.ts - working-tree diffs and diff context
 * - repositoryService.queries.commits.ts - history and commit-level queries
 */
export abstract class RepositoryServiceQueries extends RepositoryServiceCommitQueries {}
