# Changelog

## Unreleased — interactive-prereqs-via-cli

### What Changed

- **Interactive prereqs (`/claudboard-workflow`) now run end-to-end from the dashboard.** The prereq CLI subprocess runs in bidirectional stream-json mode: when a skill calls `AskUserQuestion`, the question appears as an inline card below the Foundation section on the Project page. Selecting an option and pressing Submit routes the answer back to the running subprocess via `POST /api/runs/:id/cli-answer`, and the conversation continues until the skill finishes writing its artifact. Previously these commands exited code 0 without producing any file because `claude --print` cannot answer questions interactively.
- **Analyse and other non-interactive prereqs are unchanged** — they never emit AskUserQuestion, so the new pipe is silent for them.
- **Two unrelated bug fixes that landed alongside this change:**
  - `GET /api/projects/:id/prereqs` now returns a `Record<cmd, PrereqRecord>` (camelCase) instead of an array of raw DB rows. Previously every prereq looked "missing" to the UI even when the artifact existed, so the Foundation chain never advanced past Analyse.
  - `last_run` (and `duration_ms`) is now stamped on the prereq row when a UI-triggered run completes successfully, so the chip reads "done" instead of "done · imported" after the first dashboard run.

### Added

- `InteractiveQuestion`, `CliAnswerRequest`, and `WsEvent['interactive-question']` variant in `@bosch-sdlc/protocol`.
- `submitCliAnswer(runId, toolUseId, answers)` helper and per-run stdin/pending-question registry in `server/src/prereq/cli-runner.ts`.
- `POST /api/runs/:id/cli-answer` in `server/src/prereq/routes.ts` (not bootstrap-guarded — the run already exists).
- `ui/src/components/PrereqInterview/` — inline question-stream cards (Variant C from `ui/designs/Interview Designs.html`), rendered between FoundationChain and MaintenanceGrid when a prereq run is in flight.
- `markPrereqRan` helper in `server/src/registry/persist.ts`.

### Notes

- Per-run pending-question state is in-memory only. If the server restarts mid-question, the run orphans and the user must re-run the prereq. Persisted recovery is out of scope for this change.
- The "edit a submitted answer" affordance is visually present (matching the design) but disabled. Reissuing a `tool_result` for a completed `tool_use_id` is non-trivial in stream-json mode; a future change can model it as an interrupt + replay.

## Unreleased — prereqs-via-cli

### What Changed

- **Prereq commands now actually run.** Previously, clicking Analyse, Generate, /claudboard-workflow, /refresh, or /techdebt on the Project screen passed the literal slash command to the Agent SDK as a prompt. The SDK does not preprocess slash commands, so the LLM saw the bare string `/analyse` and silently did nothing. The server now spawns the locally-installed `claude` CLI as a subprocess (`claude --print --output-format stream-json --verbose /<cmd>`), which performs the slash-command resolution and produces the expected report files.
- **The claudboard plugin is now installed automatically on first boot.** If `~/.claude/plugins/marketplaces/claudboard/skills/claudboard-analyse/SKILL.md` is missing when the server starts, it spawns `claude plugin install claudboard@claudboard` in the background. The dashboard renders a small "Setting up bosch-sdlc…" card during the install and removes it on completion. No terminal interaction is required.
- **Silent-success protection.** If the CLI exits 0 but the expected report file was not written (catching the "command ran but did nothing useful" case), the run is downgraded to `failed` with an explicit `errorMessage` instead of being reported as successful.
- **Bootstrap state surfaces in the UI.** While bootstrap is not `ready`, the dashboard renders a status card and the prereq run/refresh buttons (plus the Setup banner action) are disabled with an explanatory tooltip. `POST /api/prereqs/:cmd` and `POST /api/runs` return 503 with a state-specific message in the same window; GET endpoints stay available.
- **New `GET /api/bootstrap/status` and `POST /api/bootstrap/retry` endpoints** let the UI observe and recover from install failures.

### Added

- `runs.error_message` column (additive migration, populated when `status='failed'`).
- `BootstrapStatus` and `BootstrapStatusResponse` types in `@bosch-sdlc/protocol`.
- `server/src/bootstrap/` module with state machine, plugin presence check, installer subprocess, REST routes, and an Express middleware (`bootstrapGuard`) that 503s mutating endpoints while not ready.
- `server/src/prereq/cli-runner.ts` — `runPrereqViaCli` spawns the CLI, streams stream-json output to transcript JSONL + WebSocket, and marks the run done/failed on exit.
- `ui/src/hooks/useBootstrapStatus.ts` and `ui/src/components/Dashboard/BootstrapCard.tsx`.

### Removed

- `buildPrereqPrompt` from `server/src/run/prompt-builder.ts` — prereqs no longer flow through the Agent SDK runFeature path, so a prompt body is never built for them.

### Notes

- Start Feature is unchanged: it continues to use the Agent SDK with `mcp__bosch__*` instrumentation in the target repo's `feature-workflow` skill.
- This change does not introduce typed `mcp__bosch__prereq_*` progress events. The OperationCard shows "Running…" and a generic transcript stream during a prereq run; phase-by-phase progress (matching Start Feature's pipeline pane) is deferred to a future change.

## Unreleased — spec-plan-gate-shows-real-files

### BREAKING

**`spec+plan` gate payload shape changed.** The MCP `gate_request` tool no longer accepts free-text `spec`/`plan` strings. Callers must now send a path manifest:

```json
{
  "kind": "spec+plan",
  "ticket": "PLAT-12345",
  "workspaceRoot": "/abs/path/to/workspace",
  "specDir": "specs/001-PLAT-12345-slug/",
  "specFiles": ["business-behavior-spec.md", "authorization-spec.md"],
  "planPath": "specs/001-PLAT-12345-slug/execution-plan.md"
}
```

The server resolves each path under `workspaceRoot` (with realpath-based traversal protection), reads the files from disk, enforces a per-file size cap (default 1 MB, override with `BOSCH_GATE_MAX_FILE_BYTES`), and stores a snapshot alongside the gate row. Any read failure, missing file, traversal attempt, or oversize file rejects the request before any DB write or event broadcast.

**Cutover:** drain or cancel any `paused-gate` runs before upgrading — they were created against the old schema and will not resume.

**Paired SKILL update:** the orchestrator skill (`feature-workflow/SKILL.md`) in the consumer repo must emit the new payload shape. Until the SKILL is updated to call `gate_request` with the manifest, Phase 1d will not surface a gate to the UI.

### Added

- `GET /api/gates/:gateId/files/:fileIndex` — live re-read of a snapshot file. `:fileIndex` is an integer (spec index) or the literal `"plan"`. Returns `{ path, content, size, mtime, drifted, snapshotMtime }` where `drifted` compares current disk bytes to the stored snapshot. Snapshot row is never mutated.
- `gates.snapshot` JSON column (additive migration — older code ignores it).
- `ReviewGate` UI: per-spec-file tab strip, markdown-rendered plan, provenance header (path / size / relative mtime), refresh button with drift banner, empty states when `specFiles` is empty or `plan` is null.

## Unreleased — unify-workspace-as-single-project

### BREAKING

**Schema change:** Delete `~/.bosch-sdlc/state.db` before starting the new server. Re-attach your workspaces from the Dashboard. The first server start after upgrade creates a fresh DB with the new schema.

**Protocol changes:**
- `scope` and `workspaceRoot` removed from `Project`, `Run`, and `CreateRunRequest`.
- Old clients sending `scope` or `workspaceRoot` in `POST /api/runs` are silently tolerated (fields are ignored).
- `GET /api/projects` response no longer includes `scopes` or `workspaceRoot`.
- `GET /api/runs` response no longer includes `scope` or `workspaceRoot`.

**UX change:** Kickoff no longer has a scope picker for any topology. The form is prompt-only for all topologies (monolith, monorepo, multi-repo-workspace).

### What Changed

- Multi-repo workspaces now produce exactly **one Project** at the workspace root, not N projects for each child repo. Runs execute with `cwd = workspace root`; the agent picks which child repo(s) to touch based on the prompt.
- The monorepo scope picker has been removed. The initial prompt is always `/start-feature <user-prompt>` with no `[scope: ...]` prefix.
- Topology (`monolith` / `monorepo` / `multi-repo-workspace`) survives as an informational badge only — no runtime code branches on it.
- Prereq detection runs once per workspace Project (not once per child repo).
