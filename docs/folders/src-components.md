# Source Component Folders

Scope: `src/components` and all tracked subfolders.

| Folder | Role | Related |
| --- | --- | --- |
| `src/components` | Shared and feature-specific React components plus compatibility exports for UI submodules. | [Renderer UI](../modules/renderer-ui-components.md) |
| `src/components/app` | App frame, workspace, route router, dialogs and route adapters that bind controller state to views. | [App Shell](../modules/renderer-app-shell.md) |
| `src/components/app/hosts` | Host wrappers for cross-view panels such as GitHub repository browser, PR details and assistant policy. | [Providers](../modules/providers-assistants.md) |
| `src/components/app/routes` | Route-level adapters for dashboard, changes, branches, history, providers, merge, config and reports. | [Renderer App Shell](../modules/renderer-app-shell.md) |
| `src/components/changes` | Changes workflow components: change list, diff panel, commit composer and internal repository editor. | [Domain Workflows](../architecture/domain-workflows.md) |
| `src/components/diff` | Diff-adjacent UI helpers, raw diff preview and CSS color swatch editing surfaces. | [Repository Services](../modules/repository-services.md) |
| `src/components/history` | History view panels, commit details, file preview and compare diff surfaces. | [Source Core](src-core.md) |
| `src/components/settings` | Settings-tab components for assistant and app configuration surfaces. | [Renderer Hooks](../modules/renderer-hooks.md) |
| `src/components/ui` | Category barrel for reusable UI primitives. | [Renderer UI](../modules/renderer-ui-components.md) |
| `src/components/ui/buttons` | Reusable button primitives and navigation button components. | [Styles](src-styles.md) |
| `src/components/ui/controls` | Segmented controls, selectable chips, choice cards and stage checkbox controls. | [Shared Contracts](../modules/shared-contracts.md) |
| `src/components/ui/feedback` | Status, count, severity and diff-stat feedback components. | [Styles](src-styles.md) |
| `src/components/ui/icons` | Brand, file type and file status icon components. | [Root Assets](root-assets-tooling.md) |
| `src/components/ui/identity` | Avatar, commit identity and commit reference display components. | [Repository Services](../modules/repository-services.md) |
| `src/components/ui/overlays` | Dialog, modal, tooltip and toaster primitives. | [Renderer Hooks](../modules/renderer-hooks.md) |
| `src/components/ui/overlays/branch-dialogs` | Branch-specific dialog components and branch base option helpers. | [Domain Workflows](../architecture/domain-workflows.md) |
| `src/components/ui/states` | Empty, loading and repository-loading visual state components. | [Renderer App Shell](../modules/renderer-app-shell.md) |
| `src/components/ui/surfaces` | Reusable cards, blockers, chips, meters, panels and copyable code surfaces. | [Styles](src-styles.md) |
| `src/components/views` | Presentational top-level view components fed by route props. | [Renderer architecture](../architecture/renderer.md) |

## Maintenance Notes

- Route components may know about controller shape; views should stay prop-fed.
- Promote a feature component to `src/components/ui` only when reuse is clear.
- Destructive component actions should receive `requestConfirmation` from hooks
  or controller-driven props, not use browser confirm prompts.

[^ui]: [Renderer UI Components](../modules/renderer-ui-components.md)
