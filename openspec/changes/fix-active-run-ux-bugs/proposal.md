## Why

Four UX defects in the Active Run flow make in-flight runs feel broken: the pipeline pane collapses when users navigate away and back, run telemetry displays "Invalid date" with an empty Project, the Review gate drops users on the dashboard after approval, and the "Request changes" field only accepts one short line of feedback. The first defect has a non-trivial root cause (the server's 200-event WebSocket ring buffer evicts the active phase's `phase-start` event on long runs, leaving the pipeline projection with no anchor); the other three are surgical fixes that belong in the same change because they share the same user surface and review effort.

## What Changes

- Persist every `WsEvent` broadcast for a run to a durable per-run JSONL event log on disk (alongside the existing transcript).
- Add a new REST endpoint `GET /api/runs/:id/events` that returns the full event history for a run.
- Hydrate `ActiveRun`'s event state from `GET /api/runs/:id/events` on mount, then attach the WebSocket for live updates (deduplicating by event identity so the WS replay buffer does not double-insert).
- Normalize `GET /api/runs/:id` and `GET /api/runs` responses to the camelCase shape declared by the `Run` type in `@bosch-sdlc/protocol` (introducing a single row-mapper used by both endpoints).
- Wire `ReviewGate.onResolved` to return the user to the Active Run page for the same `runId` (both for "Approve" and "Request changes").
- Replace the `<input>` in the Review gate's "Request changes" panel with a `<textarea>` (rows={4}, `resize: vertical`, `font-family: inherit`) and stack the Submit / Cancel buttons below the textarea so they no longer fight a multi-line input for horizontal space.

## Capabilities

### New Capabilities
- `run-api`: HTTP/WebSocket surface for the run lifecycle — covers the new events history endpoint, the camelCase response contract for run resources, and how those endpoints interact with the WS replay buffer.

### Modified Capabilities
- `web-ui`: Active Run page hydrates pipeline state from the events history endpoint instead of relying solely on the WS replay buffer; Review gate routes back to the Active Run page after resolution; Review gate "Request changes" field is a multi-line textarea with a stacked button layout.

## Impact

- **Server (`server/src/`):**
  - `ws-server.ts` — `broadcast()` also appends the event to the run's event log.
  - New module (e.g. `run/event-log.ts`) — open/append/read a JSONL file per run under `~/.bosch-sdlc/run-events/<runId>.jsonl`; safe for concurrent appends from a single process.
  - `run/routes.ts` — new `GET /runs/:id/events` handler; row-mapper applied to `GET /runs/:id` and `GET /runs`.
  - `__tests__/integration.test.ts` — new tests for the events endpoint and the run response shape.
- **Protocol (`protocol/src/`):** no type changes; the `Run` shape already declares camelCase fields. (A new response type for the events endpoint may be added but is structurally `WsEvent[]`.)
- **UI (`ui/src/`):**
  - `api/client.ts` — add `getRunEvents(id)`.
  - `hooks/useRunStream.ts` — accept an initial history array (or fetch internally), seed `events`, then attach WS.
  - `components/ActiveRun/ActiveRun.tsx` — call the history endpoint on mount before attaching the stream.
  - `App.tsx` — `<ReviewGate onResolved={() => goRun(runId)} />`.
  - `components/ReviewGate/ReviewGate.tsx` + `ReviewGate.css` — textarea + stacked button row.
- **Filesystem:** new `~/.bosch-sdlc/run-events/` directory created on first event for a run. No migration needed — runs created before this change simply have no history file and behave the same as today (fall back to whatever the WS replay buffer holds).
- **No breaking changes** to existing API consumers: the camelCase normalization fixes a contract that was already declared in `protocol/src/types.ts`; the new events endpoint is purely additive.
