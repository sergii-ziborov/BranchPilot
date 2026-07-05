# Root Assets And Tooling Folders

Scope: tracked non-application-source folders at repository root.

| Folder | Role | Related |
| --- | --- | --- |
| `.design-sync` | Design-sync inputs, conventions, token CSS and preview entrypoint. Generated cache/output paths are ignored. | [Styles](src-styles.md) |
| `.design-sync/previews` | Design-sync preview components for reusable UI surfaces and brand assets. | [Components](src-components.md) |
| `.tmp-run` | Tracked visual run artifact currently used for review-modal screenshot/reference output. Keep deliberate; avoid adding transient captures. | [Tests](tests.md) |
| `build` | electron-builder resources: app icons for macOS, Windows and fallback PNG/SVG. | [Scripts Packaging](../modules/scripts-packaging.md) |
| `docs` | Durable project documentation, smoke docs, architecture docs, module docs and folder docs. | [Architecture](../architecture/development.md) |
| `docs/architecture` | High-level process, renderer, main-process, IPC, workflow and development architecture docs. | [Architecture index](../../ARCHITECTURE.md) |
| `docs/modules` | Architecture-module docs grouped by stable code ownership boundaries. | [Module catalog](../modules/README.md) |
| `docs/folders` | Folder-level docs describing each tracked folder as a component/service/module boundary. | [Folder catalog](README.md) |
| `docs/branding` | Source branding assets used by docs and README. | [Components](src-components.md) |
| `mockups` | Standalone prototypes and sample data for history graph exploration. Not runtime application code. | [Source Core](src-core.md) |
| `public` | Static Vite public assets such as favicon. | [Renderer App Shell](../modules/renderer-app-shell.md) |
| `scripts` | Local development, Electron launch and packaging helper scripts. | [Scripts Packaging](../modules/scripts-packaging.md) |

## Maintenance Notes

- Do not commit generated `dist`, `dist-electron`, `release` or design-sync
  cache outputs.
- Add README/package/test updates together when script behavior changes.[^scripts]
- Keep documentation split under the 500-line rule.[^folder]

[^scripts]: [Scripts Packaging module](../modules/scripts-packaging.md)
[^folder]: [Folder catalog](README.md)
