# design-sync notes — BranchPilot

BranchPilot is an **Electron + Vite app**, not a published component library. The
sync is deliberately **scoped** to the reusable, presentational primitives (tokens
+ a curated set of components); the IPC/Electron-coupled views are intentionally
excluded.

## How this repo is converted (non-obvious — read before re-sync)

- **Shape:** `package` (no Storybook). There is **no library build / `dist/`**, so
  the normal package path (bundle from `dist/` + shipped `.d.ts`) does not apply.
- **Custom bundle entry, NOT synth-entry.** We pass a hand-authored entry,
  `.design-sync/entry.tsx` (committed), via `--entry`. It re-exports ONLY the
  scoped components and imports the real app stylesheets. This avoids the default
  synth-entry behaviour (`export * from` every `src/*.tsx`), which would pull the
  Electron/IPC-coupled modules into the IIFE and risk crashing every preview.
  - Build invocation (note the `--entry`, which re-sync must keep):
    `node .ds-sync/package-build.mjs --config .design-sync/config.json --node-modules ./node_modules --entry ./.design-sync/entry.tsx --out ./ds-bundle`
- **Component list = `componentSrcMap` pins.** With a custom entry and no `.d.ts`,
  discovery finds nothing on its own; each scoped component is pinned in
  `componentSrcMap` (path also drives JSDoc + group). To add/remove a component:
  edit BOTH `entry.tsx` (the re-export) and `componentSrcMap` (the pin).
- **Props contracts are hand-written** in `cfg.dtsPropsFor` because the components
  use inline anonymous prop types (no named `XProps` interface) and there is no
  `.d.ts` for ts-morph to read. Keep these in sync with the source props.
- **CSS is baked from source by esbuild.** `entry.tsx` imports `src/index.css`
  (tokens + base) and `src/App.css` (which `@import`s `src/styles/app01–05.css`,
  the component classes). esbuild bundles all of it into `_ds_bundle.css` — no
  `cfg.cssEntry`, no rot, no broken `@import`s. If component styling looks wrong,
  check those source files, not a copied stylesheet.
- **Install:** `node_modules` is the repo's own working install (has `react`). We
  do NOT run `npm ci` here — it would wipe the user's active dev `node_modules`
  and isn't needed (there's no DS build to reproduce). `.ds-sync/` has its own
  isolated deps (esbuild, ts-morph, @types/react).

## Re-sync risks (watch-list)

- `entry.tsx` and `componentSrcMap` must stay aligned — a component in one but not
  the other silently drops or fails to render.
- `dtsPropsFor` bodies are a hand-maintained mirror of the source props; if a
  component's props change upstream, the contract here goes stale (won't fail the
  build — it's syntax-only validated). Re-check on re-sync.
- Font: `index.css` names **Inter** in a `font:` shorthand (with `ui-sans-serif,
  system-ui, …` fallbacks) but ships no `@font-face`. validate did **not** emit
  `[FONT_MISSING]` (the check only flags `@font-face` families). Designs render in
  the system fallback, which is the app's own behaviour — acceptable, no action.
- Supplemental tokens: `.design-sync/ds-tokens.css` defines 4 vars the app's CSS
  references but never defines (`--danger`, `--mono`, `--shadow-lg`,
  `--border-strong`). If the app later defines them in `src/`, drop them here to
  avoid a stale duplicate.
- Toaster preview re-anchors `.toast-stack` from `position: fixed` to `absolute`
  (scoped to `.ds-toast-stage`) so the toasts stay inside the card cell instead of
  escaping to the page corner. Visual is identical (bottom-right of the surface).
- If `src/styles/app0x.css` are renamed/restructured, update `App.css`'s imports
  (the app already depends on this) — the bundle follows whatever `App.css` pulls.

## Known render warns

These are triaged-benign and expected on every sync (re-syncs should NOT treat
them as new):

- `[RENDER_THIN] BranchPilotMark` — pure SVG icon, no text content; the heuristic
  flags "no text" but it paints correctly (confirmed in the contact sheet).
- `[RENDER_THIN] LinkedinIcon` — same: pure SVG icon, no text content; paints fine.

## Expanded component set (18 added)

Extracted 18 reusable primitives from the app's inline UI into `src/components/`,
registered + previewed the same way as the original 15 (entry.tsx re-export +
`componentSrcMap` pin + `dtsPropsFor` body + `cardMode` override for wide ones):

- **controls:** SegmentedControl, IconButton, SelectableChipGroup, ActionCard, ChoiceOptionCard
- **feedback:** StatusPill, StatusDot
- **data-display:** CountBadge, Chip, SeverityCountStrip, FindingCard, Avatar, Meter, CopyableCodeBlock
- **git:** FileStatusToken, FileTypeIcon, DiffStatBadges, CommitRefChip

(All land in the `general` DS group — grouping by `@category` is a possible future
refinement.) Each renders the app's REAL shipped CSS classes so it looks identical
to the inline original. `IconButton` `tone="danger"` renders `danger-button`
(resting red), not `.icon-button.danger` (hover-only), so the variant is visibly
destructive.

### Rewiring caveats (class-family divergences — do NOT blind-swap)

Some components consolidate several app class families under one tone/variant. Only
rewire inline sites where the rendered class is IDENTICAL; these sites change the
class and would shift appearance, so leave them (or accept the change knowingly):

- **StatusPill** renders `check-bucket`/`github-status` families. Exact match:
  ProvidersPanels check-bucket pills. Divergent (leave): DashboardView
  `state-badge-*`, ProviderRemoteCard `remote-support-chip`.
- **Meter** renders `contributor-meter`/`contributor-bar` (gradient) + the
  `review-progress-track` sweep. Divergent (leave): DashboardView `leader-bar`
  (flat accent fill).
- **DiffStatBadges** renders `.diff-stats .additions/.deletions`. Divergent (leave):
  DashboardView `churn-add/churn-del`, HistoryView `commit-hover-stats .add/.del`.
- **IconButton** `tone="danger"` = `danger-button` (resting red). The AppShellBar
  sites use `icon-button danger` (hover-only) — rewiring them changes resting look.
  WorktreesTagsPanel `danger-button icon-button` sites are exact matches.

### Components that need a parent wrapper for full styling (standalone caveat)

Geometry/layout comes from an ancestor class, so previews wrap them; a design agent
using them standalone should add the wrapper noted in each `.prompt.md`:

- **CountBadge** → `.dashboard-section-heading` ancestor (pill geometry).
- **CommitRefChip** → `.commit-hover-refs` flex-wrap container.
- **ChoiceOptionCard** → `.switch-options` flex-column.
- **ActionCard** → `.no-changes-cards` column.
