# BranchPilot Architecture

This file is the Codex entry point for the codebase. Keep it short, then open
only the linked detail file that matches the change. Source files remain the
authority when docs and implementation disagree.

Doc rule: no architecture Markdown file should exceed 500 lines. Split a file
before it grows past that size.

## System Shape

BranchPilot is a local-first Electron desktop Git client:

- Electron main process owns privileged work: Git, GitHub CLI, filesystem,
  settings, activity logs, project memory/wiki, external editors and assistant
  runners.[^main]
- React renderer owns UI state, view routing and presentation. It does not call
  Git or the filesystem directly.[^renderer]
- A typed preload bridge exposes `window.branchPilot`; both sides share the API
  and channel definitions from `src/shared`.[^ipc]
- Domain workflows are thin UI hooks plus main-process services. Safety rules
  live close to the operation that can mutate a repository.[^workflows]

## Read Map

| Task | Open |
| --- | --- |
| UI, route, hook, view, style work | [Renderer architecture](docs/architecture/renderer.md) |
| Git operation, repository state, settings, editor, memory, providers | [Main process architecture](docs/architecture/main-process.md) |
| New renderer-to-main method or channel | [IPC and shared contracts](docs/architecture/ipc-contract.md) |
| End-to-end behavior across UI, IPC and services | [Domain workflows](docs/architecture/domain-workflows.md) |
| Build, run, package, test, docs maintenance | [Development workflow](docs/architecture/development.md) |
| Directory/module ownership | [Module catalog](docs/modules/README.md) |
| Folder-by-folder ownership | [Folder catalog](docs/folders/README.md) |

## Source Map

| Area | Primary files |
| --- | --- |
| App composition | `src/App.tsx`, `src/components/app/AppFrame.tsx`, `src/components/app/AppWorkspace.tsx` |
| Controller and domain hooks | `src/hooks/useAppController.ts`, `src/hooks/use*.ts` |
| Views and routes | `src/components/app/routes/*.tsx`, `src/components/views/*.tsx` |
| UI primitives | `src/components/ui/**`, compatibility exports in `src/components/*.tsx` |
| Main bootstrap | `electron/main.ts`, `electron/appMenu.ts` |
| IPC registration | `electron/ipc/registerIpcHandlers.ts`, `electron/ipc/handlers/*.ts` |
| Shared IPC contract | `src/shared/branchPilotApi.ts`, `src/shared/ipcChannels.ts`, `electron/preload.cts` |
| Repository engine | `electron/lib/repositoryService*.ts`, `electron/lib/commandRunner.ts` |
| GitHub provider | `electron/providers/githubCliService*.ts`, `src/hooks/useProviders.ts` |
| Assistants | `electron/assistants/assistantRunner*.ts`, `src/hooks/useAssistants.ts`, `src/hooks/useReview.ts` |
| Memory/wiki/activity | `electron/lib/projectMemoryService.ts`, `electron/lib/projectWikiService.ts`, `electron/lib/activityLogService.ts` |
| Theme and layout CSS | `src/styles/**`, imported through `src/App.css` and `src/index.css` |

## Dependency Direction

- Renderer imports shared types and pure helpers, then calls `window.branchPilot`.
- Preload imports the shared API type and channel type, but does not implement
  business logic.
- Main process imports shared request/response types and returns `ApiResult`
  values through IPC helpers.
- Shared modules must stay isomorphic: no Electron, DOM, Node-only runtime calls
  unless the file name and consumers make that boundary explicit.

## Change Routing

1. For a UI-only change, start in the route/view, then move outward to the hook
   only if new state or behavior is required.[^renderer]
2. For a Git behavior change, start at the matching IPC handler, then follow the
   delegated service on `repositoryService`.[^main]
3. For a new feature crossing the process boundary, add the shared type, channel,
   preload method, handler and renderer hook together.[^ipc]
4. For an assistant/provider/memory workflow, preserve the existing activity log
   and policy gates.[^workflows]
5. Run the narrow test first, then the broader verification commands listed in
   the development doc.[^development]
6. When a task names a directory, open the module catalog and then the matching
   module file.[^modules]
7. When a task names a folder path, open the folder catalog first.[^folders]

[^renderer]: [Renderer architecture](docs/architecture/renderer.md)
[^main]: [Main process architecture](docs/architecture/main-process.md)
[^ipc]: [IPC and shared contracts](docs/architecture/ipc-contract.md)
[^workflows]: [Domain workflows](docs/architecture/domain-workflows.md)
[^development]: [Development workflow](docs/architecture/development.md)
[^modules]: [Module catalog](docs/modules/README.md)
[^folders]: [Folder catalog](docs/folders/README.md)
