## Why

Two timestamp bugs surface every time a user runs a workflow:

1. The Active Run telemetry shows a "Started" time that is wrong by the user's local UTC offset (≈2h on CET/CEST machines), because SQLite's `datetime('now')` default emits a UTC string with no `T` separator and no `Z` suffix — the browser parses it as local time.
2. The Live stream reserves a 70px column for a per-line timestamp (and ships matching CSS) but the column is always empty: `buildStream()` discards the `ev.t` field that arrives on every WebSocket event.

The first bug actively misleads users about when work started. The second leaves a half-finished feature visibly broken in the UI. Both are scoped, no protocol or API change is needed, and they share the same theme of "server timestamps not reaching the screen correctly."

## What Changes

- Change SQLite schema defaults from `datetime('now')` to `strftime('%Y-%m-%dT%H:%M:%fZ','now')` so newly written rows carry unambiguous ISO 8601 UTC strings on every table that times anything (`runs`, `gates`, `repos`, `projects`, prereq tables).
- Introduce a small `parseServerTime(s)` helper in the UI that accepts both the new ISO 8601 format and legacy `"YYYY-MM-DD HH:MM:SS"` rows (treating the legacy format as UTC). Use it everywhere a server-origin timestamp is rendered.
- Add an optional `time?: string` field to every `StreamEntry` variant in `ui/src/components/ActiveRun/stream.ts`; `buildStream()` propagates `ev.t` onto each pushed entry; `renderEntry()` formats it as `HH:MM:SS` 24h local into the existing `.active-run__ev-time` slot.
- The Live stream header keeps the existing `—` placeholder (no meaningful per-line time for the once-per-run header); footer shows the time of the SDK `result` message; tool entries inherit the `tool_use` time, not the later `tool_result` mutation.

Out of scope: backfilling existing rows in users' local DBs (the UI helper handles them transparently); changes to the protocol or to how WebSocket events carry `t`.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `web-ui`: adds two requirements to the Active Run capability — (a) server-origin timestamps render in the viewer's timezone without offset error, regardless of whether the underlying row uses the new or legacy SQLite default; (b) Live stream entries display a per-line `HH:MM:SS` timestamp in the reserved column, sourced from the originating WebSocket event.

## Impact

- **Server** — `server/src/db.ts` schema defaults updated; no migration of existing data (legacy rows remain readable via the UI helper). No API surface change.
- **UI** — new helper module for `parseServerTime`; `StreamEntry` gains an optional `time` field; `buildStream()` and `renderEntry()` updated; existing direct `new Date(run.createdAt)` / `gate.createdAt` call sites routed through the helper.
- **Protocol** — no change. `WsEvent.t` is already a proper ISO 8601 UTC string.
- **Tests** — new unit tests for `parseServerTime` (both formats, plus malformed/empty inputs) and for `buildStream` propagating `time` onto each entry variant.
- **No breaking changes.** No user-visible config or migration steps required.
