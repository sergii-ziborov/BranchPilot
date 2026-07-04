# Source Core Folders

Scope: `src` folders that are not the component tree or style tree.

| Folder | Role | Related |
| --- | --- | --- |
| `src` | Renderer application root: React entrypoint, app component, global CSS imports, shared renderer code. | [Renderer architecture](../architecture/renderer.md) |
| `src/hooks` | Controller and domain hooks for app state, repository workflows, providers, assistants, memory, review, history, branches and UI utilities. | [Renderer Hooks](../modules/renderer-hooks.md) |
| `src/lib` | Pure renderer-side helpers: labels, formatting, diff helpers, graph helpers, placement, prompts, file icons and UI derivations. | [Shared Contracts](../modules/shared-contracts.md) |
| `src/lib/historyGraph` | History graph data model and renderer helpers used by history visualization surfaces. | [Components](src-components.md) |
| `src/shared` | Isomorphic contracts and pure helpers shared by renderer, Electron main and tests. Owns IPC channel names and `BranchPilotApi`. | [Shared Contracts](../modules/shared-contracts.md) |

## Cross Links

- UI folders are documented in [Source Component Folders](src-components.md).
- CSS folders are documented in [Source Style Folders](src-styles.md).
- IPC contract changes usually touch `src/shared`, `electron/preload.cts` and
  `electron/ipc` together.[^ipc]

## Maintenance Notes

- Keep `src/shared` runtime-neutral.
- Keep hook dependencies explicit rather than hidden imports from feature views.
- Add pure tests when moving logic from components into `src/lib` or `src/shared`.

[^ipc]: [IPC and shared contracts](../architecture/ipc-contract.md)
