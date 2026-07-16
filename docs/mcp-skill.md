---
name: branchpilot
description: Drive the BranchPilot MCP — live Git status/diff/history/blame, GitHub PR and CI triage via gh, Project Memory health/wiki, and the assistant session journal. Use when reviewing local changes, triaging CI, loading PR context, or checking what earlier sessions already ran.
---

# BranchPilot MCP

Read-only bridge to ONE local repository (granted explicitly from Reports → MCP in the BranchPilot
app). Its only write is `record_session_note`, which appends to BranchPilot's own activity ledger —
never repository files or Git state.

## Step 0 — if the tools are missing

Tools are named `mcp__branchpilot__…`. If none are available, ask the user to open the BranchPilot
app → Reports → MCP and copy the server command (Claude Code) or Codex config, register it, then retry.

## Ground rules

- **Start every session with `get_live_overview`** — one call returns branch/divergence, changed
  files, refs summary, recent commits, and top health-risk files.
- **Crash-safety protocol**: before long or expensive work (full test runs, builds, migrations) check
  `get_agent_activity` with `types: ['assistant_session_note']` — an earlier session may have already
  run it. Record your own via `record_session_note` (`phase: started` before, `completed`/`failed`
  after) so an interrupted session never redoes the work.
- **Freshness**: Project Memory results carry `scannedAt`; a stale snapshot means rescan Memory in
  the app. Live repository tools are always current.
- **Routing**: code-STRUCTURE questions (who calls/imports, blast radius, clones, regex code search)
  belong to the repo-lens MCP when attached — BranchPilot deliberately does not duplicate those.

## Recipes

- **Review current local work**: `get_live_overview` → `get_repository_diff` (`format: name-only`
  first — untracked files are listed too — then `patch` on interesting paths, `mergeBase: true` for
  PR-style ranges) → `get_file_history`/`get_repository_blame` for context.
- **PR review**: `get_pull_request` (metadata, files, review decision, unresolved threads;
  `includeDiff: true` for the code) → repo-lens `change_impact` with `files` set to the PR's changed
  paths (blast radius + coverage, works without checking the PR out) → `get_ci_status` for checks.
- **PR triage ("what should I review / merge first?")**: `list_pull_requests` (CI rollup
  passed/failed/pending + review decision per PR) → for candidates, `get_pull_request` → repo-lens
  `change_impact files=[…]` — rank by blast radius, untested hotspots, and failing checks.
- **CI triage**: `get_ci_status` — workflow runs for the branch/PR plus a bounded tail of each failed
  job's log in one call.
- **History dig**: `search_commit_history` (query/author/since/until) → `get_commit_details` →
  `get_file_history` (follows renames).
- **Resume after an interruption**: `list_agent_runs` + `get_agent_activity` — see what earlier
  assistant runs did before continuing.

## Troubleshooting

- `No Project Memory snapshot` → scan Project Memory in the app, then retry memory/health/wiki tools.
- GitHub tool errors → the repo needs a github.com origin remote, and a credential must exist: set
  `GH_TOKEN`/`GITHUB_TOKEN`, or push/pull once over HTTPS so Git Credential Manager stores one. No
  GitHub CLI required.
- Tool list looks outdated after a BranchPilot update → reconnect the MCP server (it is compiled;
  it does not hot-reload).
