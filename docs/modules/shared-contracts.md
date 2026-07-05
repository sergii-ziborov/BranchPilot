# Shared Contracts Module

Scope: `src/shared/**` plus pure shared helpers used by both renderer and main.

## Owns

- `branchPilot.ts`: barrel for shared domain types.
- `branchPilot.core.ts`, `memory.ts`, `assistants.ts`, `gitops.ts`: focused
  shared type groups.
- `branchPilotApi.ts`: `BranchPilotApi` interface.
- `ipcChannels.ts`: allowed IPC channel list and channel type.
- Pure precondition and helper modules such as commit, branch, provider remote,
  external URL, virtual list and diff view helpers.

## Rules

- Stay isomorphic: no Electron runtime, no DOM runtime, no unguarded Node-only
  calls.
- Electron imports use explicit `.js` extensions where required by NodeNext.
- Add request/response types here before adding preload or handler code.[^ipc]

## Does Not Own

- IPC registration.[^ipc]
- Repository implementation.[^services]
- Renderer state orchestration.[^hooks]

## Change Notes

- Keep the barrel stable for consumers.
- Put pure preconditions here when both renderer and tests need them.
- Update channel tests when adding or renaming IPC channels.[^tests]

[^ipc]: [Electron IPC](electron-ipc.md)
[^services]: [Repository Services](repository-services.md)
[^hooks]: [Renderer Hooks](renderer-hooks.md)
[^tests]: [Tests](tests.md)
