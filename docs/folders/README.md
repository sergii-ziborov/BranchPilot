# Folder Catalog

This catalog describes tracked folders as component/service/module boundaries.
Use it when a task points at a directory instead of a feature name.[^architecture]

## Folder Doc Map

| Folder Area | Open |
| --- | --- |
| Root support, docs, assets, scripts | [Root Assets And Tooling](root-assets-tooling.md) |
| `src` core folders | [Source Core Folders](src-core.md) |
| `src/components` tree | [Source Component Folders](src-components.md) |
| `src/styles` tree | [Source Style Folders](src-styles.md) |
| `electron` tree | [Electron Folders](electron.md) |
| `tests` tree | [Test Folders](tests.md) |

## Rule

Each folder doc stays below 500 lines. If a folder grows into several ownership
areas, split it and link the split here.

[^architecture]: [Architecture index](../../ARCHITECTURE.md)
[^modules]: [Module catalog](../modules/README.md)
