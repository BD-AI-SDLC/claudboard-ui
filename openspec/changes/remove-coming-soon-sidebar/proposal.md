## Why

The sidebar (`ui/src/components/primitives/Sidebar.tsx:36-41, 194-209`) renders two sections. The upper "Workflow" section contains five real, routed nav entries. The lower section, labelled **Project**, contains four entries — **Run history**, **Skills**, **Rules**, **Settings** — that have shipped as visually-present-but-permanently-disabled placeholders since the sidebar was first introduced:

```tsx
const LOWER_ITEMS = [
  { id: 'history',  label: 'Run history', icon: 'history'  },
  { id: 'skills',   label: 'Skills',      icon: 'skill'    },
  { id: 'rules',    label: 'Rules',       icon: 'book'     },
  { id: 'settings', label: 'Settings',    icon: 'settings' },
]
// ...rendered as:
<div className="sidebar__item sidebar__item--disabled"
     role="button" aria-disabled="true" tabIndex={-1}
     title="Coming soon">
  ...
</div>
```

These four items are not wired to anything. There is no route, no handler, no API endpoint, no protocol type, no DB table, no test, no in-flight change proposal that builds toward them. The only behaviour is a `title="Coming soon"` tooltip on hover. Every user on every session sees four greyed-out promises that never resolve.

The user-facing cost is twofold:

- **Trust erosion.** "Coming soon" is a promise. After enough sessions without delivery, it reads as either "abandoned" or "lying." Either reading is worse than absence.
- **Visual weight.** The four items occupy ~150px of vertical sidebar space and add an entire section header. On smaller laptops they push the theme toggle further from the active workflow nav, where the user's attention actually lives.

The maintenance cost is small but non-zero: every Sidebar change forces a contributor to re-read the lower section's wiring (or its absence) to confirm they aren't breaking it. Deleting it removes that ambient question.

This is the same posture as the recently-merged `remove-kickoff-recent-runs` and `remove-clone-from-git-url` changes — delete dead UI scaffolding cleanly rather than letting it accumulate. When a real Settings / Rules / Skills / Run-history surface is built, it lands through its own change proposal on a clean baseline, deciding its own UX questions (where it lives in the IA, what the empty state is, what the active-state is) rather than inheriting them from a placeholder.

## What Changes

### UI (`ui/src/components/primitives/Sidebar.tsx`)

- Delete the module-level `LOWER_ITEMS` constant (lines 36–41).
- Delete the second `<div className="sidebar__section">` block that renders the lower section (lines 194–209), including its `.sidebar__section-label` "Project" header and the `{LOWER_ITEMS.map(...)}` body.
- The surviving `<nav className="sidebar__nav">` therefore contains a single `<div className="sidebar__section">` — the Workflow section — unchanged.
- Audit imports after the deletion. `Icon` is still used elsewhere in the file (the Workflow nav items use `<Icon name={item.icon} ... />` in `renderNavItem`). KEEP. No other imports are affected.

### UI (`ui/src/components/primitives/Sidebar.css`)

**No changes.** Every CSS class the deleted block used is still used by the surviving Workflow section:

- `.sidebar__section` — used by the Workflow section wrapper.
- `.sidebar__section-label` — used by the Workflow section's "Workflow" label.
- `.sidebar__item` — used by every Workflow nav item.
- `.sidebar__item--disabled` — still used by Workflow items in their disabled state (e.g. `Project · health` when no repo is attached, `Active run` when no run is active, `Review gate` when no gate awaits, `Start feature` when foundation setup is incomplete — all rendered with this modifier when `item.enabled === false` in `renderNavItem`).

No orphaned class definitions remain. This is verified by inspection of `renderNavItem` (`Sidebar.tsx:149-167`).

### UI (`ui/src/components/primitives/Sidebar.test.tsx`) — NEW

This file does not currently exist. Create it from scratch following the project's co-located test convention (UI tests live next to their component file, never in a `__tests__/` folder — see `ui-conventions.md`). The test SHALL:

- Render `<Sidebar ... />` with minimal valid props (no repos, no runs, no active project) and assert that none of the four removed labels appear in the DOM:
  - `screen.queryByText(/^Run history$/)` is `null`.
  - `screen.queryByText(/^Skills$/)` is `null`.
  - `screen.queryByText(/^Rules$/)` is `null`.
  - `screen.queryByText(/^Settings$/)` is `null`.
- Assert that the lower section's header label is also absent: `screen.queryAllByText(/^Project$/i)` returns either zero matches or matches that are demonstrably from `ProjectSwitcher` (e.g. its "Add project" button text) rather than a `.sidebar__section-label`. The simplest form is to assert no element with class `.sidebar__section-label` has text content `"Project"`.
- Assert that the Workflow section is still rendered (positive guardrail): `screen.getByText('Overview')` is present, confirming the deletion did not over-reach.
- Test name SHOULD be explicit, e.g. `does not render the legacy "Coming soon" placeholder section`, so a future developer reading a failure understands the intent without spelunking git history.

### Out of scope

- **The `Project · health` entry in the Workflow nav.** It is functional (routes to `<ProjectView />`) and is not part of this removal. This change touches the lower section only.
- **Building a real Settings / Rules / Skills / Run-history surface.** Each of those, if built, is its own change with its own UX decisions. This proposal deliberately does not pre-commit shape for them.
- **The `ui/designs/*.html` static mockups.** Multiple design HTML files (`Setup Variants.html`, `Active Run Variants.html`, `Overview Variants.html`, etc.) include "Run history / Skills / Rules / Settings" entries in their sidebars. These are frozen design references, not live code, and are not consumed by the build. Re-syncing the design mockups to match the new sidebar is a separate housekeeping task that does not gate this change.
- **The `Coming soon` tooltip on `ProjectSwitcher.tsx:123`.** That is an unrelated placeholder inside the project-switcher dropdown (likely for a future "manage projects" action). Out of scope; named here only so a future reader doesn't mistake it for a missed reference.
- **Restructuring the sidebar to drop the "Workflow" section label** now that only one section remains. The label is small, consistent with how the sidebar reads today, and harmless. If the team later decides a one-section sidebar shouldn't carry a section label, that's a one-line follow-up — not bundled here, to keep the diff strictly subtractive.

### No live-spec delta

The live `openspec/specs/web-ui/spec.md` describes the sidebar's responsibilities (the Workflow nav routes, the project switcher, the theme toggle) and does NOT describe a Settings / Rules / Skills / Run-history section. There is no requirement to **REMOVE**, **MODIFY**, or **ADD**. This change directory therefore has no `specs/` subdirectory — by design, not by omission. Same posture as `remove-kickoff-recent-runs` and `remove-clone-from-git-url`.
