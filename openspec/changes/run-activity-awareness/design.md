## Context

Two surfaces in the UI assume every run is a feature-workflow run:

1. **Project screen** (`ui/src/components/Project/Project.tsx`) tracks `running: Record<string, boolean>` as component-local state, set true only when `handleRunPrereq` calls `api.runPrereq()` and polls until completion. The claudboard launch path (`handleClaudboardPrereq`) and the `ClaudboardLauncher` component both submit a run and navigate away without ever raising the flag. Even when the flag is set, it is wiped on component unmount, so navigating to Active Run and back resets all knowledge of in-flight work. The server already knows the truth — `Run.kind` was added by `claudboard-runner` (now `'feature' | 'prereq' | 'claudboard-${ClaudboardSkill}'`), and `GET /api/runs?projectId=` returns every run for the project with its `status` and `kind` — but nothing on the Project page subscribes to it.

2. **Active Run pipeline pane** (`ui/src/components/ActiveRun/ActiveRun.tsx`) seeds a 7-entry `PHASE_TEMPLATE` (Ticket · Clarify · Specify · Plan, Create Branch, …, Finalize JIRA) into `buildPipelineFromEvents` unconditionally. For a claudboard or prereq run that never emits `phase-start`, all 7 phases sit visible as `status: 'pending'` forever. The recently-shipped `fix-active-run-ux-bugs` change codified this empty template as the "loading" state in task 5.1, before the `RunKind` distinction existed.

The user's stated desired behavior: while analyse (or any other run) is in flight, the Project page should make it obvious and prevent launching anything else; the Active Run pane should not display SDLC phases that have nothing to do with the run.

## Goals / Non-Goals

**Goals:**

- Project page reflects in-flight runs derived from server state, not component-local flags.
- Single soft UI guard preventing the user from launching a second run for the same project while one is in flight. The guard applies to: `Start Feature`, all prereq buttons (Foundation + Maintenance), all Claudboard skill buttons.
- A clear path back to the in-flight run from the Project page (the banner is a link).
- Active Run pipeline pane is honest about what the run will produce — the 7-phase template appears only for `feature` runs.

**Non-Goals:**

- Server-side enforcement of "one run per project at a time" — out of scope (see Risks).
- WebSocket-driven activity state on the Project page — polling is enough at this stage.
- Distinguishing concurrent runs across *different* projects — each project page is responsible for its own polling; a global run banner is a separate concern.
- Touching the claudboard skill source files or their prompts.
- Changing the run-lifecycle spec or any server module.

## Decisions

### Polling over WebSocket subscription on the Project page

A new hook `useActiveRuns(projectId)` polls `api.getRuns(projectId)` every 2 seconds (matching `RUN_POLL_INTERVAL_MS` already used in `Project.tsx`) and derives `{ activeRuns, hasActive, primary }`.

**Why over WebSocket subscription:** the Project page does not need streaming events, only the status flip. The server already has `status-change` events but they are per-run; subscribing the Project page to all runs would require new WS plumbing (project-room broadcast). Polling at 2s is identical to what `handleRunPrereq` already does today and costs ~3 small HTTP requests per active project view.

**Why a new hook instead of inlining:** the current `pollTimers` logic in `Project.tsx` is per-prereq-cmd, tied to the launch flow. The new derivation must work on Project screen mount regardless of whether the user launched the run from this tab — extracting it to a hook isolates the cadence and lifecycle.

### Disable signal: derived `running` map, not a new `disabled` prop everywhere

`FoundationChain`, `MaintenanceGrid`, and `SetupBanner` already accept `running: Record<string, boolean>`. When `hasActive` is true, `Project.tsx` constructs a "force-all-disabled" map by setting every known prereq id to `true`. `ClaudboardLauncher` is the one component that does not take a `running` prop today; it gains a `disabled` prop for parity.

**Why over plumbing a new `disabled` prop through every child:** minimises diff to grid/chain/banner components, preserves their existing semantics (a `true` in the map already means "in-flight, don't let me click"), and keeps the disable-tooltip surface co-located with the button.

**Alternative considered:** add a `disabled` prop everywhere. Rejected: doubles the prop surface for one transient state, and the existing `running={true}` already disables — repurposing it is the lighter touch.

### Banner text and placement

Banner renders at the top of the Project page body (above the metric grid and below `TopBar`), reading `<kind label> running — open run` where `<kind label>` maps `RunKind` to user-facing text:

- `feature` → `Feature workflow`
- `prereq` → `Prerequisite setup`
- `claudboard-analyse` → `Claudboard analyse`
- `claudboard-generate` → `Claudboard generate`
- `claudboard-workflow` → `Claudboard workflow`
- `claudboard-refresh` → `Claudboard refresh`
- `claudboard-techdebt` → `Claudboard techdebt`

The whole banner is a click target navigating to the Active Run view (`onRunCreated(runId)` already wires this path — App.tsx routes to ActiveRun on run id).

**Why one banner, not per-cmd in-place spinners:** the user's complaint is "I can't see it's running and I can launch more." One unmissable banner solves both, and is simpler than restoring per-button spinner states across two launch paths.

### Tooltip text on disabled buttons

`A run is in progress — only one at a time` on every disabled action button. Applied uniformly so the user gets the same message regardless of which button they hover.

**Why the same string everywhere:** consistency. The reason is the same in every case.

### Kind-aware pipeline template in `buildPipelineFromEvents`

Function signature changes to `buildPipelineFromEvents(events: WsEvent[], runKind: RunKind | undefined): PhaseState[]`. When `runKind === 'feature'` (or undefined, for resilience) it seeds `PHASE_TEMPLATE` as today. Otherwise it skips the seed and produces phases purely from `phase-start` events in the stream.

When `runKind` is known to be non-feature and the resulting phase list is empty, the pipeline pane renders a single placeholder row: `CLI run · see stream →`. The placeholder is a passive label, not a clickable element — the stream pane is already adjacent on the right.

**Why a placeholder row instead of collapsing the pane:** the three-pane split (Pipeline / Stream / Telemetry) is a stable layout. Collapsing the pane mid-run would reshuffle the layout. A one-line placeholder keeps the visual rhythm and tells the user the pane intentionally has nothing to show.

**Resilience note:** the `runKind === undefined` case (run record not yet fetched) falls through the same path as `feature` to avoid a flash of the empty placeholder for genuine feature runs during hydration. The unconditional seed for unknown kinds matches the current behavior, so the change is strictly opt-in for non-feature runs.

### Updating tests

`pipeline.test.ts` extends with cases for `kind = 'prereq'` and `kind = 'claudboard-analyse'` asserting an empty phase list (or whatever is produced by the events the test sets up). Existing `kind = 'feature'` cases keep passing because the signature default preserves current behavior.

`Project.test.tsx` extends with cases that mount the component with a mocked `getRuns` returning a `running` claudboard run and asserts: banner renders, Start Feature is disabled, prereq buttons are disabled, claudboard buttons are disabled.

## Risks / Trade-offs

- **[Risk] Polling cadence misses fast runs.** A prereq run that completes in <2 s could appear-then-disappear before the user notices the banner. → Mitigation: the banner is reactive, so a missed polling cycle just means no banner ever shown for that ultra-fast run — acceptable. The disable guard during the run window still functions for any run lasting longer than one polling cycle.

- **[Risk] Polling continues while the Project page is open in a background tab.** ~30 requests/minute per open Project tab. → Mitigation: gated by `document.visibilityState` in the hook (pause polling when hidden) — small addition with clear benefit. Or accept the cost; bosch-sdlc is a local dev dashboard, not a multi-tenant SaaS.

- **[Risk] No server-side enforcement means a determined user could open two browser windows and bypass the guard.** → Mitigation: the desired behavior is "soft guard," documented as scope B in the explore session. Server enforcement (scope C) is a separate proposal if the team decides race conditions in concurrent runs warrant it.

- **[Risk] `Run.kind` for a non-feature run might be undefined briefly if `api.getRun(runId)` has not resolved before `buildPipelineFromEvents` runs.** → Mitigation: undefined falls through to the feature-template path (existing behavior), so the user sees the placeholder template until the run record arrives — same UX as today for feature runs.

- **[Trade-off] We are reusing `running: Record<string, boolean>` as the disable channel.** This conflates "this specific cmd is running" with "any run is running, disable everything." → Acceptable: every consumer of this prop today only reads it to decide button disabled state; semantic drift is small and isolated.

- **[Trade-off] The banner is a flat text link with no progress detail (no phase number, no elapsed time).** Adding telemetry would be useful but expands scope and pulls Project closer to ActiveRun. → Mitigation: the banner links to ActiveRun, which has all the telemetry; the user is one click away.

## Migration Plan

Pure UI change, no schema or API changes. Deploy alongside the rest of the UI build. Rollback is reverting the four edited files plus deleting the new hook + tests.

## Open Questions

- Should the disable guard also apply when an active run exists for *another* project the user is not currently viewing? (Today the user only sees the project they navigated to; a cross-project banner would need a global App-level state.) Out of scope for this change — flagged for future.
- Once `claudboard-techdebt` and `claudboard-refresh` ship via the runner (deferred tasks 9.1/9.2 in `claudboard-runner`), the kind label map needs the corresponding entries. The default fallback `"Run in progress"` covers unknown kinds.
