## REMOVED Requirements

### Requirement: Drive claudboard prereqs through the same SDK runner

**Reason:** The Anthropic Agent SDK's `query()` does not preprocess slash commands. Passing `"/analyse"` as a prompt resulted in the LLM seeing the literal string with no skill resolution; runs completed without doing the requested work. Replaced with a Claude Code CLI subprocess that does perform slash-command preprocessing and plugin resolution. The behavioral guarantees (run record creation, dependency validation, completion detection, output-path surfacing, WS streaming, pause/resume) are preserved by the replacement; only the execution mechanism changes.

## ADDED Requirements

### Requirement: Execute prereq commands via the Claude Code CLI subprocess

The system SHALL expose endpoints to run each claudboard prereq command — `/analyse`, `/generate`, `/claudboard-workflow`, `/refresh`, `/techdebt` — against a given repo by spawning the Claude Code CLI as a child process with the slash command passed as an argv element, `cwd` set to the target repo path, and `--output-format stream-json --verbose` selected so stdout is line-delimited JSON.

The runner SHALL stream each JSON line from the child's stdout to the run's transcript JSONL file (appended verbatim, one line per chunk, in arrival order) and SHALL broadcast each parsed line as a `transcript-message` WebSocket event over the run's room, using the same event envelope used by feature-workflow runs.

On child exit with code 0, the run row's `status` SHALL transition to `done` and `completed_at` SHALL be set. On non-zero exit or on a spawn-time `error` event (e.g. ENOENT), the run row's `status` SHALL transition to `failed`, `completed_at` SHALL be set, and `error_message` SHALL be populated with the last 2 KB of stderr (truncated with an explicit "[truncated]" suffix if longer).

The runner SHALL NOT build, parse, or alter the slash command body. The CLI is responsible for resolving the slash command against installed plugins; failures to resolve surface as a non-zero exit from the child process and are reported via the standard failure path.

#### Scenario: Analyse a repo via the CLI

- **GIVEN** the bootstrap state is `ready` and the project for `/Users/x/proj/foo` is registered
- **WHEN** the user POSTs `/api/prereqs/analyse` with `{ target: "/Users/x/proj/foo" }`
- **THEN** the server creates a run row with `kind='prereq'` and `status='running'`, responds 201 with the run, and asynchronously spawns `claude --print --output-format stream-json --verbose /analyse` with `cwd = "/Users/x/proj/foo"`
- **AND** each stream-json line emitted by the child is appended to `~/.bosch-sdlc/transcripts/<runId>.jsonl` and broadcast as a `transcript-message` event
- **AND** on child exit code 0, the run transitions to `status='done'`

#### Scenario: Generate after analyse

- **GIVEN** the project's prereq state shows `analyse: done`
- **WHEN** the user POSTs `/api/prereqs/generate`
- **THEN** the server spawns `claude /generate` with the project's `cwd` and the run executes via the same path as `analyse`

#### Scenario: Prereq blocked by missing predecessor

- **WHEN** the user POSTs `/api/prereqs/generate` for a repo whose `analyse` state is `missing`
- **THEN** the server returns HTTP 409 with a message naming the missing predecessor and instructing the user to run `/analyse` first
- **AND** no child process is spawned
- **AND** no run row is created

#### Scenario: Non-zero exit captures stderr into the run record

- **WHEN** the spawned `claude` process exits with code 1 and writes `"Plugin claudboard not found"` to stderr
- **THEN** the run row transitions to `status='failed'`, `completed_at` is set, and `error_message` contains `"Plugin claudboard not found"`
- **AND** a `status-change` WebSocket event with `payload: { status: 'failed' }` is broadcast on the run's room

#### Scenario: `claude` binary missing at spawn time

- **GIVEN** the `claude` binary was on PATH at server boot (passed the precondition check) but has since been removed
- **WHEN** the server attempts to spawn it for a prereq run
- **THEN** the spawn `error` event is caught; the run transitions to `status='failed'` with `error_message` describing the spawn failure

#### Scenario: Malformed JSON line in stream-json output

- **GIVEN** the child emits a line that is not valid JSON
- **WHEN** the runner parses each line
- **THEN** the malformed line is appended to the transcript verbatim, a warning is logged server-side, and no `transcript-message` event is broadcast for that line
- **AND** the runner continues processing subsequent lines without crashing

### Requirement: Completion downgrade when expected artifact is absent

When a prereq run exits with code 0, the system SHALL re-run the freshness detection from `workspace-registry` against the target repo. If the prereq's expected output file (per `detectPrereqs` configuration — e.g. `.claude/reports/claudboard-analysis.md` for `analyse`, `CLAUDE.md` for `generate`) does not exist after the run, the system SHALL downgrade the run's status from `done` to `failed` with `error_message = "Command exited 0 but expected artifact <relative-path> was not written"`.

This requirement protects against the silent-success failure mode where the CLI exits cleanly but the LLM did not actually perform the requested work (e.g. because the slash command resolved to an empty skill, or the LLM refused).

The `refresh` command, which has no durable artifact, SHALL be exempt from this downgrade; a code-0 exit is sufficient for `refresh` to be considered done.

#### Scenario: Analyse exits 0 without writing the report

- **GIVEN** an `analyse` prereq run is in flight
- **WHEN** the CLI exits with code 0 but `.claude/reports/claudboard-analysis.md` does not exist
- **THEN** the run's status is set to `failed`
- **AND** the run's `error_message` is `"Command exited 0 but expected artifact .claude/reports/claudboard-analysis.md was not written"`
- **AND** the prereq state for `analyse` remains `missing`

#### Scenario: Refresh exits 0 with no artifact

- **GIVEN** a `refresh` prereq run is in flight
- **WHEN** the CLI exits with code 0
- **THEN** the run's status is set to `done`
- **AND** no artifact check is performed (refresh has no durable artifact by design)

### Requirement: Prereq endpoints return 503 while bootstrap is not ready

The `POST /api/prereqs/:cmd` endpoint and the `POST /api/runs` endpoint SHALL return HTTP 503 with a body of `{ error: <state-specific message>, bootstrapState: <state> }` whenever the bootstrap state is not `ready`. The state-specific message SHALL come from a fixed map:

- `installing` → "bosch-sdlc is still setting up. Please wait a few seconds and try again."
- `cli-missing` → "Claude Code is not installed. Visit https://claude.com/download to install it."
- `install-failed` → "Plugin install failed: <truncated stderr>. Click Retry on the dashboard."

`GET` endpoints SHALL NOT be gated; viewing existing projects, runs, transcripts, and prereq state remains available during install.

#### Scenario: POST prereq returns 503 during install

- **GIVEN** bootstrap state is `installing`
- **WHEN** the client POSTs `/api/prereqs/analyse`
- **THEN** the response is HTTP 503 with body `{ error: "bosch-sdlc is still setting up. Please wait a few seconds and try again.", bootstrapState: "installing" }`
- **AND** no run row is created

#### Scenario: GET endpoints remain available during install

- **GIVEN** bootstrap state is `installing`
- **WHEN** the client GETs `/api/projects` or `/api/runs`
- **THEN** the response is HTTP 200 with the usual payload

### Requirement: Prereq state refresh on completion (preserved from prior spec)

After each prereq run terminates (exit 0 or otherwise), the system SHALL re-run the freshness detection from `workspace-registry` for the target repo and persist updated prereq state via `upsertPrereqs`. This ensures the Project screen reflects newly-written report files (or their continued absence after a downgrade).

#### Scenario: Successful run updates state

- **WHEN** an `/analyse` run exits 0 and `.claude/reports/claudboard-analysis.md` is present
- **THEN** the project's prereq state shows `analyse: done` with `lastRun` set to the run's completion timestamp; the dashboard reflects the new state on next fetch

### Requirement: Prereq output surfacing (preserved from prior spec)

The system SHALL persist each prereq run's primary output path and expose it via `GET /api/projects/:id/prereqs` so the Project screen can show "view report" links.

#### Scenario: View analysis report path

- **WHEN** the user fetches `/api/projects/:id/prereqs`
- **THEN** the response includes for each prereq: `{ id, state, lastRun, duration, cost, output: <relative-path-or-null> }`
