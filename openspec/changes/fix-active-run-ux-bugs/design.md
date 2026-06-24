## Context

Active Run is the workflow UI users spend the most time on. Four defects make it feel broken:

1. **Pipeline pane resets on navigation.** Event-derived state lives in `useRunStream` (a hook owned by `ActiveRun.tsx`). On unmount the WebSocket closes; on remount a fresh WS opens and the server replays its 200-event ring buffer (`server/src/ws-server.ts:8`). On long-running phases with heavy tool/agent traffic, the `phase-start` event for the *active* phase is evicted from the buffer before reconnect, so `buildPipelineFromEvents` sees no `phase-start` for that phase, leaves its status `pending` (the body collapses), and produces no `startedAt` (the elapsed counter disappears).
2. **"Invalid date" / empty Project.** `GET /api/runs/:id` (`server/src/run/routes.ts:82-87`) returns the raw SQLite row, which uses snake_case (`project_id`, `created_at`), while the frontend reads `run.projectId` / `run.createdAt`. The same shape mismatch exists in `GET /api/runs` (the `...run` spread at `routes.ts:65-77` preserves snake_case columns). The kickoff flow happens to round-trip a camelCase record from `createRunRecord`, which is why the bug only appears after the first REST poll.
3. **Gate redirects to dashboard.** `App.tsx:116` passes `onResolved={goDashboard}` to `<ReviewGate>`. Both "Approve" and "Request changes" call this on success.
4. **Single-line "Request changes" input.** `ReviewGate.tsx:266-271` uses `<input>`. The surrounding row puts Submit/Cancel inline next to it, so swapping to a textarea also requires restacking that row.

The user agreed during exploration to fix all four in one change, and to take "option B" for #1: persist events server-side and hydrate via REST on mount (rather than just lifting state to `App.tsx`). Lifting state would survive in-session navigation but not page reload, fresh tabs, or cold loads on long-running runs; durable persistence covers all of those.

## Goals / Non-Goals

**Goals:**
- Pipeline pane state is correctly restored whenever the user re-enters Active Run for a run that is still running, regardless of how many events have streamed since the active phase started, and regardless of whether the user reloads the browser.
- Run telemetry "Started" / "Project" rows display real values, never "Invalid Date" or empty.
- After approving or requesting changes in the Review gate, the user lands on the Active Run page for the same run.
- The Review gate's "Request changes" text input is a multi-line textarea that grows vertically; the Submit/Cancel buttons no longer fight it for horizontal space.

**Non-Goals:**
- Building a full historical run-replay UI. The event log is persisted, but this change only adds the one cold-start endpoint the UI needs. A "view archived runs" feature is out of scope.
- Removing or shrinking the WebSocket ring buffer. The buffer continues to serve the live WS hand-off; the disk log is purely additive.
- Solving event ordering across multiple server processes. The product runs as a single Node process today; a single-process append is the correct level of complexity.
- Reworking how `useRunStream` is organized. We seed the existing hook with REST history; we do not lift it into context or rewrite its consumers.
- Authentication, rate limiting, or pagination on `GET /api/runs/:id/events`. This is a localhost dev tool; the endpoint inherits whatever the rest of the API has (currently none).

## Decisions

### D1. Persist events to JSONL on disk, not into SQLite

**Choice:** Append each broadcast event to `~/.bosch-sdlc/run-events/<runId>.jsonl` (UTF-8, one JSON object per line, terminated by `\n`).

**Why over SQLite:**
- Each run already gets its own transcript JSONL file under `~/.bosch-sdlc/transcripts/`. Putting events next to transcripts matches the established pattern and keeps "per-run, append-only, easy to tail" semantics.
- The events are append-only, ordered, and never queried by anything other than "give me all events for run X". That's exactly what JSONL is good at. SQLite would force us to define a schema, deal with prepared-statement lifetime, and trade O(1) append for an indexed insert.
- The existing `better-sqlite3` instance is synchronous; appending to a file from inside `broadcast()` lets us use `fs.appendFileSync` (acceptable — broadcast is already synchronous and Node's WS broadcast is itself sync). We avoid pulling in any async-flush complexity.

**Alternative considered:** A new `events` table in SQLite with `(run_id, sequence, kind, t, payload)`. Rejected — extra schema, extra migration on first boot, and SQLite gives us nothing for this read pattern that the filesystem doesn't.

### D2. Append synchronously inside `broadcast()`

**Choice:** `broadcast()` calls `fs.appendFileSync(logPath, line, 'utf8')` before fanning the event to clients.

**Why:** The function already does synchronous work (`JSON.stringify`, ring-buffer push, sync `ws.send`). Doing the append synchronously preserves a clean invariant: **if a client received an event over WS, that event is on disk**. With an async append we'd have a race where a client could receive event N but a subsequent REST hydration could miss it. The performance cost on a localhost dev tool is negligible (Node's `appendFileSync` is fast on macOS; events are small).

**Trade-off:** Disk I/O on the event hot path. If we ever found ourselves bottlenecked on `broadcast()` (we won't — this is a dev tool), we'd switch to a streaming `WriteStream` with explicit `drain` handling. For now, simple beats clever.

### D3. Keep the in-memory ring buffer; do not remove it

**Choice:** `server/src/ws-server.ts` continues to maintain its 200-event ring buffer and continues to replay it on WS connect.

**Why:** The buffer makes mid-session reconnects fast — a 1-second flake doesn't require a REST round-trip. The cost of keeping it is zero (it's already there) and it doesn't conflict with the disk log because REST hydration deduplicates against the WS replay (see D5). The disk log is the source of truth for cold loads; the buffer is an optimization for warm reconnects. Removing it would slow down warm reconnects to no benefit.

### D4. REST endpoint reads the JSONL file once per request

**Choice:** `GET /api/runs/:id/events` opens the file, parses each line, returns a JSON array. No streaming, no caching.

**Why:** Even a 10,000-event run is a few hundred KB of JSON. Parsing in one shot is fast enough for the dev-tool target, and a single JSON array means the UI can `await res.json()` instead of needing an NDJSON parser. If performance becomes a real problem later, switching to a streaming reader is a contained change behind the same endpoint shape.

**Edge case — missing file:** Legacy runs (or any run that has not yet broadcast) have no file. The handler treats `ENOENT` as "empty array", not as 404. The 404 is reserved for "run id not in `runs` table".

### D5. UI deduplicates by `(kind, t, JSON.stringify(payload))`

**Choice:** The client hydrates from REST first, then attaches WS. WS replay buffer events may overlap with REST history. The client merges by deduping on the tuple `(kind, t, payload-stringified)`.

**Why:** `WsEvent` lacks a stable id, so we deduplicate on structural identity. The `t` timestamp is server-assigned and monotonic within a run; collisions across distinct events of the same kind and timestamp are vanishingly unlikely for our event mix. Adding an explicit id field would propagate through the protocol package and every event-producing call site for marginal benefit; we choose the localized solution.

**Implementation:** In `useRunStream`, maintain a `Set<string>` of seen event keys. On both the initial REST hydration and each WS message, compute `key = ev.kind + '|' + ev.t + '|' + JSON.stringify(ev.payload)`; skip if already present.

### D6. Single row-mapper for `Run` rows on the server

**Choice:** Introduce `mapRunRow(row)` (likely in `server/src/run/record.ts` next to `createRunRecord`, or in a new `server/src/run/serialize.ts`). Both `GET /runs/:id` and `GET /runs` call it. The mapper produces an object with exactly the camelCase fields declared on the `Run` interface in `protocol/src/types.ts`.

**Why:** Two endpoints currently spread the raw row independently — a guaranteed drift surface. One mapper, one place to update if the schema grows. The mapper also strips internal-only columns (none exist today, but future-proof).

### D7. Hydration timing — block render of derived state, but not the page

**Choice:** `ActiveRun` sets `hydrated = false` initially. While `hydrated === false`, the Pipeline pane shows a single "Loading…" placeholder (or just renders the empty `PHASE_TEMPLATE` with no derived state). Once REST resolves, `hydrated = true`, the WS opens, and the pane renders normally.

**Why:** If we showed the partially-derived state from an empty event list, the user would briefly see "no phase active, no agents" before the real state pops in — exactly the bug they're trying to escape. The placeholder is a small UX cost that prevents a confusing flicker.

### D8. Route both gate-resolution outcomes to Active Run via `goRun(runId)`

**Choice:** `App.tsx` wires `<ReviewGate onResolved={() => goRun(runId)} />`. One handler for both Approve and Request changes.

**Why:** Both outcomes leave the user wanting to watch the run resume. Sending them to the dashboard is jarring — they have to find their run again in a list. We keep `runId` from App-level state (no plumbing needed). The runId is guaranteed non-null at the point ReviewGate is mounted, because the route guard at `App.tsx:103` already requires it.

### D9. Textarea CSS — `resize: vertical`, stacked buttons

**Choice:** Replace `<input className="review-gate__changes-input">` with `<textarea rows={4}>`. Update `ReviewGate.css`:
- `.review-gate__changes-input`: `resize: vertical`, `min-height: ~96px`, `font-family: inherit`, `width: 100%`.
- `.review-gate__action-row`: switch from `flex-direction: row` to `flex-direction: column` (or wrap the buttons in their own row below the textarea); right-align the buttons within their row.

**Why `vertical`, not `both`:** A horizontal grow handle inside a fixed-width column produces broken layouts (the textarea overflows its container). Vertical-only matches the user's request and the established pattern in `InterviewPane` (which uses textareas for the same purpose).

## Risks / Trade-offs

- **[Disk write on every event]** → Synchronous `appendFileSync` on the broadcast hot path. Acceptable for a localhost dev tool; mitigated by event payloads being small (typically <1 KB). If a future high-volume scenario emerges, swap to a per-run `WriteStream` instance kept in the room state, with explicit drain handling.

- **[Disk fills up over time]** → No retention policy in this change. Each run's events file persists indefinitely under `~/.bosch-sdlc/run-events/`. Mitigation: this matches the existing transcript behavior (transcripts also accumulate); a future "cleanup old runs" feature can sweep both directories together. Document the location in the proposal so users know where to look.

- **[REST + WS race produces duplicates]** → Mitigated by the dedup key (D5). The risk is that two distinct events accidentally hash to the same key. For our event mix (`phase-*`, `agent-*`, `checkpoint-*`, `gate-*`, `transcript-message`) with server-assigned `t`, collisions require two events of the same kind to share an exact millisecond timestamp *and* identical payload — meaning the second is effectively a no-op for our derivations anyway.

- **[REST hydration adds a render gate]** → Active Run no longer paints derived state until REST resolves (D7). On a fast localhost this is imperceptible; on a slow network it could be a beat or two. Mitigation: REST returns the disk file directly, no DB join, no transformation; should be sub-100ms for typical runs.

- **[Legacy runs have no log]** → REST returns `[]` for them; pipeline pane shows the empty `PHASE_TEMPLATE`. The user can still see live updates via WS, but cannot recover historical phase state for a run that started before this change ships. Acceptable — the behavior matches today's reality for those runs and improves automatically for every run started after the change ships.

- **[Stacking the gate's action buttons changes its visual rhythm]** → The "Request changes" panel will be taller than today. Acceptable — that's the point. The Review gate's header is the primary action surface; the inline form is a secondary, transient surface.
