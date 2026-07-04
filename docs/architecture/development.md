# Development Workflow

Use this file for local setup, macOS/Windows run behavior, packaging and
architecture-doc maintenance. For code ownership, start with the main index.[^index]
For directory-level ownership, use the module catalog.[^modules]

## Local Run

Install and run:

```sh
npm install
npm run dev
```

`npm run dev` runs `scripts/prepare-dev.cjs` first. On Windows it removes stale
BranchPilot dev processes via PowerShell/taskkill. On macOS it removes stale
BranchPilot dev processes and a stale Vite listener on port `5174` when that
listener belongs to this repository.

Dev scripts:

- `dev:web` starts Vite on `127.0.0.1:5174` with `--strictPort`.
- `dev:main` compiles Electron TypeScript in watch mode.
- `dev:electron` waits for Vite and compiled main output, then launches Electron
  through `scripts/run-electron.cjs --watch`.
- `electron:dev` compiles Electron once and launches the app without Vite watch.
- `mcp:dev` runs the project-memory MCP server.

## Packaging

Builds use electron-builder and write to `release/`.

```sh
npm run dist
npm run dist:mac
npm run dist:mac:run
npm run start:mac
npm run dist:win
npm run dist:all
```

macOS output is a `.app`, `.dmg` and `.zip`; local builds are unsigned and not
notarized. `start:mac` opens the newest `release/**/BranchPilot.app` bundle.

Windows output is an NSIS installer. Cross-building Windows from macOS/Linux may
require Wine; prefer Windows CI or a Windows machine for reliable installer
builds.

## Verification

Use the narrowest useful command first, then broaden before handing off:

```sh
npm run test
npm run lint
npm run build
```

The production build runs both renderer and Electron TypeScript projects:

```sh
tsc -b
vite build
tsc -p tsconfig.electron.json
```

Behavioral Git tests require a modern Git with `worktree list --porcelain -z`.
Native Vite dependencies must match the host platform.

## Documentation Rules

- Keep `ARCHITECTURE.md` as the short index.
- Keep every file in `docs/architecture` under 500 lines.
- Add footnote links to related architecture docs.
- Prefer source-map tables and checklists over long prose.
- Split a doc by ownership boundary before it becomes a full system dump.

## Dev Change Checklist

1. Update package scripts and README together when run/build commands change.
2. Keep platform-specific behavior isolated in scripts or `platformExecutables`.
3. Add tests when config is meant to stay fixed.
4. Recount architecture docs after edits.

[^index]: [Main architecture index](../../ARCHITECTURE.md)
[^renderer]: [Renderer architecture](renderer.md)
[^main]: [Main process architecture](main-process.md)
[^ipc]: [IPC and shared contracts](ipc-contract.md)
[^modules]: [Module catalog](../modules/README.md)
