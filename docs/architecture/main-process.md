# Main Process Architecture

Use this file for Electron bootstrap, Git operations, provider integration,
settings, memory/wiki/activity services and external editor/terminal behavior.
Renderer routing is documented separately.[^renderer]
For directory-level ownership, use the Electron and service entries in the
module catalog.[^modules]

## Bootstrap

`electron/main.ts` is the main-process composition root:

- creates singleton services;
- creates the BrowserWindow;
- configures macOS dock/about behavior and native menus;
- wires `createIpcHelpers()` to `registerIpcHandlers()`;
- loads Vite in dev or `dist/index.html` in production.

Keep long-lived services in `main.ts` unless a service is truly per-window.

## IPC Registration

`electron/ipc/registerIpcHandlers.ts` delegates to domain handler modules:

- `handlers/repository.ts` for repository reads, file browser/editor operations,
  memory/wiki/activity and app-level handlers;
- `handlers/git.ts` for Git mutations and Git config;
- `handlers/providers.ts` for GitHub CLI, editor/terminal and filesystem shell
  operations;
- `handlers/assistants.ts` for assistant generation actions.

Handlers should stay thin: validate request shape if needed, select the service,
wrap activity logging/policy through IPC helpers, and return typed data.

## Repository Service

`RepositoryService` is the facade for repository behavior. It now uses
composition for cohesive domains while retaining shared Git primitives:

- `repositoryService.base.ts` contains Git kernel helpers, guards, status reads
  and common list helpers.
- `repositoryService.queries.ts` and `repositoryService.writes.ts` hold shared
  query/write behavior used by the facade.
- `repositoryService.ts` wires domain collaborators such as `activity`,
  `dashboard`, `stash`, `config`, `worktreeTag`, `submoduleLfs`, `branches`,
  `merge`, `staging` and `commits`.
- `repositoryService.helpers.ts` contains pure parsers and path/name helpers.

For a new Git domain, prefer a small collaborator that receives only the methods
it needs from the facade. Avoid growing `RepositoryService` into a method dump.

## Command Execution

`electron/lib/commandRunner.ts` is the subprocess boundary:

- uses `spawn` with `shell: false`;
- builds a reduced safe environment;
- strips `ELECTRON_RUN_AS_NODE`;
- applies Windows Git Credential Manager args through `platformExecutables.ts`;
- limits output and records duration, exit code and truncation flags.

Call Git through `repositoryService.git()` or a service dependency that wraps it.
Do not spawn Git directly from UI or random service code.

## Providers And Assistants

GitHub provider code lives under `electron/providers`. The CLI bridge is split
into `githubCliService.*` files for auth, context, repositories, parsers and API
helpers.

Assistant code lives under `electron/assistants`. IPC registration must use
`handleAssistantAction()` so assistant policy and activity logging stay in force.
Assistant operations are suggestive by default; repository mutations must remain
user-confirmed Git actions.[^workflows]

## Main Change Checklist

1. Start at the matching IPC handler.
2. Follow the service dependency from the handler into `electron/lib` or
   `electron/providers`.
3. Preserve `ApiResult` errors through `createIpcHelpers()`.
4. Preserve activity logging for meaningful user/provider/assistant actions.
5. Add focused tests for parsers, preconditions or service behavior.[^development]

[^renderer]: [Renderer architecture](renderer.md)
[^workflows]: [Domain workflows](domain-workflows.md)
[^development]: [Development workflow](development.md)
[^modules]: [Module catalog](../modules/README.md)
