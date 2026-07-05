# Renderer Architecture

Use this file for React UI, routes, hooks, view composition and styles. Return to
the main index when the change crosses into Electron or Git.[^index]
For directory-level ownership, use the renderer entries in the module
catalog.[^modules]

## Entry Path

Runtime flow:

```text
src/main.tsx
  -> src/App.tsx
  -> AppControllerProvider
  -> AppFrame
  -> AppWorkspace
  -> MainViewRouter
  -> route component
  -> view component
```

`App.tsx` should stay a composition root. It creates `useAppController()` and
places the result in `AppControllerProvider`.

## Controller

`src/hooks/useAppController.ts` is the renderer integration layer:

- owns app-level state such as repository snapshot, view mode, busy/notice/error;
- wires domain hooks together;
- provides shared wrappers such as `runApiAction`, `runSnapshotAction`,
  `runOperationAction` and `runBusyOperation`;
- applies repository snapshots and keeps recent repositories current;
- receives native menu actions and routes them to existing UI actions.

Domain hooks should receive dependencies explicitly. Prefer passing `api`,
`currentRepoPath`, `snapshot`, setters and run helpers into a hook over importing
globals inside it.

## Routes And Views

Routes in `src/components/app/routes` adapt the controller shape to view props.
Views in `src/components/views` are presentational and should avoid direct IPC
calls. If a view needs a new operation, add it to the relevant hook first.

Current route ownership:

- `ChangesRoute` renders Changes, Review and Stash tool surfaces.
- `DashboardRoute` renders repository and cross-repository reports.
- `HistoryRoute` renders commit history and file preview state.
- `BranchesRoute` owns branch, tag and worktree UI surfaces.
- `MergeRoute` owns conflict and merge/rebase continuation UI.
- `ProvidersRoute` owns GitHub CLI, repository browser and PR details.
- `ConfigRoute` owns settings, editor, terminal and assistant policy UI.
- `ReportsRoute` owns Daily Review and LinkedIn project generation.

## UI Components

Shared primitives live under `src/components/ui/**` with category barrels:

- `buttons`, `controls`, `feedback`, `icons`, `identity`, `overlays`, `states`,
  `surfaces`;
- `src/components/ui/index.ts` re-exports the category barrels;
- top-level components still exist for compatibility and feature-specific
  surfaces.

When adding new shared UI, prefer the category that matches behavior. Keep
feature-specific components near their feature unless they are reused.

## Styles

`src/App.css` and `src/index.css` import split CSS partials under `src/styles`.
Theme files live under `src/styles/themes/**`; shell, repository, changes,
providers, reports and memory styles have their own directories.

Style changes should preserve the existing cascade and token names. Add a new
theme file only when the concern is theme-specific.

## Renderer Change Checklist

1. Find the route and view first.
2. Add state/side effects to the domain hook, not the view.
3. If the feature crosses into Electron, update the shared IPC contract too.[^ipc]
4. Keep destructive actions behind confirmation requests from `usePrompts`.
5. Add or update focused component/hook tests when behavior changes.[^development]

[^index]: [Main architecture index](../../ARCHITECTURE.md)
[^ipc]: [IPC and shared contracts](ipc-contract.md)
[^development]: [Development workflow](development.md)
[^modules]: [Module catalog](../modules/README.md)
