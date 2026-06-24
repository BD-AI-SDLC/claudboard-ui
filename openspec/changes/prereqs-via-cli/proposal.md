## Why

The prereq command flow (`/analyse`, `/generate`, `/claudboard-workflow`, `/refresh`, `/techdebt`) is wired end-to-end in the UI and server but does not actually execute. The Project screen's OperationCards POST `/api/prereqs/:cmd`, which calls `runFeature()` with a prompt built by `buildPrereqPrompt(cmd)` — and that prompt is the literal slash command, e.g. `"/analyse"`. The Anthropic Agent SDK's `query()` does not preprocess slash commands the way the Claude Code CLI does; the LLM receives the bare string `/analyse` and either ignores it or improvises. The run "completes" silently, no report file is written, `detectPrereqs()` re-checks the filesystem and reverts the state to `missing`, and the user sees the spinner stop with no visible failure. The same prompt-builder file at `server/src/run/prompt-builder.ts:4-6` explicitly comments that slash prefixes are unsafe for the SDK, then violates that warning three lines below.

The product intent is "land and press analyse": a user new to the toolchain installs the package, opens the dashboard, registers a repo, clicks a button, and the work runs. No terminal steps. No mental model of skills, plugins, or Agent SDK semantics. The Claude Code CLI is an acceptable runtime dependency — users already have a Claude API key, and the CLI does the slash-command preprocessing and user-scope plugin loading we need.

This change replaces the SDK-based prereq execution path with a `claude` CLI subprocess and adds a silent first-boot plugin install so a fresh machine reaches "ready" without user intervention. The Start Feature path is unchanged — it already works end-to-end via the SDK with `mcp__bosch__*` instrumentation in `feature-workflow`, and there is no asymmetry to fix there.

## What Changes

- **Server: replace SDK invocation for prereqs with a `claude` CLI subprocess.**
  - Add `server/src/prereq/cli-runner.ts` exporting `runPrereqViaCli(runId, target, cmd)`. It spawns `claude --print --output-format stream-json --verbose /<cmd>` with `cwd = target`, streams stdout line-by-line, parses each JSON line, persists it to the run's transcript JSONL, and broadcasts it as a `transcript-message` WebSocket event.
  - Update `POST /api/prereqs/:cmd` in `server/src/prereq/routes.ts` to call `runPrereqViaCli()` instead of `runFeature()`. On successful exit (code 0), re-run `detectPrereqs(target)` and `upsertPrereqs()` exactly as today. On non-zero exit, set `runs.status='failed'`, persist a truncated stderr tail in `runs.error_message`, and broadcast `status-change: failed`.
  - Delete `buildPrereqPrompt` from `server/src/run/prompt-builder.ts`. The CLI receives the literal slash command as an argv element, never as a prompt string.
- **Server: silent claudboard plugin bootstrapper.**
  - On server boot, after the existing Claude Code precondition check, check whether `~/.claude/plugins/marketplaces/claudboard/skills/claudboard-analyse/SKILL.md` exists. If yes → bootstrap state is `ready`. If no → spawn `claude plugin install claudboard@claudboard` in the background, transition bootstrap state to `installing`, and to `ready` on success or `install-failed` on non-zero exit.
  - Add `GET /api/bootstrap/status` returning `{ state, message? }`. `POST /api/bootstrap/retry` re-runs the install when state is `install-failed`.
  - `POST /api/prereqs/:cmd` and `POST /api/runs` SHALL return 503 with the current bootstrap message while state is `installing` or `install-failed`.
- **Protocol: add `BootstrapStatus` type and `RunPrereqResponse.error_message` field.**
- **UI: first-boot bootstrap card on Dashboard.**
  - Poll `GET /api/bootstrap/status` on app mount; if not `ready`, render a small non-dismissible "Setting up bosch-sdlc…" card at the top of the Dashboard with a progress spinner. Poll every 1.5s until `ready`.
  - On `install-failed`, the card shows the error message and a "Retry" button calling `POST /api/bootstrap/retry`.
  - The prereq OperationCards disable their action buttons while bootstrap is not `ready`; tooltip explains why.
- **No change to:** feature-workflow execution (Start Feature), gate handling, autonomy flow, transcript format, the existing event-log/WS-replay machinery, the prereq dependency validator in `server/src/prereq/validators.ts`, or the prereq detection logic in `server/src/registry/prereqs.ts`.

## Capabilities

### Modified Capabilities

- **prereq-runner** — the runtime mechanism for prereq execution changes from "Agent SDK with the slash command as the prompt" to "claude CLI subprocess with the slash command as argv". Behavioral guarantees (run record creation, dependency validation, completion detection, output-path surfacing, WS streaming) are preserved.

### Added Capabilities

- **packaging** gains a "silent claudboard plugin install on first boot" requirement and a "bootstrap status endpoint" requirement.

## Impact

- **Protocol (`protocol/src/`):**
  - New type `BootstrapStatus = 'ready' | 'installing' | 'cli-missing' | 'install-failed'`.
  - `Run` type gains optional `errorMessage?: string` (mapped from new SQLite column `error_message`).
- **Server (`server/src/`):**
  - New `prereq/cli-runner.ts` (subprocess spawn, stream-json parser, event broadcast).
  - New `bootstrap/` module: state machine, plugin install, REST endpoints.
  - `prereq/routes.ts` rewired to call the new runner; the existing dependency validator stays.
  - `run/prompt-builder.ts` loses `buildPrereqPrompt` (only `buildPrompt` for the feature flow remains).
  - `db.ts` migration: `runs.error_message TEXT NULL`.
  - `app.ts` registers the new bootstrap router and calls the bootstrap kickoff after Claude Code precondition checks.
  - Tests: new `cli-runner.test.ts` (mocks `child_process.spawn`), new bootstrap state machine tests, updated `integration.test.ts` to assert the new 503 behavior during bootstrap.
- **UI (`ui/src/`):**
  - `api/client.ts`: `getBootstrapStatus()`, `retryBootstrap()`.
  - New `hooks/useBootstrapStatus.ts` polling hook.
  - `components/Dashboard/Dashboard.tsx`: render the bootstrap card while not `ready`.
  - `components/Project/OperationCard.tsx`: receive a `disabled` prop tied to bootstrap state.
- **Spec change:** `openspec/specs/prereq-runner/spec.md` requirement "Drive claudboard prereqs through the same SDK runner" is removed and replaced; the other two requirements (state refresh + output surfacing) are preserved verbatim.
- **No breaking changes for end users.** The API surface of `POST /api/prereqs/:cmd` is unchanged from the UI's perspective. Direct API consumers that previously assumed an SDK-based execution path were already broken (no prereq ever actually ran); the new behavior is the first time it works.
- **New runtime dependency contract:** the `claude` CLI binary must be on PATH. This was already documented in `README.md` and enforced by the existing Claude Code precondition check in `packaging`; this change leans on that check and adds the plugin install on top.
- **Out of scope, called out as follow-up:** typed `mcp__bosch__prereq_*` progress events. The current path gives start/done plus raw `transcript-message` events — enough for "land and press" UX but not for the phase-pill experience that Start Feature has. A future change can graduate to embedded prompts with instrumentation (Option E in the design discussion) when prereq UX needs to match feature UX.
