# Renderer Hooks Module

Scope: `src/hooks/**`, including the app controller and all domain hooks.[^renderer]

## Owns

- `useAppController`: app snapshot, view mode, busy/error/notice state, shared
  run helpers, snapshot application and native menu actions.
- Domain hooks: changes, commit, branches, merge, stash, history, providers,
  assistants, review, Git config, project memory, daily review, LinkedIn and
  repository management.
- Hook-only helpers such as virtual list, pane resize and prompt state.

## Patterns

- Hooks receive dependencies explicitly.
- Hooks call `window.branchPilot` through the injected `api` dependency.
- UI confirmation and text prompt requests come from `usePrompts`.
- Hooks return action functions and derived state; route modules pass those into
  views.

## Does Not Own

- Markup-heavy view layout.[^ui]
- Git implementation details.[^services]
- IPC channel strings and request/response contracts.[^shared]

## Change Notes

- Add state to the narrowest domain hook first.
- Use `runApiAction`, `runSnapshotAction`, `runOperationAction` or
  `runBusyOperation` for user-visible work.
- Keep background refresh silent and guarded against stale repository snapshots.

[^renderer]: [Renderer architecture](../architecture/renderer.md)
[^ui]: [Renderer UI Components](renderer-ui-components.md)
[^services]: [Repository Services](repository-services.md)
[^shared]: [Shared Contracts](shared-contracts.md)
