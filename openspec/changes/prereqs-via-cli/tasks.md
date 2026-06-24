## 1. Protocol: bootstrap status + run error message

- [x] 1.1 In `protocol/src/types.ts`, add `export type BootstrapStatus = 'ready' | 'installing' | 'cli-missing' | 'install-failed'`. Add `errorMessage?: string` to the `Run` interface. Add `export interface BootstrapStatusResponse { state: BootstrapStatus; message?: string }`. Re-export from `protocol/src/index.ts`.
- [x] 1.2 Run `npm run build -w protocol` and confirm the dist file exports the new symbols.

## 2. Server: DB migration

- [x] 2.1 In `server/src/db.ts`, add an additive migration that runs once at boot to `ALTER TABLE runs ADD COLUMN error_message TEXT NULL` if the column is not already present. Use `PRAGMA table_info(runs)` to detect.
- [x] 2.2 Update `mapRunRow()` in `server/src/run/serialize.ts` to include `errorMessage: row.error_message ?? null`. Verify both `GET /runs` and `GET /runs/:id` round-trip the field.
- [x] 2.3 Add a unit test in `server/src/__tests__/` asserting the migration is idempotent (run twice, no error, column present once).

## 3. Server: bootstrap module

- [x] 3.1 Create `server/src/bootstrap/state.ts` exporting `getBootstrapStatus(): BootstrapStatusResponse` and `runBootstrap(): Promise<void>`. Internal state is module-scoped and protected by a mutex so concurrent calls are a no-op. The mutable state is `{ state, message }`.
- [x] 3.2 Create `server/src/bootstrap/plugin-check.ts` exporting `isClaudboardInstalled(): boolean` (checks for `~/.claude/plugins/marketplaces/claudboard/skills/claudboard-analyse/SKILL.md`) and `isClaudeCliPresent(): boolean` (spawns `claude --version` with a 5s timeout, returns true on exit 0).
- [x] 3.3 Create `server/src/bootstrap/installer.ts` exporting `installClaudboard(): Promise<{ ok: boolean; stderr?: string }>`. Spawns `claude plugin install claudboard@claudboard`. 5-minute hard timeout. Captures last 2 KB of stderr on failure.
- [x] 3.4 `runBootstrap()` orchestrates: (a) if !cli → `cli-missing`, return; (b) if plugin present → `ready`, return; (c) state = `installing`; (d) `installClaudboard()` → on success state = `ready`, on failure state = `install-failed` with truncated stderr.
- [x] 3.5 Create `server/src/bootstrap/routes.ts` with `GET /bootstrap/status` (returns current state) and `POST /bootstrap/retry` (calls `runBootstrap()` only if state is `install-failed`; returns 409 otherwise).
- [x] 3.6 In `server/src/app.ts`, register the bootstrap router with `app.use('/api', bootstrapRouter)`.
- [x] 3.7 In `server/src/bin.ts` (or wherever the server is started), call `runBootstrap()` after Claude Code preconditions pass and before `server.listen()` returns control. Do not await — let it run in the background so the server is responsive immediately.
- [x] 3.8 Tests in `server/src/bootstrap/__tests__/`: state machine transitions, idempotency on repeated `runBootstrap()` calls, 503 helper behavior, retry endpoint accepts only from `install-failed` state.

## 4. Server: 503 gating on bootstrap-dependent endpoints

- [x] 4.1 Create a tiny `bootstrapGuard` middleware that, when state is not `ready`, responds 503 with `{ error: state-specific message, bootstrapState: <state> }`. The message comes from a fixed map (`installing` → "bosch-sdlc is still setting up. Please wait a few seconds and try again.", etc.).
- [x] 4.2 Apply the middleware to `POST /api/prereqs/:cmd` and `POST /api/runs`. Do NOT apply to any GET endpoint or to the bootstrap endpoints themselves.
- [x] 4.3 Integration test: with state forced to `installing`, POST `/api/prereqs/analyse` returns 503 with the expected payload; GET `/api/projects` returns 200; bootstrap endpoints return 200.

## 5. Server: CLI runner for prereqs

- [x] 5.1 Create `server/src/prereq/cli-runner.ts` exporting `runPrereqViaCli(runId, target, cmd): Promise<void>`. Implementation: spawn `claude` with args `['--print', '--output-format', 'stream-json', '--verbose', `/${cmd}`]`, `cwd: target`, env passthrough. Open the run's transcript file in append mode. For each newline-delimited chunk from stdout: parse JSON (skip malformed lines, log a warning), `appendFileSync` the raw line + `\n`, and `broadcast()` a `transcript-message` WsEvent with `payload: { message: <parsed> }`.
- [x] 5.2 On process exit: if code 0 → `UPDATE runs SET status='done', completed_at=datetime('now') WHERE id=?` and broadcast `status-change: done`; if code !== 0 → capture the last 2 KB of stderr, `UPDATE runs SET status='failed', completed_at=datetime('now'), error_message=? WHERE id=?` and broadcast `status-change: failed`. Handle `error` event on the child (e.g. ENOENT for `claude`) the same way as non-zero exit.
- [x] 5.3 Unit tests mocking `child_process.spawn` via `jest.unstable_mockModule`: (a) successful exit with three stream-json lines produces three appended transcript lines and three WS events; (b) non-zero exit captures stderr into `error_message`; (c) malformed JSON line is logged and skipped without crashing; (d) ENOENT on spawn is handled as failure.

## 6. Server: rewire prereq routes

- [x] 6.1 In `server/src/prereq/routes.ts`, replace the `runFeature(record.id, target, prompt)` call with `runPrereqViaCli(record.id, target, cmd)`. Remove the import of `buildPrereqPrompt` and `runFeature`. The dependency validator call (`validatePrereqDependencies`) stays unchanged.
- [x] 6.2 The `.then(async () => { ... detectPrereqs ... upsertPrereqs })` chain stays — `runPrereqViaCli` resolves on process exit so the chain runs whether success or failure. After detection, if the prereq's expected artifact still does not exist AND the run was marked `done`, downgrade the run to `failed` with `error_message = "Command exited 0 but expected artifact <path> was not written"`.
- [x] 6.3 In `server/src/run/prompt-builder.ts`, delete the `buildPrereqPrompt` function and its `cmdMap` constant. Update tests that import it.
- [x] 6.4 Integration test in `server/src/__tests__/`: POST `/api/prereqs/analyse` with a mocked `runPrereqViaCli` resolving successfully + a stubbed `detectPrereqs` returning `analyse: done` → response 201, run status flips to `done`, prereq state updates.

## 7. UI: bootstrap status hook and card

- [x] 7.1 In `ui/src/api/client.ts`, add `getBootstrapStatus: () => request<BootstrapStatusResponse>('/api/bootstrap/status')` and `retryBootstrap: () => request<BootstrapStatusResponse>('/api/bootstrap/retry', { method: 'POST' })`.
- [x] 7.2 Create `ui/src/hooks/useBootstrapStatus.ts`. On mount, fetch the status. While state is not `ready`, poll every 1500ms. Stop polling when state becomes `ready` or `cli-missing` (terminal states from the UI's perspective; `cli-missing` requires user action outside the app). Expose `{ status, retry }`.
- [x] 7.3 Create `ui/src/components/Dashboard/BootstrapCard.tsx`. Props: `status`, `onRetry`. Renders a small non-dismissible card at the top of the Dashboard with: spinner + "Setting up bosch-sdlc…" when `installing`; error message + "Retry" button when `install-failed`; install-Claude-Code link card when `cli-missing`. Returns `null` when `ready`.
- [x] 7.4 In `ui/src/components/Dashboard/Dashboard.tsx`, consume `useBootstrapStatus()` and render `<BootstrapCard>` at the top of the page content.
- [x] 7.5 In `ui/src/components/Project/Project.tsx`, also consume `useBootstrapStatus()` (or hoist it to App-level via context). Pass `disabled={status.state !== 'ready'}` (plus a tooltip) to the OperationCard's run/refresh buttons and the SetupBanner's "Run X" button.
- [x] 7.6 Unit tests for `useBootstrapStatus`: (a) seeds initial state from REST, (b) polls while not ready, (c) stops polling on `ready`, (d) `retry` calls the POST and updates state. Mock `fetch`.

## 8. Documentation and packaging

- [x] 8.1 Update `README.md` "Prerequisites" section: drop the bullet about "the feature-workflow skill must exist in each target repo"; rewrite the prereq bullet as "the claudboard plugin will be installed automatically on first boot." Keep the Claude Code requirement.
- [x] 8.2 Update `CHANGELOG.md` with a single entry describing the change in user-visible terms ("Prereq commands now actually run; the dashboard installs the claudboard plugin automatically on first launch.").
- [x] 8.3 No package.json or dist additions — `claude` is a runtime PATH dependency, not an npm dep.

## 9. Verification

- [x] 9.1 `npm run typecheck` clean across all workspaces. _(Protocol + server clean. UI has pre-existing failures in `ActiveRun/stream*` and `ReviewGate.test.tsx`, unrelated to this change.)_
- [x] 9.2 `npm run lint` clean. _(8 errors total, all pre-existing; this change introduces zero new lint issues.)_
- [x] 9.3 `npm test` clean — all new tests in sections 2, 3, 4, 5, 6, 7 pass. _(125 server tests + 109 UI tests = 234 total, all green.)_
- [ ] 9.4 **Manual smoke test on a clean machine state.** Remove `~/.claude/plugins/marketplaces/claudboard/` (back up first). Start `npx bosch-sdlc` from a fresh `~/.bosch-sdlc/` (delete the state dir to force first-boot). Observe: (a) Dashboard renders the BootstrapCard within a second of opening; (b) card transitions from "Setting up…" to disappearing within 60s; (c) any prereq POST attempted during install returns 503 and the OperationCard buttons are disabled; (d) once `ready`, register a repo with no `.claude/`, click Analyse on the SetupBanner — the OperationCard goes Running, after ~60-180s the report file appears in the target's `.claude/reports/`, the card flips to Done, the FoundationChain advances to "Generate next."
- [ ] 9.5 **Manual failure-mode test.** Force a plugin install failure (rename the marketplace temporarily so install can't reach it). Confirm: BootstrapCard shows `install-failed` with stderr text and a Retry button. Click Retry → it re-runs and (after restoring the marketplace) succeeds.
- [ ] 9.6 **Manual CLI-missing test.** Rename the `claude` binary on PATH (`mv $(which claude) /tmp/claude.bak`). Start `npx bosch-sdlc`. Confirm: BootstrapCard shows the cli-missing message with a link to claude.com/download. Restore `claude`, restart the server, confirm normal flow resumes.
- [ ] 9.7 **Regression check: Start Feature still works.** With bootstrap `ready` and a target repo whose `feature-workflow` skill is present and instrumented, click Start Feature → confirm SDK-based flow runs unchanged (phases stream, gates render, autonomy is respected). The CLI changes for prereqs must not have disturbed this path.
