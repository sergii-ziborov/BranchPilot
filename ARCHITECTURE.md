# BranchPilot — Architecture

BranchPilot is a local-first Git desktop client built on Electron, React 19 and
TypeScript (Vite + vitest). It reads real repository state through the system
`git` binary and the GitHub CLI, and offers optional AI assistants for commit
messages, branch drafts, reviews and more.

The codebase is organised so that **no source file exceeds ~1000 lines** and
each module has a single responsibility. Dependencies flow toward small, stable
modules (shared types, error and command primitives); there are **no runtime
import cycles**.

## Process model

Electron runs two processes that never share memory:

- **Main process** (`electron/`) — Node side. Owns all privileged work: running
  `git`, talking to the GitHub CLI, file system access, settings, activity log,
  project memory, and the AI assistant runners. Exposes everything to the UI as
  a typed IPC surface.
- **Renderer process** (`src/`) — the React UI. Has no direct file or git
  access; it calls the main process through `window.branchPilot`, a typed bridge
  injected by `electron/preload.cts`.

The contract between them is the `BranchPilotApi` interface plus an explicit
channel allowlist, both defined in `src/shared/` so each side imports the same
types.

## Renderer (`src/`)

```
src/
  App.tsx                 composition root (presenter): destructures the
                          controller and renders the view tree + dialogs
  hooks/useAppController   aggregating hook: owns core state, the run* action
                          helpers, and wires every domain hook together
  hooks/use*              one hook per domain (Changes, History, Branches,
                          Commit, Merge, Stash, Providers, Assistants, Review,
                          GitConfig, ProjectMemory, DailyReview, LinkedIn) plus
                          usePrompts, useRepositoryManagement, useVirtualList
  components/             shared presentational components (sidebar, topbar,
                          dialogs, diff view, panels, primitives)
  components/views/       one component per tab/view, fed by props only
  lib/                    pure UI helpers and label/format functions
  shared/                 isomorphic code shared with the main process:
                          types, IPC channel list, pure precondition logic
  styles/                 App.css split into cascade-preserving partials
```

### Key patterns

- **Aggregating controller.** `App.tsx` is a thin presenter. All wiring lives in
  `useAppController`, which holds the core snapshot/busy/notice/error state, the
  `run*` action wrappers (`runApiAction`, `runSnapshotAction`,
  `runOperationAction`, `runBusyOperation`) and `applySnapshot*`, then calls each
  domain hook and returns a single object the view tree consumes.
- **Dependency-injected hooks.** Every domain hook receives a `deps` object
  (`api`, `currentRepoPath`, `setNotice`, the `run*` helpers, etc.) instead of
  reaching for globals. This keeps hooks independently testable and avoids
  hidden coupling.
- **Render-props for shared panels.** Cross-view panels (pre-commit review,
  assistant readiness/policy, GitHub browser, PR details) are passed into views
  as `() => ReactNode` functions so closures stay in one place.
- **Windowed lists.** `useVirtualList` returns a callback ref plus the visible
  window/items; consumers destructure it into locals once (required to satisfy
  the `react-hooks/refs` compiler rule).

## Main process (`electron/`)

```
electron/
  main.ts                 app bootstrap: builds service instances + IPC helpers,
                          creates the window
  preload.cts             typed window.branchPilot bridge (invoke side)
  ipc/ipcHelpers          createIpcHelpers(): handle/handleLogged/
                          handleAssistantAction/handleUnwrapped + repo-path and
                          dialog helpers (the registration toolkit)
  ipc/registerIpcHandlers thin orchestrator: calls the domain handler modules
  ipc/handlers/           IPC registration split by domain
                          (repository, git, providers, assistants)
  ipc/ipcTypes            shared deps interface + withProjectMemoryRefresh
  lib/                    services (repository, settings, editor, activity log,
                          assistant policy, project memory/wiki, daily review)
                          and primitives (commandRunner, errors, parsers)
  providers/              GitHub CLI + HTTP API bridge (main / api / parsers)
  assistants/             AI assistant runner, split into focused modules
  mcp/                    project-memory MCP server
```

### RepositoryService inheritance chain

`RepositoryService` is the largest service. Rather than one 2400-line class it is
split across an inheritance chain so `this` dispatch is unchanged and the
compiler enforces the partition:

- `repositoryService.base.ts` — `RepositoryServiceBase`: constructor, the `git`
  primitive, config/remote helpers, all `assert*` guards and private read
  helpers (`list*`).
- `repositoryService.queries.ts` — `RepositoryServiceQueries extends Base`: read
  / query methods (`getSnapshot`, diff, history, dashboard, compare, list*).
- `repositoryService.ts` — `RepositoryService extends Queries`: mutating
  operations (open/clone, stage/commit, branches, tags, worktrees, stash,
  merge/rebase, patches).
- `repositoryService.helpers.ts` — pure free functions (path/name normalizers,
  git output parsers) used by all three.

The provider and assistant modules follow the same idea: a thin entry module
plus `*.api`, `*.parsers`, `*.schemas`, `*.context`, `*.exec`, `*.runners`
siblings of pure or cohesive functions.

## Shared types (`src/shared/branchPilot.ts`)

The type surface is a **barrel**. `branchPilot.ts` only re-exports its domain
partials:

```
branchPilot.ts            export * from core / memory / assistants / gitops / Api
branchPilot.core.ts       repository, status, dashboard, branch, worktree, lfs
branchPilot.memory.ts     project memory + wiki
branchPilot.assistants.ts assistant policy, activity log, daily review
branchPilot.gitops.ts     diffs, commits, requests, generated artifacts, review
branchPilotApi.ts         BranchPilotApi interface + GitHub PR/repo types
```

Both processes import from `branchPilot`, so the barrel keeps every consumer
stable while the definitions live in focused files. Cross-file imports use
explicit `.js` extensions because the electron project compiles with
`moduleResolution: NodeNext`.

## Verification

Two TypeScript projects must both be checked — `tsc -b` does **not** cover the
electron code:

```
npx tsc -b                          # app/renderer (tsconfig.app.json = src/)
npx tsc -p tsconfig.electron.json   # main process (NodeNext)
npx eslint .                        # lint (react-hooks compiler rules included)
npx vitest run                      # unit + component (SSR) tests
```

Full production build: `tsc -b && vite build && tsc -p tsconfig.electron.json`.

Notes for the sandbox: behavioural git tests need `git >= 2.36`
(`worktree list --porcelain -z`); on older git they fail purely on the
environment. `vite build` needs the native `lightningcss` / `rolldown` bindings
for the host platform.
