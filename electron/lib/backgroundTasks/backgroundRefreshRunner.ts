import type { GitMonitorSettings } from '../../../src/shared/branchPilot.js'

/**
 * The concrete work each background refresh task performs. Every function is
 * injected (from main.ts) so this runner stays decoupled from the underlying
 * services and reuses the exact same code paths the IPC handlers call.
 *
 * A task may be omitted (undefined) when its capability is unavailable — the
 * runner simply skips it.
 */
export interface BackgroundRefreshTasks {
  /** Background `git fetch` for the active repo (remote-tracking refs only). */
  fetchRepo?: (repoPath: string) => Promise<unknown>
  /** Warm the GitHub repo-list cache used by the Clone dialog. */
  refreshRepoList?: () => Promise<unknown>
  /** Prime the contribution-graph cache for the active repo (Reports view). */
  prefetchReportsGraph?: (repoPath: string) => Promise<unknown>
  /** Refresh the current GitHub account/identity info. */
  refreshAccount?: () => Promise<unknown>
  /** Scan/sync project memory so the MCP/agent sees fresh data. */
  syncMemory?: (repoPath: string) => Promise<unknown>
}

type TaskKey = keyof BackgroundRefreshTasks

// Independent short floors per task so an aggressive poll interval never turns
// into a storm of expensive work. Milliseconds.
const TASK_FLOOR_MS: Record<TaskKey, number> = {
  // Fetch touches the network + object store — keep it gentle even when the
  // user picked a sub-90s poll interval.
  fetchRepo: 90_000,
  // Mirrors the repo-list cache TTL so an open right after a prime is instant.
  refreshRepoList: 60_000,
  prefetchReportsGraph: 120_000,
  refreshAccount: 120_000,
  // Heaviest task (walks the working tree) — at most once every ~10 minutes.
  syncMemory: 600_000
}

interface TaskRuntimeState {
  running: boolean
  lastRunAt: number
}

/**
 * Runs the opt-in background refresh tasks on each monitor poll tick. Every task
 * is:
 *  - individually gated by its GitMonitorSettings sub-toggle,
 *  - throttled by an in-memory per-task floor (never spams),
 *  - guarded so it never overlaps its own previous still-running invocation,
 *  - fully isolated — a slow or failing task can neither block the others nor
 *    crash the app (all errors are swallowed to console.error).
 *
 * `run()` returns immediately; tasks execute fire-and-forget in the background.
 */
export class BackgroundRefreshRunner {
  private readonly state = new Map<TaskKey, TaskRuntimeState>()

  constructor(private readonly tasks: BackgroundRefreshTasks) {}

  /**
   * Kick every enabled task for the given repo. Non-blocking: schedules the work
   * and returns. Called once per poll tick alongside the existing PR check.
   */
  run(settings: GitMonitorSettings, repoPath: string): void {
    if (!repoPath) return

    this.maybeRun('fetchRepo', settings.periodicFetch, () => this.tasks.fetchRepo?.(repoPath))
    this.maybeRun('refreshRepoList', settings.refreshRepoList, () => this.tasks.refreshRepoList?.())
    this.maybeRun('prefetchReportsGraph', settings.prefetchReportsGraph, () =>
      this.tasks.prefetchReportsGraph?.(repoPath)
    )
    this.maybeRun('refreshAccount', settings.refreshAccount, () => this.tasks.refreshAccount?.())
    this.maybeRun('syncMemory', settings.syncMemory, () => this.tasks.syncMemory?.(repoPath))
  }

  private maybeRun(key: TaskKey, enabled: boolean, invoke: () => Promise<unknown> | undefined): void {
    if (!enabled) return

    const state = this.stateFor(key)
    // Never overlap the previous still-running invocation of the same task.
    if (state.running) return
    // Respect the per-task floor so a tight poll interval never spams the task.
    if (state.lastRunAt !== 0 && Date.now() - state.lastRunAt < TASK_FLOOR_MS[key]) return

    const work = (() => {
      try {
        return invoke()
      } catch (error) {
        // Synchronous throw from the task wiring — treat like a rejected run.
        return Promise.reject(error)
      }
    })()

    // The task is unavailable (dep not wired) — do nothing, don't record a run.
    if (!work) return

    state.running = true
    state.lastRunAt = Date.now()
    void Promise.resolve(work)
      .catch((error) => {
        // Swallow: a failed refresh must never crash or spam. Log for diagnosis.
        console.error(`[BranchPilot] background refresh task "${key}" failed:`, error)
      })
      .finally(() => {
        state.running = false
      })
  }

  private stateFor(key: TaskKey): TaskRuntimeState {
    let state = this.state.get(key)
    if (!state) {
      state = { running: false, lastRunAt: 0 }
      this.state.set(key, state)
    }
    return state
  }
}
