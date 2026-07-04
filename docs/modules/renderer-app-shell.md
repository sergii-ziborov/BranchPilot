# Renderer App Shell Module

Scope: app composition, app frame, workspace routing and route adapters in
`src/App.tsx` and `src/components/app/**`.[^renderer]

## Owns

- `src/App.tsx`: creates `useAppController()` and provides it through context.
- `src/components/app/AppFrame.tsx`: shell bars, global overlays, toasts,
  dialogs and repository transition curtains.
- `src/components/app/AppWorkspace.tsx`: repository empty/loading state,
  conflict banner and main workspace.
- `src/components/app/MainViewRouter.tsx`: routes `viewMode` to route modules.
- `src/components/app/routes/*.tsx`: adapts controller values to view props.
- `src/components/app/hosts/*.tsx`: hosts cross-view panels such as provider or
  assistant policy surfaces.

## Does Not Own

- Domain state transitions. Put those in renderer hooks.[^hooks]
- Shared UI primitives. Put those in UI components.[^ui]
- IPC method definitions. Put those in shared contracts and Electron IPC.[^ipc]

## Change Notes

- Keep `App.tsx` small.
- Route components may destructure controller values, but views should stay
  presentational.
- Add a route only when `ViewMode` and the shell navigation need a new top-level
  surface.

## Related

Use hooks for behavior, UI components for reusable surfaces, and shared
contracts when a route needs a new backend action.

[^renderer]: [Renderer architecture](../architecture/renderer.md)
[^hooks]: [Renderer Hooks](renderer-hooks.md)
[^ui]: [Renderer UI Components](renderer-ui-components.md)
[^ipc]: [Electron IPC](electron-ipc.md)
