# Styles And Themes Module

Scope: `src/styles/**`, `src/App.css`, `src/index.css` and the theme registry.

## Owns

- Shell/workspace layout partials.
- Repository, changes, providers, reports and memory CSS partials.
- Theme token files under `src/styles/themes/**`.
- Theme registry in `src/styles/themes/registry.ts`.
- System CSS such as motion, responsive rules and scrollbar reset.

## Patterns

- `src/App.css` preserves import order for the cascade.
- Theme files override tokens and scoped component styling.
- Platform-specific selectors use `html[data-platform='win32']` or equivalent
  renderer platform data from preload.[^shared]

## Does Not Own

- Component state or route logic.[^ui]
- Electron title-bar runtime behavior.[^ipc]

## Change Notes

- Prefer token updates over per-component overrides.
- Keep new theme rules in the relevant theme directory.
- Check mobile and desktop layout when changing shell/workspace CSS.

[^ui]: [Renderer UI Components](renderer-ui-components.md)
[^shared]: [Shared Contracts](shared-contracts.md)
[^ipc]: [Electron IPC](electron-ipc.md)
[^renderer]: [Renderer architecture](../architecture/renderer.md)
