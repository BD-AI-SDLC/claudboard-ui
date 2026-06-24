## Why

The Project screen currently renders vertical operations (analyse, generate, workflow, refresh, techdebt) as a flat list of rows with status badges and action buttons. This works mechanically, but:

1. **No dependency visibility.** The foundation ops form a strict DAG (analyse → generate → workflow), but the UI shows them as a flat unordered list. Users can't see why a button is disabled or what to run next without reading error toasts.

2. **No setup progress.** A repo that needs 3 foundation steps done before feature runs unlock has no progress indicator, no "2 of 3 done" context, and no single CTA pointing at the next step.

3. **No "imported" concept.** When a user has already run `/analyse` from the terminal, `detectPrereqs()` finds the artifact and marks it `done` — but the UI shows it identically to an op that was run from the dashboard. There's no way to tell "this was detected from disk" vs "I ran this here."

4. **No visual distinction between foundation and maintenance ops.** Analyse/Generate/Workflow must be done in order before any feature run; Refresh/Techdebt are optional ongoing ops. The flat list treats them identically.

Design reference: `ui/designs/Setup Variants.html` — Variant A (Inline · in Project Health).

## What Changes

The existing vertical operations panel on the Project screen is replaced with three new UI zones: a **setup banner**, a **foundation chain**, and a **maintenance grid**. No new routes, no sidebar changes, no server changes.

### State derivation (UI-only)

Visual card states are derived from existing `PrereqRecord` fields — no DB schema changes:

- **`done`** — `state === 'done' && lastRun !== null`
- **`done-imported`** — `state === 'done' && lastRun === null` (artifact found on disk, never run from UI)
- **`stale`** — `state === 'stale'`
- **`running`** — local React state (already tracked in `Project.tsx`)
- **`next`** — first foundation card whose deps are all `done` but which is not `done` itself
- **`locked`** — deps not all `done` and not the `next` card
- **`missing`** — `state === 'missing'` and deps are met (same as `next` for foundation ops)

The dependency map is the same one the server already validates:

```
analyse       → []
generate      → [analyse]
claudboard-workflow → [generate]
refresh       → [generate]
techdebt      → [analyse]
```

### Setup banner (`SetupBanner`)

A violet-gradient banner pinned at the top of the Project body, above the foundation chain.

- Shows "Set up Mileva for this repo" title with a workspace-mode chip.
- Descriptive subtitle explaining why feature runs are locked.
- Progress bar: `completedCount / 3` with percentage label.
- Single amber CTA button: "▶ Run /mileva-{next}" pointing at the next required step.
- **Collapse rule**: when all 3 foundation ops are `done`, the banner collapses to a single-line "✓ Setup complete" ribbon. Purely computed — no persistence, no dismiss button.

### Foundation chain (`FoundationChain`)

A 3-column CSS grid with arrow connectors showing the DAG:

```
┌──────────┐     ┌──────────┐     ┌──────────┐
│ 1 Analyse│ ──▶ │2 Generate│ ──▶ │3 Workflow│
│   Done   │     │   Done   │     │   Next   │
└──────────┘     └──────────┘     └──────────┘
```

Each card (`OperationCard`) renders:
- Step number circle (color-coded by visual state)
- Title + command shortcut (e.g. `/mileva-analyse`)
- Description text
- Meta row: duration, cost, age/imported tag
- Footer: contextual buttons (View report, Re-run, Run now) + "imported from disk" badge when applicable
- Border color + glow matches state: green=done, teal=running, violet=next, dimmed=locked

### Maintenance grid (`MaintenanceGrid`)

A 2-column grid below the foundation chain for refresh and techdebt. These cards use the same `OperationCard` component but:
- Show `↻` / `⚠` icons instead of step numbers
- Are independently runnable once their deps are met
- Show stale/not-run status

### Section headers

Each group gets a header row with title, subtitle, and a completion badge (e.g. "2 / 3").

### What does NOT change

- **Server** — no API changes, no schema changes, no new endpoints.
- **Sidebar** — no navigation changes. "Start feature" lock behavior stays the same.
- **Routing** — no new routes. Everything stays on the `project` route.
- **PrereqRecord schema** — the existing `state`, `lastRun`, `duration`, `cost`, `output` fields provide all the data needed. Visual states are derived.
- **`detectPrereqs()`** — server detection logic is unchanged.
- **Other screens** — Dashboard, Kickoff, ActiveRun, ReviewGate are untouched.

## Capabilities

### New Capabilities

- `setup-banner`: Project screen shows a violet setup banner with progress bar and next-step CTA when foundation ops are incomplete; collapses to a completion ribbon when all done.
- `foundation-chain`: Project screen renders the 3 foundation ops (Analyse → Generate → Workflow) as a visual DAG chain with arrow connectors and state-colored cards.
- `maintenance-grid`: Project screen renders Refresh and Tech debt as a 2-column grid below the foundation chain.
- `imported-badge`: Operations detected from disk (artifact exists but never run from UI) display an "imported from disk" badge that clears after the first re-run.

### Modified Capabilities

- `web-ui`: `Project screen renders vertical operations as a flat list` is REMOVED. Replaced by `Project screen renders setup banner + foundation chain + maintenance grid with DAG-aware visual states`.

## Impact

- **Code deleted.**
  - The vertical operations panel section in `ui/src/components/Project/Project.tsx` (~80 lines covering `PREREQ_DEFS` mapping + row rendering) — replaced by new components.

- **Code added.**
  - `ui/src/components/Project/SetupBanner.tsx` — progress banner with collapse logic. ~60 LoC.
  - `ui/src/components/Project/FoundationChain.tsx` — 3-column chain grid with arrow connectors. ~80 LoC.
  - `ui/src/components/Project/OperationCard.tsx` — rich card with state-driven styling and contextual actions. ~120 LoC.
  - `ui/src/components/Project/MaintenanceGrid.tsx` — 2-column grid wrapper. ~40 LoC.
  - `ui/src/components/Project/setup-utils.ts` — visual state derivation from `PrereqRecord` + dependency map. ~50 LoC.
  - CSS additions to `Project.css` or a new `Setup.css` — chain layout, banner gradient, card states, connectors. ~200 LoC.

- **Code edited.**
  - `ui/src/components/Project/Project.tsx` — replace flat prereq rendering with `SetupBanner` + `FoundationChain` + `MaintenanceGrid` composition. Keep existing prereq fetching and running-state logic.

- **Tests.**
  - `setup-utils.test.ts` — state derivation: locked/next/imported/done/stale/running from various prereq combinations.
  - `SetupBanner.test.tsx` — renders progress, collapses when done.
  - `FoundationChain.test.tsx` — renders 3 cards with correct visual states, arrow connectors.
  - `OperationCard.test.tsx` — contextual button rendering per state, imported badge.

- **Out of scope.**
  - Variant B (dedicated setup screen) — a different change if we want it later.
  - Real-time WebSocket updates for prereq state changes during a run.
  - Animations/transitions for banner collapse.
  - Sticky/floating banner behavior for long pages.
