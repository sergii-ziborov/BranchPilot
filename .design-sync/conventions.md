# BranchPilot design system — how to build with it

BranchPilot is a desktop Git client. These components are its real, shipped UI
primitives. The visual language is a **GitHub-style, light-default, themeable
surface** driven entirely by **CSS custom properties (design tokens)**.

## Setup: no provider needed

Every component here is **standalone and props-driven** — render them directly,
with no `ThemeProvider`, context, or wrapper. They are exposed on
`window.BranchPilot.*`. The only requirement is that the design-system stylesheet
is loaded (it is, via `styles.css` → `_ds_bundle.css`); that stylesheet defines
all the tokens and the components' own classes. There is no theme switch to flip —
the bundle ships the light theme as `:root` defaults.

## Styling idiom: tokens, not utility classes

This is **not** a utility-class system (no Tailwind) and **not** a styled-props
system. Each component renders fixed, semantic markup that is already styled by the
bundled stylesheet. So:

- **Do not** invent class names for these components or pass `className` to restyle
  them — they don't expose a class API. Use their **props** (see each `.d.ts`).
- **For your own layout glue**, style with the same design tokens via
  `var(--token)`. Re-theme by overriding these custom properties on a container.

Core tokens (all real `var(--*)`, defined in the bundled stylesheet):

| Group | Tokens |
|---|---|
| Text | `--text`, `--text-strong`, `--muted` |
| Surfaces | `--surface` (app bg), `--panel`, `--panel-2` (raised), `--sidebar` |
| Borders | `--border`, `--border-strong` |
| Accent | `--accent`, `--accent-strong`, `--accent-soft`, `--accent-contrast` |
| Status | `--danger` |
| Type | base = Inter / system-ui; `--mono` for code |
| Elevation | `--shadow-lg` |

There are also rich `--diff-*` and `--syntax-*` token families for diff and
code-syntax UIs.

The design language is also carried by **variant props** — e.g. `Stat`'s
`tone` (`'neutral' | 'info' | 'warn' | 'danger' | 'ok'`), `PanelHeading`'s
`compact`. Reach for the prop before any custom styling.

## Where the truth lives

- `styles.css` (and its `@import "./_ds_bundle.css"`) — every token and every
  component class. Read it before styling.
- `components/<group>/<Name>/<Name>.prompt.md` — usage + examples per component.
- `components/<group>/<Name>/<Name>.d.ts` — the exact props API.

## One idiomatic example

```tsx
// Components are standalone; tokens drive your own layout glue.
const { PanelHeading, Stat } = window.BranchPilot

function WorkingTreeSummary() {
  return (
    <section style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 8, padding: 16 }}>
      <PanelHeading title="Working tree" description="Current changes in this repository." />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginTop: 12 }}>
        <Stat label="Staged" value={8} tone="ok" />
        <Stat label="Conflicts" value={2} tone="danger" />
      </div>
    </section>
  )
}
```
