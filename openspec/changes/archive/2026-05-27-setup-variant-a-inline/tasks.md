## 1. Create setup-utils with visual state derivation and dependency maps

- [x] 1.1 Create `ui/src/components/Project/setup-utils.ts`. Export a `VisualState` type:
  ```typescript
  type VisualState = 'done' | 'done-imported' | 'stale' | 'running' | 'next' | 'locked' | 'missing'
  ```

- [x] 1.2 Export the dependency maps:
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
  Add a comment referencing `server/src/prereq/validators.ts` as the source of truth.

- [x] 1.3 Export `deriveVisualState(prereq: PrereqRecord | undefined, allPrereqs: Record<string, PrereqRecord>, deps: string[], isRunning: boolean): VisualState`:
  - If `isRunning` → `'running'`
  - If `prereq` is undefined or state is `'missing'`:
    - If all deps are satisfied (each dep's prereq has `state === 'done'`) → `'next'`
    - Else → `'locked'`
  - If `state === 'done' && lastRun === null` → `'done-imported'`
  - If `state === 'done' && lastRun !== null` → `'done'`
  - If `state === 'stale'` → `'stale'`
  - Fallback → `'missing'`

- [x] 1.4 Export `deriveFoundationStates(prereqs, running)` — returns an ordered array of `{ def, visualState }` for the 3 foundation ops. Uses `FOUNDATION_DEPS` to determine dep satisfaction. Special handling: among all non-done foundation cards, only the first gets `'next'`; the rest get `'locked'` (enforcing sequential ordering even though individual deps might be met).

- [x] 1.5 Export `deriveMaintenanceStates(prereqs, running)` — returns an array of `{ def, visualState }` for the 2 maintenance ops. Uses `MAINTENANCE_DEPS`. No sequential constraint — each card's state is independent.

- [x] 1.6 Export the operation definition arrays:
  ```typescript
  const FOUNDATION_OPS = [
    { id: 'analyse', title: 'Analyse', cmd: '/mileva-analyse', desc: 'Read-only scan: patterns, anti-patterns, workflow signals, stack detection.', step: 1 },
    { id: 'generate', title: 'Generate', cmd: '/mileva-generate', desc: 'Render CLAUDE.md, rules with paths frontmatter, full-scope skills.', step: 2 },
    { id: 'claudboard-workflow', title: 'Feature-workflow', cmd: '/mileva-workflow', desc: 'Generate the .claude/skills/feature-workflow/ orchestrator skill (agents, scripts, config.json).', step: 3 },
  ]
  const MAINTENANCE_OPS = [
    { id: 'refresh', title: 'Refresh', cmd: '/mileva-refresh', desc: 'Delta update: compare current code against existing artifacts; flag stale or missing rules.', icon: '↻' },
    { id: 'techdebt', title: 'Tech debt', cmd: '/mileva-techdebt', desc: 'Deep tech debt analysis. Module-grouped, ticket-ready report with severity, effort, and fix suggestions.', icon: '⚠' },
  ]
  ```

## 2. Create OperationCard component

- [x] 2.1 Create `ui/src/components/Project/OperationCard.tsx`. Props:
  ```typescript
  interface OperationCardProps {
    title: string
    cmd: string
    desc: string
    visualState: VisualState
    stepNumber?: number       // foundation: 1, 2, 3
    icon?: string             // maintenance: '↻', '⚠'
    lastRun?: string | null
    duration?: number | null  // milliseconds
    cost?: number | null      // cents
    onRun: () => void
    onViewReport?: () => void
    isRunning: boolean
  }
  ```

- [x] 2.2 Render the step indicator circle:
  - Foundation: numbered circle (`stepNumber`) with state-colored background:
    - `done` / `done-imported` → green bg
    - `running` → teal bg
    - `next` → violet bg
    - `locked` → grey/surface bg
  - Maintenance: icon character (`icon`) with neutral styling.

- [x] 2.3 Render the card body:
  - Header row: step circle + title + status label (e.g. "Done", "Next", "Locked").
  - Command shortcut in mono font (e.g. `/mileva-analyse`).
  - Description text.
  - Meta row: duration (formatted), cost (formatted as $X.XX), age/timestamp. For `done-imported`: show "Xd ago · imported". For `next`/`locked`: show estimated time/cost from the design.

- [x] 2.4 Render the card footer with contextual buttons based on `visualState`:
  - `done` → "View report" (ghost) + "Re-run" (default)
  - `done-imported` → "imported from disk" badge (blue, left-aligned) + "View report" (ghost) + "Re-run" (default)
  - `stale` → "Preview diff" (ghost) + "Refresh" (amber)
  - `next` → "Preview config" (ghost, only for workflow) + "Run now" (amber)
  - `running` → "Running…" (disabled)
  - `locked` → "Requires: {depName}" text with lock icon, no action buttons
  - `missing` → same as `next` when deps are met (since `deriveVisualState` maps this correctly)

- [x] 2.5 Apply card border styling via a `data-state` attribute on the root element:
  - `done` / `done-imported` → `border-color: color-mix(green 30%, border)`
  - `running` → `border-color: teal; box-shadow: 0 0 0 3px teal/15%`
  - `next` → `border-color: violet; box-shadow: 0 0 0 3px violet/15%`
  - `locked` → `opacity: 0.6; background: bg-2`
  - default → standard border

## 3. Create SetupBanner component

- [x] 3.1 Create `ui/src/components/Project/SetupBanner.tsx`. Props:
  ```typescript
  interface SetupBannerProps {
    prereqs: Record<string, PrereqRecord>
    running: Record<string, boolean>
    onRunNext: (cmd: string) => void
  }
  ```

- [x] 3.2 Derive state internally:
  - `foundationIds = ['analyse', 'generate', 'claudboard-workflow']`
  - `completedCount = foundationIds.filter(id => prereqs[id]?.state === 'done').length`
  - `allDone = completedCount === 3`
  - `nextStep = first foundationId whose prereq is not 'done' AND whose deps are all 'done'`

- [x] 3.3 Render collapsed state (`allDone === true`):
  - Single-line green ribbon: "✓ Setup complete — feature-workflow is ready"
  - Minimal height, no CTA button.

- [x] 3.4 Render expanded state (`allDone === false`):
  - Violet gradient background: `linear-gradient(180deg, violet-dim 0%, surface 80%)`
  - Violet border, 12px border-radius.
  - Grid layout: `36px 1fr auto` (icon, text, CTA).
  - Icon: gear/crosshair SVG in violet circle.
  - Title: "Set up Mileva for this repo" with workspace-mode chip.
  - Subtitle: contextual message explaining what's blocking (e.g. "Feature-workflow can't run yet because…").
  - Progress bar: `completedCount / 3` fill with percentage label.
  - CTA button: amber, "▶ Run /mileva-{nextCmd}", calls `onRunNext(nextCmd)`.

## 4. Create FoundationChain component

- [x] 4.1 Create `ui/src/components/Project/FoundationChain.tsx`. Props:
  ```typescript
  interface FoundationChainProps {
    prereqs: Record<string, PrereqRecord>
    running: Record<string, boolean>
    onRun: (cmd: string) => void
    onViewReport?: (cmd: string) => void
  }
  ```

- [x] 4.2 Use `deriveFoundationStates(prereqs, running)` from setup-utils to get the 3 ops with their visual states.

- [x] 4.3 Render a section header: "Foundation" title + "ordered — each step requires the previous" subtitle + completion badge ("N / 3").

- [x] 4.4 Render the chain grid: CSS Grid `1fr 14px 1fr 14px 1fr`. The 3 `OperationCard`s in columns 1, 3, 5. Arrow connectors (`→`) in columns 2 and 4, vertically centered, muted color.

## 5. Create MaintenanceGrid component

- [x] 5.1 Create `ui/src/components/Project/MaintenanceGrid.tsx`. Props:
  ```typescript
  interface MaintenanceGridProps {
    prereqs: Record<string, PrereqRecord>
    running: Record<string, boolean>
    onRun: (cmd: string) => void
    onViewReport?: (cmd: string) => void
  }
  ```

- [x] 5.2 Use `deriveMaintenanceStates(prereqs, running)` from setup-utils to get the 2 ops with their visual states.

- [x] 5.3 Render a section header: "Maintenance" title + "available once foundation is done — keeps artifacts fresh" subtitle.

- [x] 5.4 Render a 2-column CSS Grid with `OperationCard` for Refresh and Tech debt.

## 6. CSS for new setup components

- [x] 6.1 Add CSS for the setup banner to `Project.css` (or a new `Setup.css` imported by `Project.tsx`):
  - `.setup-banner` — violet gradient, border, border-radius, grid layout.
  - `.setup-banner--collapsed` — single-line green ribbon variant.
  - `.setup-banner__icon`, `.setup-banner__title`, `.setup-banner__subtitle`, `.setup-banner__progress`, `.setup-banner__bar`, `.setup-banner__fill`, `.setup-banner__pct`.

- [x] 6.2 Add CSS for the foundation chain:
  - `.foundation-chain` — 5-column grid.
  - `.foundation-chain__link` — arrow connector, centered, muted.

- [x] 6.3 Add CSS for operation cards:
  - `.op-card` — base card: surface bg, border, border-radius 10px, flex-column, gap.
  - `.op-card[data-state="done"]` — green-tinted border.
  - `.op-card[data-state="done-imported"]` — green-tinted border (same as done).
  - `.op-card[data-state="running"]` — teal border + glow.
  - `.op-card[data-state="next"]` — violet border + glow.
  - `.op-card[data-state="locked"]` — dimmed opacity, bg-2 background.
  - `.op-card__step` — numbered circle, state-colored.
  - `.op-card__title`, `.op-card__cmd`, `.op-card__desc`, `.op-card__meta`, `.op-card__footer`.
  - `.op-card__imported-badge` — blue pill with download icon.

- [x] 6.4 Add CSS for the maintenance grid:
  - `.maintenance-grid` — 2-column grid, 12px gap.

- [x] 6.5 Add CSS for section headers:
  - `.group-header` — flex row with title, subtitle, and badge.
  - `.group-header__badge` — mono font, pill background, completion count.

## 7. Refactor Project.tsx to use new components

- [x] 7.1 Remove the `PREREQ_DEFS` array (lines 24–30).
- [x] 7.2 Remove the `workflowOutdated` check and the `project__regen-cta` banner block (lines 66–142).
- [x] 7.3 Remove the "Vertical operations" section title and the flat `project__prereq-panel` rendering (lines 144–223).
- [x] 7.4 Import `SetupBanner`, `FoundationChain`, `MaintenanceGrid` from the new files.
- [x] 7.5 Render the new components in order below the metric grid:
  ```tsx
  <SetupBanner prereqs={prereqs} running={running} onRunNext={handleRunPrereq} />
  <FoundationChain prereqs={prereqs} running={running} onRun={handleRunPrereq} />
  <MaintenanceGrid prereqs={prereqs} running={running} onRun={handleRunPrereq} />
  ```
- [x] 7.6 Keep the existing `handleRunPrereq`, `useEffect` for fetching prereqs, and `running` state management unchanged.

## 8. Remove superseded CSS

- [x] 8.1 Remove from `Project.css`:
  - `.project__prereq-panel` (line 141–143)
  - `.project__prereq-row` and all its state variants (lines 145–217)
  - `.project__prereq-icon` and state color overrides (lines 158–192)
  - `.project__prereq-main`, `.project__prereq-title-row`, `.project__prereq-cmd`, `.project__prereq-state`, `.project__prereq-desc`, `.project__prereq-meta`, `.project__prereq-action` (lines 194–234)
  - `.project__regen-cta` and `.project__regen-msg` (lines 288–304)
- [x] 8.2 Keep `.project__btn` and its variants — they're reused by the new components.

## 9. Tests

- [x] 9.1 Create `ui/src/components/Project/setup-utils.test.ts`:
  - `deriveVisualState` returns `'running'` when `isRunning` is true.
  - Returns `'done'` when state is done and lastRun is non-null.
  - Returns `'done-imported'` when state is done and lastRun is null.
  - Returns `'stale'` when state is stale.
  - Returns `'locked'` when deps are not met.
  - Returns `'next'` when deps are met and state is missing.
  - `deriveFoundationStates` returns exactly one `'next'` card (the first incomplete).
  - `deriveFoundationStates` marks all cards after the first incomplete as `'locked'`.
  - `deriveFoundationStates` returns all `'done'` when everything is done.
  - `deriveMaintenanceStates` derives states independently (both can be `'next'` simultaneously if their deps are met).

- [x] 9.2 Create `ui/src/components/Project/SetupBanner.test.tsx`:
  - Renders expanded state when not all foundation ops are done.
  - Shows correct progress count (e.g. "2 of 3 done").
  - CTA button label includes the next step's command.
  - Clicking CTA calls `onRunNext` with the correct command.
  - Renders collapsed ribbon when all 3 foundation ops are done.

- [x] 9.3 Create `ui/src/components/Project/OperationCard.test.tsx`:
  - Renders step number for foundation variant.
  - Renders icon for maintenance variant.
  - Shows "imported from disk" badge when `visualState` is `'done-imported'`.
  - Shows "Re-run" button for done state.
  - Shows "Run now" button for next state.
  - Shows "Requires: …" lock text for locked state.
  - Shows disabled "Running…" for running state.

## 10. Build and validate

- [x] 10.1 `npm run build -w protocol -w ui` — all workspaces compile.
- [x] 10.2 `npm run typecheck` — no type errors.
- [x] 10.3 `npm test -w ui` — all tests pass including new setup-utils, SetupBanner, and OperationCard tests.
- [x] 10.4 Manual: start dev server (`npm run dev -w server` + `npm run dev -w ui`), attach a repo, and confirm:
  - Setup banner appears with correct progress for incomplete repos.
  - Foundation chain shows 3 cards with correct visual states and arrow connectors.
  - Maintenance grid shows 2 cards below the chain.
  - Clicking "Run now" on the next card triggers the prereq run, card transitions to running state.
  - After run completes, card transitions to done and the next card becomes next.
  - When all 3 foundation ops are done, banner collapses to green ribbon.
  - For a repo where analyse was already run from terminal, the analyse card shows "imported from disk" badge.
  - "Start feature" in sidebar unlocks when all 3 foundation ops are done.
