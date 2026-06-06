# BranchPilot Private Beta Smoke

Run this checklist on macOS before sharing a private beta build.

## Build Gate

```sh
npm run test
npm run lint
npm run build
npm run dist
```

Expected artifacts:

- `release/mac-arm64/BranchPilot.app`
- `release/BranchPilot-0.0.0-arm64.dmg`
- `release/BranchPilot-0.0.0-arm64-mac.zip`

## Repository Matrix

Smoke the app against:

- a small personal repository;
- a large frontend repository;
- a backend repository;
- a repository with a merge conflict;
- a repository with multiple remotes.

## Core Workflows

- Open a repository and verify branch, remote, ahead/behind, and status counts.
- Inspect an unstaged diff and a staged diff.
- Stage one file, unstage it, stage all, and unstage all.
- Create a commit with title and description.
- Generate commit text with the configured local assistant, then edit before commit.
- Create and switch to a branch.
- Fetch, pull with fast-forward only, push, and publish a branch.
- Create, apply, and drop a stash.
- Merge a branch with a conflict, accept ours/theirs, mark resolved, continue, and abort in a separate fixture.
- Open the repository and selected file in the configured editor.
- Open Providers and verify GitHub CLI or GitHub Desktop credential status.
- Generate PR title/body, edit it, and create a PR only after confirming preconditions.
- Generate Project Memory and Project Wiki in the Memory tab.
- Run Daily Review.

## Safety Checks

- Destructive actions show confirmation before running.
- Assistant actions remain suggest-only and do not write files or run repository commands.
- MCP tools remain read-only.
- Large changed-file and history lists remain scrollable.
- Binary, large, LFS, submodule, and worktree states display without freezing the app.

## Known Private Beta Constraints

- macOS arm64 is the first packaging target.
- Builds are unsigned and not notarized.
- GitHub is supported through GitHub CLI and GitHub Desktop credentials; GitLab and Bitbucket remain planned.
- Built-in 3-way merge editing is not included yet; external editor workflow is the supported path.
