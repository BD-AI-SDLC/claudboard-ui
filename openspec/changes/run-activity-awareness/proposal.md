## Why

The Project screen and the Active Run pipeline both behave as if every run is a feature-workflow run. When the user launches an `analyse` (or any other claudboard / prereq) run, the Project screen shows no indication that one is in flight, lets the user launch it again or kick off other tasks, and the Active Run pipeline pane renders all 7 hardcoded feature-workflow phases as "pending" — phases that will never fire for that run kind. Both surfaces ignore the `Run.kind` field that the server already exposes.

## What Changes

- Project screen polls `GET /api/runs?projectId=<id>` and derives whether any run for the current project is `status: 'running'`.
- When an active run exists for the project:
  - Show an inline banner at the top of the Project page reading `<kind> running — open run`, linking to the Active Run view for that run.
  - Disable `Start Feature` (TopBar), all FoundationChain prereq buttons, all MaintenanceGrid prereq buttons, and all ClaudboardLauncher buttons, with a shared tooltip `A run is in progress — only one at a time`.
  - When the run completes (status flips to `done` or `failed`), the banner disappears, buttons re-enable, and prereqs auto-refresh.
- The existing local `running: Record<string, boolean>` flag in `Project.tsx` is replaced by — or composed with — the server-derived activity state, so the claudboard launch path no longer needs to maintain its own flag (it currently maintains none).
- `ActiveRun.buildPipelineFromEvents` becomes kind-aware: the 7-phase `PHASE_TEMPLATE` is only seeded when `run.kind === 'feature'`. For `prereq` and `claudboard-*` runs the pipeline pane renders phases derived purely from `phase-start` events (today: none), with a one-line placeholder `CLI run · see stream →` when the phase list is empty.
- Hydration gating in `ActiveRun` (`hydrated` flag from `useRunStream`) continues to work — for non-feature runs, the empty-phases-with-placeholder state is the steady state, not a loading state.

Not in scope (deferred):

- Server-side enforcement that rejects a second concurrent run per project (scope C in explore). Today the server permits multiple; this change only adds a UI guard.
- WebSocket subscription on the Project page. Polling at ~2s matches the existing `RUN_POLL_INTERVAL_MS` cadence; a WS-driven update can come later.
- Changes to the `claudboard-*` skill source files or their prompts.

## Capabilities

### New Capabilities

<!-- None -->

### Modified Capabilities

- `web-ui`: Project screen gains an active-run banner and disables all run-launching actions while a run is in flight for the project; Active Run pipeline pane stops pre-seeding the 7 feature-workflow phases for non-feature runs.

## Impact

- `ui/src/components/Project/Project.tsx`: replace local `running` state with a derived view from `useActiveRuns(projectId)`; render banner; pipe `disabled` down to children.
- `ui/src/components/Project/FoundationChain.tsx`, `MaintenanceGrid.tsx`, `SetupBanner.tsx`: accept and honor a `disabled` prop (or treat `running={...all true}` as the disable signal).
- `ui/src/components/claudboard/ClaudboardLauncher.tsx`: accept a `disabled` prop and disable all skill buttons with the shared tooltip when set.
- `ui/src/components/primitives/TopBar.tsx`: `startFeatureDisabled` is already a prop; just feed it the combined `!fdnExists || hasActiveRun` value.
- `ui/src/hooks/useActiveRuns.ts` (new): polls `api.getRuns(projectId)`, exposes `{ activeRuns, hasActive, primary }`. Mirrors the cadence and lifecycle of the existing `pollTimers` logic in `Project.tsx`.
- `ui/src/components/ActiveRun/ActiveRun.tsx`: thread `run.kind` into `buildPipelineFromEvents`; conditional `PHASE_TEMPLATE` seeding; placeholder row when phase list is empty.
- `ui/src/components/ActiveRun/pipeline.test.ts`: extend with cases for `kind = 'prereq'` and `kind = 'claudboard-analyse'` asserting no phantom phases.
- No `protocol/` changes (`RunKind` already shipped via `claudboard-runner`).
- No `server/` changes (`GET /api/runs?projectId=` already returns kind + status).
- No database migrations.
