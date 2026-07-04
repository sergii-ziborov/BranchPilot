# Module Catalog

This catalog is the module-level entry point. Use it after
`ARCHITECTURE.md` when a task names a directory or feature area.[^architecture]
If the task names an exact folder path, use the folder catalog first.[^folders]

Doc rule: each module doc stays under 500 lines and links to related modules.

## Module Map

| Module | Open for |
| --- | --- |
| [Renderer App Shell](renderer-app-shell.md) | `src/App.tsx`, app frame, workspace, routes |
| [Renderer Hooks](renderer-hooks.md) | `src/hooks/use*.ts`, controller state, domain behavior |
| [Renderer UI Components](renderer-ui-components.md) | `src/components/**`, `src/components/ui/**`, shared UI surfaces |
| [Styles And Themes](styles-themes.md) | `src/styles/**`, theme registry, layout CSS |
| [Shared Contracts](shared-contracts.md) | `src/shared/**`, IPC types, preconditions, pure shared helpers |
| [Electron IPC](electron-ipc.md) | `electron/ipc/**`, preload bridge, channel handlers |
| [Repository Services](repository-services.md) | `electron/lib/repositoryService*.ts`, Git operations, command runner |
| [Providers And Assistants](providers-assistants.md) | GitHub CLI bridge and assistant runner modules |
| [Memory Reports Activity](memory-reports-activity.md) | project memory/wiki, activity log, daily reports |
| [Scripts Packaging](scripts-packaging.md) | npm scripts, dev cleanup, macOS/Windows packaging |
| [Tests](tests.md) | Vitest ownership and focused verification |

## Reading Rule

Open one module doc first, then follow its footnotes only if the task crosses a
boundary. For implementation details, jump from the doc to source with `rg`.

[^architecture]: [Architecture index](../../ARCHITECTURE.md)
[^development]: [Development workflow](../architecture/development.md)
[^folders]: [Folder catalog](../folders/README.md)
