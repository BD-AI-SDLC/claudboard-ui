## Context

The Project screen currently shows vertical operations as a flat list of rows (lines 144–223 in `Project.tsx`). Each row shows an icon, title, command shortcut, status badge, and contextual buttons. There is no visual dependency structure, no setup progress indicator, and no distinction between "foundation" ops (must complete in order before feature runs unlock) and "maintenance" ops (optional, run anytime their deps are met).

The design reference (`ui/designs/Setup Variants.html`, Variant A) replaces this flat list with three distinct UI zones — a setup banner, a foundation chain, and a maintenance grid — all inline on the existing Project route.

The existing `PrereqRecord` data model (`protocol/src/types.ts:28-37`) already carries everything needed: `state` (done/stale/missing), `lastRun` (ISO timestamp or null), `duration`, `cost`, and `output`. The server dependency map (`server/src/prereq/validators.ts:2-8`) defines the DAG. No server or schema changes are required — all new visual states are derived in the UI.

## Goals / Non-Goals

**Goals:**
- The 3 foundation ops (Analyse → Generate → Feature-workflow) render as a visual DAG chain with arrow connectors and state-colored cards, making the dependency order obvious.
- A setup banner shows progress (N of 3 done) with a single CTA pointing at the next required step, and collapses to a completion ribbon when all 3 are done.
- Maintenance ops (Refresh, Tech debt) render in a separate 2-column grid below the chain.
- Operations detected from disk (artifact exists, never run from UI) display an "imported from disk" badge.
- The "imported" badge clears after the first re-run from the UI.

**Non-Goals:**
- Variant B (dedicated setup screen with its own route and sidebar slot). That's a separate change if desired later.
- Real-time WebSocket push for prereq state changes. The UI continues to poll on mount and after runs complete.
- Animations or transitions for banner collapse, card state changes, or chain layout.
- Sticky/floating banner behavior. The banner scrolls with the page.
- Changes to the sidebar, routing, or any screen other than Project.
- Server-side changes of any kind.

## Decisions

### D1. Visual states are derived in the UI, not stored

**Choice:** Introduce a pure function `deriveVisualState(prereq, deps, running)` in a new `setup-utils.ts` that maps `PrereqRecord` + dependency satisfaction + local running state → one of 7 visual states.

```
type VisualState = 'done' | 'done-imported' | 'stale' | 'running' | 'next' | 'locked' | 'missing'
```

Derivation rules:
- `running[cmd]` is true → `'running'`
- `state === 'done' && lastRun !== null` → `'done'`
- `state === 'done' && lastRun === null` → `'done-imported'`
- `state === 'stale'` → `'stale'`
- deps not all `done` → `'locked'`
- first unlocked card that is not done → `'next'`
- everything else → `'missing'`

**Why not in the DB:** These states are presentation concerns. `locked` and `next` depend on sibling prereq states, which would require a server round-trip to recompute on every state change. `done-imported` is already derivable from `lastRun === null`. Keeping derivation in the UI means zero schema migration, zero API changes, and instant responsiveness.

### D2. Dependency map duplicated as a UI constant

**Choice:** Define `FOUNDATION_DEPS` and `MAINTENANCE_DEPS` in `setup-utils.ts`:

```typescript
const FOUNDATION_DEPS: Record<string, string[]> = {
  'analyse': [],
  'generate': ['analyse'],
  'claudboard-workflow': ['generate'],
}

const MAINTENANCE_DEPS: Record<string, string[]> = {
  'refresh': ['generate'],
  'techdebt': ['analyse'],
}
```

**Why duplicate instead of importing from server:** The server uses this for validation (`validators.ts`); the UI uses it for visual layout. They live in different packages (`server` vs `ui`) with no shared import path. The dependency map is small (5 entries), stable (it changes only when new ops are added), and already implicitly encoded in the design. The cost of duplication is negligible; the cost of adding a shared package or API endpoint for 5 key-value pairs is not worth it.

**Risk:** If someone adds a new prereq to the server map but forgets the UI map, the UI won't show it. Mitigation: a comment in both files referencing the other. If the maps drift beyond trivial changes, factor them into the protocol package.

### D3. Foundation chain uses CSS Grid with fixed columns

**Choice:** The chain renders as a 5-column CSS Grid: `1fr 14px 1fr 14px 1fr`. Columns 2 and 4 are arrow connectors (`→` character, centered, muted color). This mirrors the design HTML exactly.

**Why not flexbox:** The arrow connectors need to be vertically centered against cards that vary in height (done cards may have meta rows that next/locked cards omit). CSS Grid's `align-items: stretch` handles this cleanly; flexbox would need explicit height matching.

**Why not a generic "chain" component with N items:** We always have exactly 3 foundation ops. A generic component adds abstraction for a case that doesn't vary. If we ever add a 4th foundation op, adding two more grid columns is trivial.

### D4. OperationCard is a shared component for both groups

**Choice:** A single `OperationCard` component renders in both the foundation chain and the maintenance grid. It accepts a `visualState` prop and a `variant` prop (`'foundation' | 'maintenance'`).

- **Foundation variant:** Shows a numbered step circle (1/2/3), chain-aware styling (border glow for `next`/`running`, dimmed for `locked`).
- **Maintenance variant:** Shows an icon character (`↻` for refresh, `⚠` for techdebt) instead of a step number. No chain glow — just standard card borders.

Both variants share: title, command shortcut, description, meta row, footer with contextual buttons, and the "imported from disk" badge.

**Why one component:** The card anatomy is identical across both groups. Splitting into two components would duplicate the status-to-button mapping, the meta row rendering, and the imported badge logic.

### D5. Setup banner collapses purely by computation

**Choice:** `SetupBanner` renders one of two states based on `allFoundationDone`:
- `false` → Full banner: violet gradient, progress bar, CTA button.
- `true` → Collapsed ribbon: single line, green checkmark, "Setup complete" text.

No dismiss button. No persistence. No animation.

**Why no dismiss:** The banner's purpose is progress communication. Once complete, the collapsed ribbon is minimal (one line, ~24px tall). Dismissing it would hide the "everything is set up" signal, which is useful context when returning to the page. The design explicitly specifies this behavior.

### D6. Replace the existing `workflowOutdated` CTA banner

**Choice:** Remove the `project__regen-cta` block at lines 127–142 of `Project.tsx`. Its function (alerting when feature-workflow is stale/missing and offering a re-run button) is fully subsumed by the setup banner + foundation chain.

**Why:** The setup banner already shows the next required step with a CTA. The foundation chain's workflow card shows its state and offers a Run/Re-run button. Having both the old CTA and the new banner would be redundant and visually confusing.

### D7. PREREQ_DEFS split into two arrays

**Choice:** Replace the single `PREREQ_DEFS` array with two:

```typescript
const FOUNDATION_OPS = [
  { id: 'analyse', title: 'Analyse', cmd: '/mileva-analyse', desc: '...', step: 1 },
  { id: 'generate', title: 'Generate', cmd: '/mileva-generate', desc: '...', step: 2 },
  { id: 'claudboard-workflow', title: 'Feature-workflow', cmd: '/mileva-workflow', desc: '...', step: 3 },
]

const MAINTENANCE_OPS = [
  { id: 'refresh', title: 'Refresh', cmd: '/mileva-refresh', desc: '...', icon: '↻' },
  { id: 'techdebt', title: 'Tech debt', cmd: '/mileva-techdebt', desc: '...', icon: '⚠' },
]
```

**Why split:** The rendering is different (chain vs grid), the data shape is different (step number vs icon character), and the logic is different (sequential dependency vs independent). A single array with if-branches is harder to follow than two purpose-specific arrays.

**Note on command names:** The design uses `/mileva-analyse`, `/mileva-generate`, etc. The existing API sends `analyse`, `generate`, etc. as the `cmd` parameter. The `/mileva-` prefix is display-only — the `id` field maps to the API command. This is the same as today: `PREREQ_DEFS` already has `cmd: '/analyse'` as a display label while `handleRunPrereq(def.id)` sends the bare id.

## Risks / Trade-offs

- **[Page length]** — Adding the banner + chain + maintenance grid above any future metrics/artifacts section makes the Project page taller. The design's own trade-off section calls this out. Mitigation: the collapsed banner is 1 line; once setup is done, the chain cards are compact. If it becomes a real problem, a follow-up can add section collapsing.

- **[Dependency map duplication]** — The UI has its own copy of the dependency map (D2). If the server adds a new op, the UI map must be updated too. Mitigation: small surface area (5 entries), comments cross-referencing both locations.

- **["Imported" confusion]** — Users who only use the dashboard (never the terminal) will never see the imported badge. Users who run everything from the terminal will see every op as imported. The badge is most useful during the transition period when a team is adopting the dashboard. Acceptable — the badge is informational, not blocking.

- **[No real-time prereq updates]** — If a prereq run finishes while the user is on another tab, the Project page won't update until the next mount or manual refresh. Same behavior as today. A future WebSocket push for prereq events would solve this but is out of scope.
