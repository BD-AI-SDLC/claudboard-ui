## Context

Two unrelated-looking UI bugs share a single root: timestamps from the server are not surviving the trip to the screen.

**Bug 1 — wall-clock offset.** The `runs` row passes `created_at` through to `ActiveRun.tsx:528` where `new Date(run.createdAt).toLocaleTimeString()` renders it. The SQLite column default is `datetime('now')`, which emits `"YYYY-MM-DD HH:MM:SS"` — UTC by spec, but with no `T` separator and no `Z` suffix. ECMAScript Date parsing of that exact shape is implementation-defined and modern V8 treats it as **local time**, so a CEST machine (UTC+2) displays "14:30" for a moment that actually happened at 16:30 local — an offset error exactly equal to the user's timezone.

**Bug 2 — empty time column.** `ActiveRun.css:223` reserves a 70px `.active-run__ev-time` column. The five `renderEntry` branches all emit `<span className="active-run__ev-time" />` with no text. Walking back through `stream.ts`, none of the five `StreamEntry` variants carry a time field, so even though every `WsEvent` arrives with a proper ISO `t`, that data is dropped at the `buildStream()` boundary.

The server side of WebSocket events is already correct: 12 call sites under `server/src/` use `new Date().toISOString()` (see `cost/tracker.ts`, `run/driver.ts`, `prereq/cli-runner.ts`, `gate/mcp-server.ts`). Only the SQLite column defaults are wrong, and only the live-stream entry pipeline drops `t`.

## Goals / Non-Goals

**Goals:**
- Run "Started" time renders in the viewer's local timezone with no offset error, for both newly created rows and rows already on disk in users' DBs.
- Every Live stream entry that originates from a single WebSocket event displays a `HH:MM:SS` 24-hour local timestamp in the existing reserved column.
- The fix is localized: server schema + a small UI helper + the three files in `ui/src/components/ActiveRun/`. No protocol change, no migration, no breaking API.

**Non-Goals:**
- Backfilling existing rows in users' `~/.bosch-sdlc/state.db` to the new ISO format. The UI tolerates the legacy format instead.
- Relative time deltas (e.g. `+0.4s`) between stream lines. We display wall-clock only — simpler, more useful for diagnostics, and fits the 70px slot.
- Timezone configurability. The browser's local timezone is the source of truth for display.
- Changes to other timestamp consumers (transcripts, event log files). Those already use `WsEvent.t` or write their own ISO strings.

## Decisions

### Decision 1 — Fix the server-side default, not just the UI parser

The temptation is to patch only the UI: detect the missing `Z` and append it before parsing. That works but leaves the database storing ambiguous strings forever and re-creates the bug for any future consumer (e.g. a CLI report tool, an export endpoint, a different UI surface).

We change every `DEFAULT (datetime('now'))` in `server/src/db.ts` to `DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))`. New rows are written as `"2026-06-05T14:30:45.123Z"` — unambiguous ISO 8601 UTC. Same write cost, same column type (TEXT), same comparison semantics (the new format also sorts lexicographically as it does chronologically, which the legacy format also did).

**Alternative considered:** switch to writing timestamps from Node (`new Date().toISOString()`) at every INSERT site, removing the SQLite default. Rejected because (a) it touches every insert call site instead of one schema file, (b) two sources of truth (some INSERTs explicitly, some falling back to default) is worse than one, and (c) the schema default is the canonical Bosch-SDLC pattern already.

**Alternative considered:** UI-only fix that appends `Z` before parsing. Rejected — does not fix the underlying data and is one more thing to remember every time a new timestamp consumer is added.

### Decision 2 — Keep a UI helper anyway, for backwards compatibility with legacy DBs

Decision 1 fixes new writes. Existing users have rows already on disk with the legacy format. We add `parseServerTime(s: string): Date` that:

- If `s` matches the ISO format with `T` and ends in `Z` or a `±HH:MM` offset → return `new Date(s)` directly.
- Otherwise (legacy `"YYYY-MM-DD HH:MM:SS"` shape) → treat as UTC by replacing the space with `T` and appending `Z`, then `new Date(...)`.
- If `s` is empty or unparseable → return `new Date(NaN)` and let the caller render a placeholder.

This helper lives in `ui/src/lib/time.ts` (creating the `lib/` dir if it does not already exist — there is no current `ui/src/lib/`, so this also establishes the convention). Every call site that today does `new Date(serverString)` is routed through the helper.

**Alternative considered:** put the helper in `protocol/`. Rejected — the helper is a UI display concern (browser-side parsing), not a wire-format concern. Protocol stays type-only.

**Alternative considered:** auto-migrate legacy rows on startup. Rejected — startup migrations carry real risk (lock contention, partial rollback), and the helper makes the migration unnecessary.

### Decision 3 — Stream entry time comes from the event that created the entry

`buildStream()` walks `WsEvent[]` and pushes entries. We add `time?: string` (ISO) to every variant. Rules:

- **header** entry: emitted on the first `system` message → no `time` is set. The renderer keeps the existing `—` placeholder. Rationale: the header is a once-per-run banner, not a moment-in-the-stream; "Started at" lives in the telemetry pane above.
- **text** / **thinking** entry: `time` = the parent `transcript-message` event's `t`.
- **tool** entry: `time` = the `t` of the event that carried the `tool_use` block. The later `tool_result` event mutates `resultPreview` and `isError` but does **not** update `time`. Rationale: the entry's visible identity is the tool call; its timestamp is when it was initiated.
- **footer** entry: `time` = the `t` of the SDK `result` event.

**Alternative considered:** show tool completion time instead of start time. Rejected — when a tool runs for >1s, the entry first appears (and the user sees it) at start; updating the timestamp later when the result comes back is confusing.

**Alternative considered:** show both start and completion for tools. Rejected — does not fit the 70px slot and adds noise. The result preview already communicates completion implicitly.

### Decision 4 — Display format is `HH:MM:SS` 24-hour local

`Intl.DateTimeFormat` with `hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false` rendered in the viewer's local timezone. Fixed-width font (the column already uses `--mono` via inheritance from `.active-run__ev`). Width budget at 70px is comfortable for the 8 characters of `14:30:45`.

We do not include the date — the Live stream is a single run that fits within a session window. If a run crosses midnight, the time column still reads sensibly; the run's "Started" entry in the telemetry pane carries the full datetime for context.

### Decision 5 — `parseServerTime` is the only timestamp helper; no Date-fns dependency

No new npm dependency. The existing UI has no date-formatting library and the format we need is minimal. Add a 1-line `formatStreamTime(iso: string): string` co-located in `ui/src/lib/time.ts` using `Intl.DateTimeFormat`.

## Risks / Trade-offs

- **Risk: legacy rows still mis-render if any call site forgets the helper.** → Mitigation: grep for `new Date(` across `ui/src/` during implementation; the helper's import is the linter signal. Add a unit test for the helper that covers both formats. Also rare: only `runs.createdAt`, `runs.completedAt`, `gate.createdAt`, `gate.resolvedAt`, `repos.createdAt`, `projects.createdAt` are exposed to the UI today — small surface.

- **Risk: `strftime('%Y-%m-%dT%H:%M:%fZ','now')` produces fractional-second precision (`.123`) whereas `datetime('now')` did not.** → Mitigation: this is a strict superset of valid ISO 8601 and Date parses it correctly; no consumer compares timestamp strings for equality.

- **Risk: a future timestamp column added with the old `datetime('now')` default reintroduces the bug.** → Mitigation: extend `server-conventions.md` rule file (out of scope here, but call out in tasks.md follow-up note) and rely on code review. Helper provides a permanent backstop on the UI side.

- **Risk: the live-stream time column changes the visual rhythm of the pane and feels noisier.** → Mitigation: the column already exists in the CSS and the dim color is already configured; this change makes the design as-intended visible, it does not introduce new layout.

- **Trade-off: no relative deltas.** Wall-clock is friendlier for "what was happening at 14:32 when the run hung?" but worse for "how long did the assistant spend thinking before the first tool call?" The footer already shows total duration; if users ask for per-step deltas later, we can add them as a second column without disturbing this one.

## Migration Plan

1. Ship the schema-default change in `db.ts`. Existing DBs are unaffected (schema defaults only apply to new INSERTs without an explicit value).
2. Ship the `parseServerTime` helper and reroute UI call sites in the same release. Legacy rows render correctly because the helper handles both formats; new rows render correctly because they're now proper ISO.
3. No rollback complexity: the helper accepts both formats, and reverting the `db.ts` change is a one-line revert.

## Open Questions

_None._ All design questions resolved against the brief; no user input required to proceed to tasks.
