# Electron Folders

Scope: `electron` and all tracked subfolders.

| Folder | Role | Related |
| --- | --- | --- |
| `electron` | Main-process app root: bootstrap, menu, preload and domain folders. | [Main process](../architecture/main-process.md) |
| `electron/assistants` | Assistant runner entrypoint, command execution, prompt context, parsers, schemas and runner adapters. | [Providers Assistants](../modules/providers-assistants.md) |
| `electron/ipc` | IPC registration toolkit, service dependency types and top-level handler orchestrator. | [Electron IPC](../modules/electron-ipc.md) |
| `electron/ipc/handlers` | Domain IPC registration modules for repository, Git, providers and assistants. | [IPC Contract](../architecture/ipc-contract.md) |
| `electron/lib` | Main-process services and primitives: repository service, command runner, settings, editor, activity, memory, wiki and parsers. | [Repository Services](../modules/repository-services.md) |
| `electron/mcp` | Project-memory MCP server and config generation. | [Memory Reports](../modules/memory-reports-activity.md) |
| `electron/providers` | GitHub CLI provider bridge, auth/context/repository APIs and parsers. | [Providers Assistants](../modules/providers-assistants.md) |

## Maintenance Notes

- Keep Electron handlers thin; service behavior belongs in `electron/lib` or
  provider/assistant modules.
- Use `CommandRunner` for subprocess work.
- Preserve assistant policy and activity logging wrappers when adding handlers.

[^main]: [Main process architecture](../architecture/main-process.md)
