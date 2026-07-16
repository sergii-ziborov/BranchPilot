# CLAUDE.md

Guidance for AI assistants (Claude Code, Codex) working in this repository. Read
this first, then open [ARCHITECTURE.md](ARCHITECTURE.md) for the detailed map.
Source files are the authority when docs and code disagree.

## What this is

BranchPilot is a local-first desktop Git client (Electron · React 19 · TypeScript ·
Vite) for local repositories and hosted providers (GitHub via the `gh` CLI or Git
Credential Manager — the MCP's GitHub tools need no gh at all). The
renderer never touches Git or the filesystem directly — it calls the Electron main
process over a typed IPC bridge (`window.branchPilot`). Assistants are **read-only by
default**; every destructive Git action is gated behind explicit confirmation. See
[README.md](README.md) for the product overview and feature list.

## Commands

```sh
npm install
npm run dev      # clean stale dev processes, then Vite + Electron + tsc watch
npm run build    # tsc -b && vite build && tsc -p tsconfig.electron.json
npm run test     # vitest run
npm run lint     # eslint .
```

Run the narrowest test first (`npx vitest run tests/<file>`), then the full
verification triad (`build`, `lint`, `test`) before calling a change done.

## Architecture rules in force

This codebase follows a **modular component architecture** in the spirit of POODR
(single responsibility, small cohesive units, intention-revealing names):

- **File size cap: every source file stays at most 500 lines** — `.ts`, `.tsx`,
  `.js`, `.css`, and `.md` alike. When a file approaches the cap, split it: keep the
  original path as a slim facade/aggregator that re-exports (TS) or `@import`s (CSS)
  the new modules, so importers keep working unchanged.
- **Naming:** React components `PascalCase.tsx`; hooks `useX.ts`; services/utils
  `camelCase.ts`; directories lowercase or kebab-case; CSS files kebab-case.
- **Modules live next to what they compose:** large components split into a sibling
  directory (e.g. `src/components/changes/internal-editor/`, `.../views/memory/`,
  `src/hooks/appController/`); large services into a dotted-suffix set or a
  subdirectory (e.g. `electron/lib/repositoryService.*.ts`, `electron/mcp/memory/`);
  large stylesheets into a folder of partials aggregated by the original file.

### Import conventions (two compilers)

- **Renderer** (`src/**`, except `src/shared`) compiles under `verbatimModuleSyntax`
  with `noUnusedLocals`/`noUnusedParameters`: use `import type` for type-only imports,
  no unused imports, and **extensionless** relative import paths.
- **Electron** (`electron/**`) and **shared** (`src/shared/**`) compile under NodeNext
  ESM: relative imports **must carry the `.js` extension** (importing a `.ts` file as
  `./foo.js` is correct). `src/shared` is compiled by *both* tsconfigs, so shared
  modules must use `.js`-suffixed relative imports.

Generated output (`dist`, `dist-electron`, `release`, `ds-bundle`, `node_modules`) is
never edited by hand — it is rebuilt.

## Where to look

| Task | Open |
| --- | --- |
| Detailed system map, read/source/dependency maps | [ARCHITECTURE.md](ARCHITECTURE.md) |
| UI, route, hook, view, style work | [docs/architecture/renderer.md](docs/architecture/renderer.md) |
| Git, repository state, settings, memory, providers | [docs/architecture/main-process.md](docs/architecture/main-process.md) |
| New renderer↔main method or channel | [docs/architecture/ipc-contract.md](docs/architecture/ipc-contract.md) |
| End-to-end behavior across UI, IPC, services | [docs/architecture/domain-workflows.md](docs/architecture/domain-workflows.md) |
| Build, run, package, test, docs maintenance | [docs/architecture/development.md](docs/architecture/development.md) |
| Directory/module ownership | [Module catalog](docs/modules/README.md) |
| Folder-by-folder ownership | [Folder catalog](docs/folders/README.md) |

## Additional references

- [docs/README.md](docs/README.md) — index of all documentation.
- [docs/beta-smoke.md](docs/beta-smoke.md) — private-beta smoke checklist before sharing a build.
- [docs/frontend-dedup-audit.md](docs/frontend-dedup-audit.md) — frontend duplication audit notes.
- [.design-sync/conventions.md](.design-sync/conventions.md) and
  [.design-sync/NOTES.md](.design-sync/NOTES.md) — design-sync conventions and notes.
- [.ds-sync/storybook/SKILL.md](.ds-sync/storybook/SKILL.md) — Storybook design-sync skill.

## Safety model

Assistants receive explicit local context only — no repository file writes, no shell
writes, no silent approval expansion. The MCP's single write tool, `record_session_note`,
appends to BranchPilot's own activity ledger only. Destructive Git operations (delete,
discard, force) each require their own confirmation. Credentials are never stored by the
app; it relies on your existing Git setup (Git Credential Manager) and, optionally, `gh`.
Preserve the activity-log and policy gates when touching assistant, provider, or memory
workflows.
