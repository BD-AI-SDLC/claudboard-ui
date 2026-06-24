## 1. UI hook: `useActiveRuns(projectId)`

- [x] 1.1 Create `ui/src/hooks/useActiveRuns.ts` exporting `useActiveRuns(projectId: string): { activeRuns: Run[]; hasActive: boolean; primary: Run | null }`. The hook fetches `api.getRuns(projectId)` on mount and on a 2-second interval, filters to `status === 'running'`, sets `primary` to the most recently created (`createdAt` desc), and exposes them in state.
- [x] 1.2 Gate the polling interval on `document.visibilityState !== 'hidden'`: subscribe to the `visibilitychange` event; pause the interval when hidden and resume on the next cadence tick when visible. The mount fetch fires regardless of visibility (to populate initial state if the tab is restored from a backgrounded state).
- [x] 1.3 Add a unit test under `ui/src/hooks/__tests__/useActiveRuns.test.ts` using vitest fake timers + a mocked `api.getRuns` covering: (a) no runs → `hasActive === false`, `primary === null`; (b) one running run → `hasActive === true`, `primary` is that run; (c) two running runs with different `createdAt` → `primary` is the newer one; (d) interval pauses while `document.visibilityState === 'hidden'` and resumes on visibility return; (e) cleanup clears the interval and the visibility listener on unmount.

## 2. UI: kind-label helper

- [x] 2.1 Add `ui/src/util/runKindLabel.ts` exporting `runKindLabel(kind: RunKind | undefined): string` mapping: `feature → "Feature workflow"`, `prereq → "Prerequisite setup"`, `claudboard-analyse → "Claudboard analyse"`, `claudboard-generate → "Claudboard generate"`, `claudboard-workflow → "Claudboard workflow"`, `claudboard-refresh → "Claudboard refresh"`, `claudboard-techdebt → "Claudboard techdebt"`, default → `"Run in progress"` (also covers `undefined`).
- [x] 2.2 Add a unit test under `ui/src/util/__tests__/runKindLabel.test.ts` covering every defined kind plus the default fallback for `undefined` and an unknown string.

## 3. UI: Project screen banner + disable plumbing

- [x] 3.1 In `ui/src/components/Project/Project.tsx`, replace the import-and-poll pattern in `handleRunPrereq` with consumption of `useActiveRuns(projectId)`. Keep the existing `pollTimers`/`running` state for the prereq run's own polling-to-completion behavior (it still drives `setActiveRun` for the inline PrereqInterview), but compute `hasActive` and `primary` from the hook and use those values for banner + disable decisions.
- [x] 3.2 Render a new banner element directly above the `project__metric-grid` div: a clickable element with class `project__active-run-banner` containing the text `${runKindLabel(primary.kind)} running — open run`. The element calls `onRunCreated(primary.id)` on click (this is the same handler the screen already uses to navigate to ActiveRun). Banner only renders when `hasActive && primary && onRunCreated`.
- [x] 3.3 Add CSS for `.project__active-run-banner` in `ui/src/components/Project/Project.css`: matches the existing banner visual language (uses `--surface`, `--border`, accent text colour), full width of the page body, cursor pointer, hover state, keyboard accessible (tabindex=0 and Enter/Space key handler).
- [x] 3.4 When `hasActive` is true, construct `forcedDisabledRunning = Object.fromEntries(allPrereqIds.map(id => [id, true]))` (where `allPrereqIds` is the union of foundation + maintenance prereq ids, defined as a constant). Pass `forcedDisabledRunning` instead of the local `running` state to `<SetupBanner>`, `<FoundationChain>`, and `<MaintenanceGrid>` while `hasActive` is true. When `hasActive` is false, pass the existing `running` state.
- [x] 3.5 Compute `topBarStartFeatureDisabled = !fdnExists || hasActive` and pass that to `<TopBar startFeatureDisabled=...>` in place of the current `!fdnExists`.
- [x] 3.6 Pass a new `disabled={hasActive}` prop to `<ClaudboardLauncher>`.
- [x] 3.7 Suppress the modal-open paths (`setPrereqModal(cmd)` in `handleRunPrereq` and direct modal opens in `ClaudboardLauncher`) while `hasActive` is true. Since the buttons are disabled, this is defense-in-depth — guard at the handler entry: if `hasActive`, return immediately.
- [x] 3.8 When `hasActive` flips from true to false (detect via `useEffect` deps on `hasActive`), re-fetch `api.getRepoPrereqs(projectId)` and `setPrereqs(updated ?? {})` so the page reflects any state produced by the completed run.

## 4. UI: tooltip and disabled styling

- [x] 4.1 Add a constant `RUN_IN_PROGRESS_TOOLTIP = 'A run is in progress — only one at a time'` exported from `ui/src/components/Project/Project.tsx` (or a small `ui/src/util/runActivityCopy.ts` if other screens need it later).
- [x] 4.2 In `FoundationChain.tsx`, `MaintenanceGrid.tsx`, and `SetupBanner.tsx`, when a button is disabled because the corresponding `running[id]` is true, set `title={runningTooltip}` (a new optional prop) on the button so the disabled state has hover text. Default the prop value to the existing per-button copy ("running…") so existing call sites are unchanged.
- [x] 4.3 In `ClaudboardLauncher.tsx`, add a `disabled?: boolean` prop. When `disabled` is true, set every button's `disabled` attribute to true and `title` to `RUN_IN_PROGRESS_TOOLTIP`. The existing `installed === false` disable path keeps its own tooltip text.
- [x] 4.4 In `Project.tsx`, when constructing `forcedDisabledRunning` (task 3.4), also pass `runningTooltip={RUN_IN_PROGRESS_TOOLTIP}` to the three grid/chain/banner components so the disabled buttons surface the right hover text.

## 5. UI: Project test coverage

- [x] 5.1 In `ui/src/components/Project/Project.test.tsx`, add a test "renders active-run banner when a run is in flight": mocks `api.getRuns` to return one `status: 'running'` `claudboard-analyse` run, mounts `<Project projectId="p1" onRunCreated={spy} ... />`, advances fake timers past the polling interval, asserts the banner text contains `Claudboard analyse running — open run`, and that clicking the banner invokes `spy` with the run id.
- [x] 5.2 Add a test "disables all launch buttons when a run is in flight": same setup as 5.1; after the banner appears asserts `getByRole('button', { name: /Start Feature/i })`, every prereq button rendered by FoundationChain/MaintenanceGrid, and every ClaudboardLauncher skill button has the `disabled` attribute and the tooltip matches `RUN_IN_PROGRESS_TOOLTIP`.
- [x] 5.3 Add a test "banner clears and prereqs refetch when run completes": mock `api.getRuns` to return `running` on first call and `done` on second; mock `api.getRepoPrereqs` and assert it is called again after the status flip; assert the banner is removed and buttons re-enable.
- [x] 5.4 Add a test "no banner when no active runs": mock `api.getRuns` to return `[]`; assert banner is absent and buttons render in their normal enabled/disabled state per existing logic.

## 6. UI: ActiveRun pipeline kind-awareness

- [x] 6.1 In `ui/src/components/ActiveRun/ActiveRun.tsx`, change the signature of `buildPipelineFromEvents` from `(events: WsEvent[]): PhaseState[]` to `(events: WsEvent[], runKind: RunKind | undefined): PhaseState[]`. Import `RunKind` from `@bosch-sdlc/protocol`.
- [x] 6.2 Inside `buildPipelineFromEvents`, wrap the existing `for (const t of PHASE_TEMPLATE)` seed block in a conditional: `if (runKind === undefined || runKind === 'feature')`. Leave the rest of the function untouched — the per-event processing already handles phases that arrive from `phase-start` even when the map starts empty.
- [x] 6.3 Update the call site (`const phases = buildPipelineFromEvents(events)` at the end of the component body) to `const phases = buildPipelineFromEvents(events, run?.kind)`.
- [x] 6.4 In the Pipeline pane render block, when `phases.length === 0` and `run?.kind` is defined and not `'feature'`, render a single placeholder row with class `active-run__phase active-run__phase--placeholder` and text `CLI run · see stream →`. The row is non-interactive (no onClick, no tabindex).
- [x] 6.5 Add CSS for `.active-run__phase--placeholder` in `ui/src/components/ActiveRun/ActiveRun.css`: muted foreground colour, italic, full width, matches the visual height of a normal phase row. No hover state.

## 7. UI: ActiveRun pipeline test coverage

- [x] 7.1 In `ui/src/components/ActiveRun/pipeline.test.ts`, update all existing test calls of `buildPipelineFromEvents(events)` to pass `'feature'` as the second argument so existing assertions continue to hold.
- [x] 7.2 Add a test "claudboard-analyse run produces no phantom phases": calls `buildPipelineFromEvents([], 'claudboard-analyse')` and asserts the result has length 0.
- [x] 7.3 Add a test "prereq run produces only emitted phases": builds an event array with a single `phase-start { num: 1, title: 'Install Skill' }` and a `phase-complete { num: 1 }`, calls `buildPipelineFromEvents(events, 'prereq')`, asserts result has length 1 with `num: 1`, `title: 'Install Skill'`, `status: 'done'`, and that none of the `PHASE_TEMPLATE` titles appear in the result.
- [x] 7.4 Add a test "undefined kind preserves feature template (hydration window)": calls `buildPipelineFromEvents([], undefined)` and asserts the result matches the 7-entry `PHASE_TEMPLATE`.
- [x] 7.5 Add a component-level test or assertion (extending an existing `ActiveRun` test or adding `ActiveRun.test.tsx` if absent) that mounts `<ActiveRun runId="r1" />` with `api.getRun` mocked to return `{ kind: 'claudboard-analyse', status: 'running', ... }` and `useRunStream` mocked to return `{ events: [], hydrated: true }`, asserts the Pipeline pane DOM contains the literal `CLI run · see stream →` and does not contain any of the 7 `PHASE_TEMPLATE` titles.

## 8. Verification

- [x] 8.1 Run `npm run typecheck` from the repo root; confirm clean.
- [x] 8.2 Run `npm run lint` from the repo root; confirm clean. Pay attention to `ui/scripts/check-css-prefixes.js` for any new class names added in 3.3 and 6.5.
- [x] 8.3 Run `npm run test` from the repo root; confirm all suites (protocol, server, ui) pass with the new tests included.
- [ ] 8.4 Manual smoke test 1 (Project banner + disable): start the dev stack, attach a repo with `fdnExists` true, click Analyse from `ClaudboardLauncher`. Confirm: banner appears with `Claudboard analyse running — open run`, every launch button on the page is disabled with the shared tooltip, clicking the banner navigates to the Active Run view, the banner disappears within ~2s of run completion, prereqs refresh.
- [ ] 8.5 Manual smoke test 2 (ActiveRun pipeline): from the run started in 8.4, confirm the Pipeline pane shows the `CLI run · see stream →` placeholder and none of the 7 feature-workflow phase titles. Then start a feature run via Kickoff and confirm the Pipeline pane still shows the 7-phase template and phases light up as `phase-start` events arrive.
- [ ] 8.6 Manual smoke test 3 (navigation persistence): with an analyse run still running, navigate from Project to Dashboard and back to Project; within ~2s the banner reappears and the buttons re-disable without the run being relaunched.
