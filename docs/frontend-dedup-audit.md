# BranchPilot Frontend Dedup Audit

Scope: `src/App.tsx` (6896 lines) and `src/App.css` (4654 lines). No edits made — this is a read-only audit so we agree the plan before touching code.

## Headline

The frontend does **not** have huge copy-paste blocks. The problem is two different things:

1. **CSS**: lots of *identical declaration bodies* scattered across many selectors that should be grouped/shared. ~697 lines (~15% of App.css) are removable with zero behavior change.
2. **TSX**: very little literal duplication, but heavy *pattern* duplication (the same idioms typed out dozens of times) inside one 6896-line `App()` component with **119 `useState`** and **0 `useCallback`**. The win here is extracting a handful of repeated fragments + decomposing the monolith.

This is why "remove duplicates and improve" was a trap before: the duplication isn't in big chunks you can lift out, it's diffuse — so doing it "by reading" forces the whole monolith into context every time. Doing it mechanically (below) is tractable.

## CSS findings (App.css, 4654 lines)

- 639 rule blocks, 633 unique selectors.
- **6 selectors defined twice** — possible conflicting overrides, worth checking individually: `.app-shell`, `.topbar`, `.content-grid`, `.list-filter-bar`, `.config-card-heading`, `.pr-actions`.
- **75 groups of selectors share an identical declaration body.** Examples:
  - A button-reset body (196 chars) repeated across 11 selector groups (`.toolbar button`, `.panel-heading > button`, `.commit-actions button`, ...).
  - A muted-label body (78 chars) across 8 selectors (`.commit-box label`, `.config-card label`, `.info-row span`, ...).
  - A row-hover/selected body (41 chars) across 6 selectors (`.history-row:hover`, `.commit-file-row:hover`, ...).
- **Estimated removable: ~697 lines** by consolidating these into grouped selectors or a few shared utility classes.

## TSX findings (App.tsx, 6896 lines)

- One component `App()` spanning lines 189–6034 (~5845 lines), **119 `useState`**, **0 `useCallback`** (every handler is rebuilt each render).
- Almost no exact block duplication. The repeated *idioms* worth extracting:
  - `setNotice(result.error.details || result.error.code)` — **24 call sites**. Extract a `reportError(result)` / `notifyError(...)` helper.
  - The assistant `<select>` dropdown (value/onChange + options) — **3 identical copies** at lines 3383, 4637, 5142. Extract an `<AssistantSelect>` component.
  - `setError('Clipboard is not available in this runtime.')` clipboard guard — **4 copies**. Extract a `copyToClipboard()` helper.
  - `.filter((value): value is string => Boolean(value))` — **10 occurrences**. One `compact()` util.
  - `<span className={`file-status status-${file.status}`}>` — **3+ copies**. Extract `<FileStatusBadge>`.
- Bigger structural issue (not "duplicates" but the reason edits are dangerous): everything lives in one file, so there's no safe small unit to change.

## Why the numbers matter

- CSS dedup alone: ~697 lines gone, file shrinks ~15%, no risk (pure consolidation + 6 override checks).
- TSX dedup: modest line savings but big consistency/readability gain, and it *unblocks* the real fix — decomposition.

## Safe incremental plan (each step is small, committed, test-passing)

**Phase 1 — CSS (low risk, do first):**
1. Resolve the 6 duplicate selectors (confirm which definition wins, merge intentionally). Commit.
2. Group the top ~10 shared-body clusters into grouped rules / utility classes. Commit per cluster. Visual smoke check.

**Phase 2 — TSX idiom extraction (low risk):**
3. Add `src/shared/` helpers: `notifyError`, `copyToClipboard`, `compact`. Replace call sites in small batches, commit per batch.
4. Extract `<AssistantSelect>` and `<FileStatusBadge>` into `src/components/`. Commit each.

**Phase 3 — Decomposition (the real unblock):**
5. Pull each view out of `App()` into its own file: Changes, Commit, Branches, Merge, Providers, Review, Memory, History, Settings (matches Stage 23.5 in the roadmap). One view per commit, tests after each. After this, "improve X" is a bounded task on a small file — no more 3M-token runs.

## Method rule for next time

Find duplication with scripts (grep/AST), not by reading the whole file. Produce a target list, then apply small isolated edits with the exact-match editor, committing after each. Never attempt a full-file rewrite of a monolith — the output won't fit and nothing lands.
