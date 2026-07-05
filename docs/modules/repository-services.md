# Repository Services Module

Scope: `electron/lib/repositoryService*.ts`, Git helpers, parsers and command
execution.[^main]

## Owns

- `RepositoryService` facade and composed domain services.
- Git status, snapshot, diff, history and file read/write behavior.
- Branch, tag, worktree, stash, merge, staging, commit, submodule and LFS
  operations.
- `CommandRunner` subprocess boundary and safe environment.
- Repository parsers, path normalization and user-facing Git errors.

## Patterns

- Use `repositoryService.git()` or injected Git dependency instead of direct
  process spawning.
- Keep domain collaborators narrow; inject only the facade helpers they need.
- Mutating operations return fresh repository snapshots when the UI needs state.
- Service preconditions back up renderer confirmations.

## Does Not Own

- IPC channel registration.[^ipc]
- GitHub CLI provider-specific behavior.[^providers]
- Renderer diff/commit UI state.[^hooks]

## Change Notes

- Add parser tests for fragile Git output.
- Add service workflow tests for mutations.
- Preserve output byte limits for large diffs and repository content.

[^main]: [Main process architecture](../architecture/main-process.md)
[^ipc]: [Electron IPC](electron-ipc.md)
[^providers]: [Providers And Assistants](providers-assistants.md)
[^hooks]: [Renderer Hooks](renderer-hooks.md)
[^tests]: [Tests](tests.md)
