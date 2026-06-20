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

## Verification

```sh
npm run test
npm run lint
npm run build
```

## Local macOS Build

```sh
npm run dist
```

The unsigned local build is written to `release/`:

- `release/mac-arm64/BranchPilot.app`
- `release/BranchPilot-0.0.0-arm64.dmg`
- `release/BranchPilot-0.0.0-arm64-mac.zip`

Code signing and notarization are intentionally deferred. For private local testing on
macOS, open the app from `release/mac-arm64/BranchPilot.app` or install from the
generated DMG.

## Private Beta Smoke

Use [docs/beta-smoke.md](docs/beta-smoke.md) before sharing a build.

## Safety model

BranchPilot is conservative by design: assistants are read-only, destructive Git
operations (delete, discard, force) require their own confirmations, and credentials are
never handled by the app — it relies on your existing Git and `gh` setup.
