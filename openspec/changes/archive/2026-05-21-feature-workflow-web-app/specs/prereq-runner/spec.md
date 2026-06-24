## ADDED Requirements

### Requirement: Drive claudboard prereqs through the same SDK runner

The system SHALL expose endpoints to run each claudboard prereq command — `/analyse`, `/generate`, `/claudboard-workflow`, `/refresh`, `/techdebt` — against a given repo by issuing a `query()` call with that command as the prompt and `cwd` = the repo's `target`.

Prereq runs SHALL use the same WS stream endpoint, transcript persistence, and pause/resume semantics as feature-workflow runs.

#### Scenario: Analyse a repo

- **WHEN** the user POSTs `/api/prereqs/analyse` with `{ target: "/Users/x/proj/foo" }`
- **THEN** the driver calls `query({ prompt: "/analyse", options: { cwd: "/Users/x/proj/foo", ... } })`, streams events, and persists the resulting `.claude/reports/claudboard-analysis.md` path in the project's prereq state

#### Scenario: Generate after analyse

- **WHEN** the user POSTs `/api/prereqs/generate` for a repo whose prereq state shows `analyse: done`
- **THEN** the driver calls `query({ prompt: "/generate" })` and updates prereq state for `generate` on completion

#### Scenario: Prereq blocked by missing predecessor

- **WHEN** the user POSTs `/api/prereqs/generate` for a repo whose `analyse` state is `missing`
- **THEN** the server returns HTTP 409 with a message telling the user to run `/analyse` first

### Requirement: Prereq state refresh on completion

After each prereq run completes successfully, the system SHALL re-run the freshness detection from `workspace-registry` for that repo and persist updated prereq state.

#### Scenario: Successful run updates state

- **WHEN** an `/analyse` run completes successfully
- **THEN** the project's prereq state shows `analyse: done` with `lastRun` set to the run's completion timestamp; the dashboard reflects the new state on next fetch

### Requirement: Prereq output surfacing

The system SHALL persist each prereq run's primary output path (e.g. `.claude/reports/claudboard-analysis.md` for analyse, `CLAUDE.md` for generate) and expose it via `GET /api/projects/:id/prereqs` so the Project screen can show "view report" links.

#### Scenario: View analysis report path

- **WHEN** the user fetches `/api/projects/:id/prereqs`
- **THEN** the response includes for each prereq: `{ id, state, lastRun, duration, cost, output: <relative-path-or-null> }`
