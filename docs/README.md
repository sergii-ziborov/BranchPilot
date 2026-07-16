# Documentation Index

Entry points: [CLAUDE.md](../CLAUDE.md) (AI assistant guide) and
[ARCHITECTURE.md](../ARCHITECTURE.md) (system map). This index lists every doc so
each one is reachable in one hop.

## Architecture

- [Renderer architecture](architecture/renderer.md) — UI state, routes, hooks, views, styles.
- [Main process architecture](architecture/main-process.md) — Git, repository state, settings, memory, providers.
- [IPC and shared contracts](architecture/ipc-contract.md) — renderer↔main methods and channels.
- [Domain workflows](architecture/domain-workflows.md) — end-to-end behavior across UI, IPC, services.
- [Development workflow](architecture/development.md) — build, run, package, test, docs maintenance.

## Module catalog

Index: [modules/README.md](modules/README.md).

- [Renderer App Shell](modules/renderer-app-shell.md)
- [Renderer Hooks](modules/renderer-hooks.md)
- [Renderer UI Components](modules/renderer-ui-components.md)
- [Repository Services](modules/repository-services.md)
- [Providers and Assistants](modules/providers-assistants.md)
- [Memory, Reports, Activity](modules/memory-reports-activity.md)
- [Electron IPC](modules/electron-ipc.md)
- [Shared Contracts](modules/shared-contracts.md)
- [Styles and Themes](modules/styles-themes.md)
- [Scripts and Packaging](modules/scripts-packaging.md)
- [Tests](modules/tests.md)

## Folder catalog

Index: [folders/README.md](folders/README.md).

- [Electron folders](folders/electron.md)
- [Source core folders](folders/src-core.md)
- [Source component folders](folders/src-components.md)
- [Source style folders](folders/src-styles.md)
- [Root, assets and tooling](folders/root-assets-tooling.md)
- [Tests folder](folders/tests.md)

## Operational notes

- [Private beta smoke checklist](beta-smoke.md)
- [Frontend dedup audit](frontend-dedup-audit.md)
- [MCP agent skill](mcp-skill.md) — recipes and troubleshooting for assistants driving the
  BranchPilot MCP server (install as `~/.claude/skills/branchpilot/SKILL.md`).

## Design sync

- [Design-sync conventions](../.design-sync/conventions.md)
- [Design-sync notes](../.design-sync/NOTES.md)
- [Storybook design-sync skill](../.ds-sync/storybook/SKILL.md)
