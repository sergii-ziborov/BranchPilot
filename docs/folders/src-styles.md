# Source Style Folders

Scope: `src/styles` and all tracked style subfolders.

| Folder | Role | Related |
| --- | --- | --- |
| `src/styles` | CSS partial tree imported by `src/App.css` and `src/index.css`. | [Styles module](../modules/styles-themes.md) |
| `src/styles/assistant` | Assistant and review assistant styling. | [Providers Assistants](../modules/providers-assistants.md) |
| `src/styles/changes` | Changes view, commit tools, precommit diff and change-list styling. | [Components](src-components.md) |
| `src/styles/diff` | Diff surface and diff modal styling. | [Components](src-components.md) |
| `src/styles/memory` | Project memory and memory activity styling. | [Memory Reports](../modules/memory-reports-activity.md) |
| `src/styles/providers` | Provider, GitHub browser, pull request and stash provider styling. | [Providers Assistants](../modules/providers-assistants.md) |
| `src/styles/reports` | Daily, review and LinkedIn report styling. | [Memory Reports](../modules/memory-reports-activity.md) |
| `src/styles/repository` | Repository dashboard, history, picker, publish, branches, rhythm and worktree config styling. | [Repository Services](../modules/repository-services.md) |
| `src/styles/shell` | App shell, sidebar, workspace and panel layout styling. | [App Shell](../modules/renderer-app-shell.md) |
| `src/styles/system` | Motion and responsive system CSS. | [Renderer UI](../modules/renderer-ui-components.md) |
| `src/styles/tokens` | Base palette, reset, diff theme and dark override tokens. | [Styles module](../modules/styles-themes.md) |
| `src/styles/themes` | Theme entrypoints, active overrides and theme registry. | [Styles module](../modules/styles-themes.md) |
| `src/styles/themes/cinematic` | Cinematic theme controls and panels. | [Styles module](../modules/styles-themes.md) |
| `src/styles/themes/cisco-dark` | Cisco dark theme entrypoint. | [Styles module](../modules/styles-themes.md) |
| `src/styles/themes/cisco-light` | Cisco light theme entrypoint. | [Styles module](../modules/styles-themes.md) |
| `src/styles/themes/cyberpunk` | Cyberpunk tokens, controls, code, loaders and surfaces. | [Styles module](../modules/styles-themes.md) |
| `src/styles/themes/deus-ex` | Deus Ex theme entrypoint and interface/status styling. | [Styles module](../modules/styles-themes.md) |
| `src/styles/themes/deus-ex/human-revolution` | Split Human Revolution theme partials for shell, readability, controls, lists and selection. | [Styles module](../modules/styles-themes.md) |
| `src/styles/themes/far-manager` | FAR Manager console theme partials. | [Styles module](../modules/styles-themes.md) |
| `src/styles/themes/github-dark` | GitHub dark theme entrypoint. | [Styles module](../modules/styles-themes.md) |
| `src/styles/themes/github-light` | GitHub light theme entrypoint. | [Styles module](../modules/styles-themes.md) |
| `src/styles/themes/matrix` | Matrix theme tokens, surfaces, controls, code and loaders. | [Styles module](../modules/styles-themes.md) |
| `src/styles/themes/night-city` | Night City theme tokens, controls, code, loaders and surfaces. | [Styles module](../modules/styles-themes.md) |
| `src/styles/themes/retro` | Retro theme entrypoint and skin variants. | [Styles module](../modules/styles-themes.md) |

## Maintenance Notes

- Preserve CSS import order unless the cascade change is intentional.
- Prefer token updates over isolated one-off overrides.
- Keep theme-specific styling in the theme folder that owns it.

[^styles]: [Styles And Themes](../modules/styles-themes.md)
