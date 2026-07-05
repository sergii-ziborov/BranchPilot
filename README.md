<p align="center">
  <img src="docs/branding/branchpilot-logo.svg" alt="BranchPilot" width="320" />
</p>

<p align="center">
  <strong>A local-first desktop Git client — pilot your branches with confidence.</strong>
</p>

---

## About

BranchPilot is a desktop Git client for local repositories and hosted source
providers (GitHub via the `gh` CLI / GitHub Desktop credentials). It pairs a fast,
GitHub-Desktop-style workflow with optional on-device AI drafting, while staying
**read-only by default for assistants** and gating every destructive action behind
explicit confirmation.

The goal: make everyday Git — staging, reviewing, syncing, branching, and opening
pull requests — quick and legible, without hiding what Git is actually doing.

## Features

- **Changes & History** — stage by file, **by hunk, or by individual line**; word-level
  intra-line diff highlighting; unified or split view; expand the full file in-place.
- **Smart Sync** — one context-aware action (Pull / Push / Fetch) with a dropdown for
  the rest; `git pull --autostash` so a dirty working tree never blocks a pull.
- **Branches** — switch, rename, edit description, and delete right from the branch
  dropdown.
- **Worktrees & Tags** — create and manage linked worktrees and local tags from Settings.
- **Pull requests** — create PRs and inspect details, checks, and diffs via the GitHub CLI.
- **Reports** — contribution heatmap, daily review, and contributor ranking.
- **AI assistant (optional)** — draft commit messages, branch names, PR text, and code
  reviews with Claude Code or Codex. Assistants receive explicit local context only —
  no file writes, no shell writes, no silent approval expansion.
- **Auto-refresh** — the working tree refreshes on window focus and a light poll, like
  GitHub Desktop.
- **Themes** — a built-in picker with popular editor themes (GitHub, One Dark, Dracula,
  Nord, Night Owl, Tokyo Night, Monokai, Solarized).

## Tech stack

Electron · React 19 · TypeScript · Vite. The renderer talks to a Git engine in the
Electron main process over a typed IPC contract; assistant integrations shell out to
local CLIs only.

## Development

```sh
npm install
npm run dev
```

`npm run dev` cleans up stale BranchPilot dev processes before starting. That
cleanup covers Windows and macOS so repeated local launches do not get stuck on
the Vite port or an old Electron process.

## Verification

```sh
npm run test
npm run lint
npm run build
```

## Packaging

Builds are produced with electron-builder and written to `release/`.

```sh
npm run dist        # current platform
npm run dist:mac    # macOS (dmg + zip, arm64)
npm run dist:mac:run # build macOS and open the packaged .app
npm run start:mac   # open the newest release/**/BranchPilot.app
npm run dist:win    # Windows (NSIS installer, x64 + arm64)
npm run dist:all    # macOS + Windows
```

**macOS** — `release/mac-arm64/BranchPilot.app`, plus a `.dmg` and `.zip`. Code signing
and notarization are intentionally deferred; open the `.app` directly or install from the
DMG for local testing.

**Windows** — an NSIS installer (`BranchPilot-Setup-<version>.exe`) for x64 and arm64.
The installer is not code-signed. Building the Windows target **on macOS/Linux** requires
[wine](https://www.winehq.org); the cleanest path is to run `npm run dist:win` on a
Windows machine or in CI (e.g. a `windows-latest` GitHub Actions runner).

App icons live in `build/` (`icon.icns` for macOS, `icon.ico` for Windows, `icon.png`
fallback) and are generated from `build/icon.svg`.

## Architecture

Start with [ARCHITECTURE.md](ARCHITECTURE.md). It links to smaller, task-focused
docs under `docs/architecture/` and module docs under `docs/modules/`, each kept
under 500 lines for Codex-friendly navigation. Folder-by-folder ownership lives
in `docs/folders/`.

## Private Beta Smoke

Use [docs/beta-smoke.md](docs/beta-smoke.md) before sharing a build.

## Safety model

BranchPilot is conservative by design: assistants are read-only, destructive Git
operations (delete, discard, force) require their own confirmations, and credentials are
never handled by the app — it relies on your existing Git and `gh` setup.
