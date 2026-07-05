# Renderer UI Components Module

Scope: `src/components/**` and reusable UI categories under
`src/components/ui/**`.[^renderer]

## Owns

- `src/components/views/*.tsx`: presentational view surfaces.
- `src/components/changes/**`, `src/components/history/**`,
  `src/components/settings/**`: feature-specific component groups.
- `src/components/ui/buttons`, `controls`, `feedback`, `icons`, `identity`,
  `overlays`, `states`, `surfaces`: shared primitives and category barrels.
- Compatibility exports at `src/components/*.tsx` that point at newer UI module
  locations.

## Patterns

- Views receive props from routes and avoid direct IPC calls.
- Shared components should be behavior-light and reusable.
- Tool modals, dialogs and toasts are overlay primitives.
- Destructive UI actions should receive confirmation callbacks from hooks or
  controller state.[^hooks]

## Does Not Own

- Long-lived app state.[^hooks]
- CSS tokens and theme files.[^styles]
- Main-process operations.[^ipc]

## Change Notes

- Put one-off feature UI near the feature.
- Promote to `src/components/ui/**` only after reuse is real.
- Keep route-to-view prop boundaries explicit so Codex can trace data flow.

[^renderer]: [Renderer architecture](../architecture/renderer.md)
[^hooks]: [Renderer Hooks](renderer-hooks.md)
[^styles]: [Styles And Themes](styles-themes.md)
[^ipc]: [Electron IPC](electron-ipc.md)
