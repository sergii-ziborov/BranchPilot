# IPC And Shared Contracts

Use this file when adding or changing anything exposed through
`window.branchPilot`. The process model is summarized in the main index.[^index]
For directory ownership, see the shared-contract and Electron IPC module
docs.[^modules]

## Contract Files

- `src/shared/branchPilotApi.ts` defines the `BranchPilotApi` interface used by
  the renderer and preload.
- `src/shared/ipcChannels.ts` defines the allowlisted channel names and the
  `BranchPilotIpcChannel` type.
- `electron/preload.cts` maps `BranchPilotApi` methods to `ipcRenderer.invoke`.
- `electron/ipc/ipcHelpers.ts` wraps `ipcMain.handle` with typed success/error
  results, activity logging and assistant policy checks.
- `electron/ipc/handlers/*.ts` register concrete handlers.

Shared domain types are split across `src/shared/branchPilot.*.ts` and re-exported
through `src/shared/branchPilot.ts`.

## Adding An IPC Method

1. Add or reuse request/response types in the relevant `src/shared` partial.
2. Export them through `src/shared/branchPilot.ts` if callers import the barrel.
3. Add the method to `BranchPilotApi` in `branchPilotApi.ts`.
4. Add a channel string to `BRANCH_PILOT_IPC_CHANNELS`.
5. Add the preload method in `electron/preload.cts`.
6. Register the handler in the right `electron/ipc/handlers/*.ts` file.
7. Use `handle`, `handleLogged`, `handleAssistantAction` or `handleUnwrapped`
   intentionally.
8. Add tests for the channel list or behavior when the endpoint has meaningful
   branching.

## Helper Choice

| Helper | Use when |
| --- | --- |
| `handle` | normal API method returning `ApiResult<T>` |
| `handleLogged` | user/provider operation should enter Activity Log |
| `handleAssistantAction` | assistant action must pass policy and log activity |
| `handleUnwrapped` | method intentionally does not return `ApiResult<T>` |

Do not bypass `isBranchPilotIpcChannel()`. Unknown channels should fail during
registration, not at runtime in the UI.

## Error And Safety Model

Main-process errors are normalized through `toBranchPilotError()` in
`electron/lib/errors.ts`. Renderer code should display `result.error.message`
and use `branchPilotErrorText()` for user-facing notices.

Destructive Git operations should require explicit confirmed request types in
`src/shared`, then be enforced in the service layer as well as the UI. The UI
confirmation is not the only safety boundary.[^workflows]

## Contract Checklist

- Shared type exists before the preload method.
- Channel name is specific and grouped by domain prefix.
- Preload method is a one-line invoke mapping.
- Handler stays thin and delegates business logic.
- Renderer calls the API through a hook, not directly from a large view.

[^index]: [Main architecture index](../../ARCHITECTURE.md)
[^workflows]: [Domain workflows](domain-workflows.md)
[^development]: [Development workflow](development.md)
[^modules]: [Module catalog](../modules/README.md)
