## ADDED Requirements

### Requirement: Server-origin timestamps render in the viewer's local timezone without offset error

Every server-origin timestamp string that the web UI displays as a wall-clock time (the run "Started" time on the Active Run telemetry, run "Completed" time, gate `createdAt` / `resolvedAt`, repo and project `createdAt`, and any future field of the same shape) SHALL be parsed through a single helper `parseServerTime(s: string): Date` exported from `ui/src/lib/time.ts`. The helper SHALL:

- Recognise ISO 8601 strings that contain a `T` separator and end in `Z` or a `±HH:MM` offset, and parse them via the native `new Date(s)` (correct because the timezone is unambiguous).
- Recognise the legacy SQLite default shape `"YYYY-MM-DD HH:MM:SS"` (no `T`, no `Z`) and treat it as UTC by replacing the space with `T` and appending `Z` before parsing. This handles rows already on disk in users' DBs written before this change.
- Return `new Date(NaN)` for empty or unparseable input so that the calling renderer can show a placeholder rather than crash.

The `runs.created_at`, `runs.completed_at`, `gates.created_at`, `gates.resolved_at`, `repos.created_at`, `projects.created_at` columns and every other SQLite column that defaults to a timestamp SHALL declare `DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))` so that newly written rows are unambiguous ISO 8601 UTC. The previous `DEFAULT (datetime('now'))` form SHALL NOT be introduced in any new schema or migration.

No direct `new Date(serverString)` call SHALL exist in `ui/src/` for any server-origin timestamp; the helper is the only entry point.

#### Scenario: New run started at 14:30 UTC displays as 16:30 local on a UTC+2 machine

- **GIVEN** the SQLite default is `strftime('%Y-%m-%dT%H:%M:%fZ','now')` and a fresh `runs` row is inserted at `2026-06-05T14:30:45.123Z`
- **AND** the viewer's browser is configured to local timezone `Europe/Berlin` (UTC+2 in summer)
- **WHEN** the Active Run telemetry pane renders the "Started" row
- **THEN** the rendered time text reads `16:30:45` (the viewer's local time for that UTC moment), not `14:30:45`

#### Scenario: Legacy row written before the schema change still renders correctly

- **GIVEN** a `runs` row already on disk with `created_at = "2026-06-05 14:30:45"` (legacy format, no `T`, no `Z`) written by a previous version of the server
- **AND** the viewer's browser is configured to local timezone `Europe/Berlin` (UTC+2 in summer)
- **WHEN** the Active Run telemetry pane renders the "Started" row
- **THEN** `parseServerTime` treats the value as UTC and the rendered time reads `16:30:45`, matching the behaviour for a new row

#### Scenario: Empty or malformed timestamp renders a placeholder

- **GIVEN** the server-origin timestamp string is empty (`""`) or otherwise unparseable
- **WHEN** any consumer calls `parseServerTime` on it
- **THEN** the helper returns a `Date` whose `getTime()` is `NaN`
- **AND** the caller renders the existing `—` placeholder rather than the literal string `"Invalid Date"`

### Requirement: Active Run Live stream displays a per-line timestamp for every entry

Every `StreamEntry` produced by `buildStream(events: WsEvent[])` in `ui/src/components/ActiveRun/stream.ts` SHALL carry an optional `time?: string` field (ISO 8601 UTC, sourced verbatim from the originating `WsEvent.t`). The `.active-run__ev-time` slot reserved by `ui/src/components/ActiveRun/ActiveRun.css` SHALL render that timestamp as 24-hour wall-clock `HH:MM:SS` in the viewer's local timezone. When the entry has no `time` (the header), the slot SHALL render the existing `—` placeholder.

Time assignment per entry kind:

- **header** — `time` is not set. The renderer shows `—`. Rationale: the header is a once-per-run banner, not a moment in the stream.
- **text** / **thinking** — `time` is the `t` of the `transcript-message` event that contained the corresponding `text` / `thinking` block.
- **tool** — `time` is the `t` of the `transcript-message` event that contained the `tool_use` block. When the matching `tool_result` arrives later and mutates `resultPreview` / `isError`, `time` SHALL NOT be updated.
- **footer** — `time` is the `t` of the `transcript-message` event that contained the SDK `result` message.

The time formatter SHALL use `Intl.DateTimeFormat` (or equivalent) with the viewer's local timezone, `hour12: false`, and two-digit hour / minute / second components, producing exactly 8 characters (`HH:MM:SS`).

Because `WsEvent.t` is generated server-side via `new Date().toISOString()` and is already proper ISO 8601 UTC with `Z`, the live-stream display does not need to go through `parseServerTime`; native `new Date(ev.t)` is correct. (The two requirements share a theme but only the first needs the legacy-tolerant helper.)

#### Scenario: Each visible row in the Live stream shows the time of its originating event

- **GIVEN** a run has emitted three `transcript-message` events: a `system` init at `t1 = "2026-06-05T14:30:00.000Z"`, an `assistant` message with a `text` block at `t2 = "2026-06-05T14:30:02.500Z"`, and an `assistant` message with a `tool_use` Bash block at `t3 = "2026-06-05T14:30:03.100Z"`
- **AND** the viewer's browser is in local timezone `Europe/Berlin` (UTC+2 in summer)
- **WHEN** the Live stream renders
- **THEN** the header row's `.active-run__ev-time` slot shows `—`
- **AND** the text row's slot shows `16:30:02`
- **AND** the tool row's slot shows `16:30:03`

#### Scenario: Tool entry timestamp stays at the tool_use time after the result arrives

- **GIVEN** a `tool_use` block arrived at `t_use = "2026-06-05T14:30:03.100Z"` producing a tool entry
- **WHEN** the matching `tool_result` arrives 12 seconds later at `t_result = "2026-06-05T14:30:15.100Z"` and mutates the entry's `resultPreview`
- **THEN** the tool entry's `time` field is still `t_use` (the start moment), not `t_result`
- **AND** the rendered row continues to display `16:30:03` (local), not `16:30:15`

#### Scenario: Footer row shows the time of the SDK result message

- **GIVEN** the SDK emits a `result` message inside a `transcript-message` event at `t = "2026-06-05T14:30:47.000Z"`
- **WHEN** the Live stream renders the resulting footer row
- **THEN** the footer row's `.active-run__ev-time` slot shows `16:30:47` (local for `Europe/Berlin` in summer)

#### Scenario: buildStream propagates ev.t into every entry pushed from a single event

- **GIVEN** a single `transcript-message` event at `t = "2026-06-05T14:30:02.500Z"` whose payload contains an `assistant` message with two `text` blocks and one `tool_use` block
- **WHEN** `buildStream` processes the event
- **THEN** all three entries pushed (two text entries plus one tool entry) carry `time === "2026-06-05T14:30:02.500Z"`
