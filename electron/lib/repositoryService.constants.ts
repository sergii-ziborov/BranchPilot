/**
 * Leaf constants for the RepositoryService chain. Importing these from a module
 * with no sibling dependencies keeps the base/queries/helpers files free of
 * runtime import cycles.
 */

/** Local branches with no commits for this many days are considered stale. */
export const STALE_BRANCH_THRESHOLD_DAYS = 30
