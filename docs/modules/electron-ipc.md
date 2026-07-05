# Electron IPC Module

Scope: `electron/preload.cts` and `electron/ipc/**`.[^ipc-contract]

## Owns

- Preload bridge exposing `window.branchPilot`.
- IPC helper registration wrappers.
- Domain handler modules for repository, Git, providers and assistants.
- Activity logging and assistant policy wrapper selection at registration time.

## Patterns

- Preload methods should be one-line `invoke` mappings.
- Handlers stay thin and delegate to services.
- Unknown channels fail during registration through `isBranchPilotIpcChannel`.
- Use `handleAssistantAction` for assistant generation paths.[^providers]

## Does Not Own

- Request/response type definitions.[^shared]
- Git command implementation.[^services]
- Renderer route or view state.[^hooks]

## Change Notes

- Add shared type, channel, preload method and handler together.
- Choose `handleLogged` only for meaningful user/provider actions.
- Avoid logging high-frequency background reads.

[^ipc-contract]: [IPC and shared contracts](../architecture/ipc-contract.md)
[^shared]: [Shared Contracts](shared-contracts.md)
[^services]: [Repository Services](repository-services.md)
[^hooks]: [Renderer Hooks](renderer-hooks.md)
[^providers]: [Providers And Assistants](providers-assistants.md)
