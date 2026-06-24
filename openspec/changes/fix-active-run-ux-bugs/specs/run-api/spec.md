## ADDED Requirements

### Requirement: Run REST responses use the protocol's camelCase shape

The HTTP endpoints `GET /api/runs` and `GET /api/runs/:id` SHALL return run objects whose field names match the `Run` interface declared in `@bosch-sdlc/protocol` (`protocol/src/types.ts`). Specifically, the response body SHALL use `projectId`, `createdAt`, `completedAt`, `transcriptPath`, `inputTokens`, and `outputTokens` (camelCase), NOT the raw SQLite column names `project_id`, `created_at`, `completed_at`, `transcript_path`, `input_tokens`, `output_tokens`.

The mapping SHALL be performed by a single shared row-mapper used by both endpoints, so the two endpoints cannot drift. Fields not declared in the `Run` interface (e.g. internal-only columns) SHALL NOT appear on the response.

Additional fields the existing `GET /api/runs` endpoint synthesizes (notably `openGate`) SHALL be preserved unchanged.

#### Scenario: GET /api/runs/:id returns camelCase fields

- **GIVEN** a run was inserted with project id `"p1"` and created at `"2026-05-22T10:00:00.000Z"`
- **WHEN** the client calls `GET /api/runs/<id>`
- **THEN** the response body contains the keys `projectId === "p1"` and `createdAt === "2026-05-22T10:00:00.000Z"`
- **AND** the response body does NOT contain the keys `project_id`, `created_at`, `transcript_path`, `completed_at`, `input_tokens`, or `output_tokens`

#### Scenario: GET /api/runs returns camelCase fields in every row

- **GIVEN** the database contains three runs
- **WHEN** the client calls `GET /api/runs`
- **THEN** every element of the response array uses `projectId` and `createdAt` (camelCase)
- **AND** no element contains snake_case keys for any column declared on the `Run` type

#### Scenario: Active Run telemetry renders a real start time

- **GIVEN** the Active Run page is mounted and has just polled `GET /api/runs/:id`
- **WHEN** the Run telemetry pane's "Run info" section renders
- **THEN** the "Started" row displays a formatted local time (e.g. `"10:00:00"`), NOT the literal text `"Invalid Date"`
- **AND** the "Project" row displays the project id, NOT an empty string

### Requirement: Run events are durably persisted alongside the WS broadcast

For every `WsEvent` broadcast on a run's WebSocket room, the server SHALL append the same event verbatim to a per-run JSONL log file under `~/.bosch-sdlc/run-events/<runId>.jsonl`. The append SHALL happen in the same `broadcast()` call that fans the event out to connected clients, so an event cannot be sent to a client without also being recorded on disk.

The on-disk format SHALL be newline-delimited JSON: one `WsEvent` object per line, in arrival order, encoded as UTF-8. Lines SHALL NOT include trailing whitespace and SHALL end with a single `\n`.

The 200-event in-memory ring buffer (`server/src/ws-server.ts`) SHALL continue to exist for the WS replay-on-connect path and SHALL NOT be removed by this change. The disk log is the source of truth for `GET /api/runs/:id/events`; the ring buffer remains an optimization for the live WS hand-off.

The log directory SHALL be created lazily on first event for a run. Runs that began before this change ship — and therefore have no log file — SHALL NOT cause the server to error; the events endpoint SHALL return an empty array for them.

#### Scenario: Each broadcast appends one JSON line

- **GIVEN** a run with id `r1` and no prior events
- **WHEN** the server broadcasts three events for `r1` in sequence
- **THEN** the file `~/.bosch-sdlc/run-events/r1.jsonl` exists and contains exactly three lines
- **AND** each line is valid JSON parsing to a `WsEvent`
- **AND** the lines appear in broadcast order

#### Scenario: Disk persistence survives buffer eviction

- **GIVEN** a long-running run for which 500 events have been broadcast
- **WHEN** the events file is inspected
- **THEN** the file contains all 500 events in order, even though the in-memory ring buffer only holds the last 200

#### Scenario: Missing log file for legacy run is not an error

- **GIVEN** a run whose `phase-start` events were broadcast before this change shipped and therefore has no on-disk log
- **WHEN** any code path reads the events file (including the GET endpoint below)
- **THEN** the read resolves to an empty event list without throwing

### Requirement: Run event history is queryable via REST

The server SHALL expose `GET /api/runs/:id/events` returning the full event history for a run as a JSON array of `WsEvent` objects, in broadcast order. The endpoint SHALL:

- Return `404` if the run id is not present in the `runs` table.
- Return `200` with body `[]` when the run exists but has no persisted events (e.g. legacy run, or run that has not yet broadcast anything).
- Stream or buffer the JSONL file's contents into a single JSON array — the response body SHALL be standard JSON (one top-level array), not NDJSON, so the client can `await res.json()`.
- Set `Content-Type: application/json`.

This endpoint is the cold-start hydration path for any UI that derives state from the event stream (notably the Active Run pipeline pane). After hydrating via this endpoint, clients SHALL still attach to the WebSocket for live updates.

#### Scenario: Endpoint returns events in order for a known run

- **GIVEN** a run `r1` whose event log contains, in order, `phase-start{num:1}`, `agent-start{name:"x"}`, `phase-complete{num:1}`
- **WHEN** the client issues `GET /api/runs/r1/events`
- **THEN** the response is `200 OK` with `Content-Type: application/json`
- **AND** the body parses to an array of length 3 whose elements' `kind` fields are `"phase-start"`, `"agent-start"`, `"phase-complete"` in that order

#### Scenario: Endpoint returns 404 for an unknown run

- **WHEN** the client issues `GET /api/runs/does-not-exist/events`
- **THEN** the response status is `404`

#### Scenario: Endpoint returns empty array for a run with no events

- **GIVEN** a run exists in the `runs` table but no events have been broadcast for it yet
- **WHEN** the client issues `GET /api/runs/:id/events`
- **THEN** the response status is `200`
- **AND** the body is `[]`
