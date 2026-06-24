## 1. Server: event log persistence

- [x] 1.1 Create `server/src/run/event-log.ts` exporting `appendEvent(runId, event)` and `readEvents(runId)`. `appendEvent` creates `~/.bosch-sdlc/run-events/` if missing and uses `fs.appendFileSync` to write `JSON.stringify(event) + '\n'`. `readEvents` reads the file if it exists, splits on `\n`, parses each non-empty line; returns `[]` on `ENOENT`.
- [x] 1.2 Wire `broadcast()` in `server/src/ws-server.ts` to call `appendEvent(runId, event)` before fanning the event to WS clients. Preserve the in-memory ring buffer behavior (still push/shift; still replay on connect).
- [x] 1.3 Add a unit/integration test under `server/src/__tests__/` covering: (a) three broadcasts produce a 3-line file in order, (b) 500 broadcasts persist all 500 lines while the ring buffer holds only 200, (c) `readEvents` on a missing file resolves to `[]`.

## 2. Server: events REST endpoint

- [x] 2.1 Add `router.get('/runs/:id/events', ...)` to `server/src/run/routes.ts`. Verify the run id exists in the `runs` table (404 if not). Call `readEvents(req.params.id)`. Set `Content-Type: application/json` and `res.json(events)`.
- [x] 2.2 Add integration test cases in `server/src/__tests__/integration.test.ts` for the three scenarios in `specs/run-api/spec.md`: known run returns ordered events, unknown run returns 404, run with no events returns `[]`.

## 3. Server: camelCase row mapper for runs

- [x] 3.1 Add `mapRunRow(row)` (e.g. in `server/src/run/record.ts` or a new `server/src/run/serialize.ts`) that returns `{ id, projectId, kind, status, prompt, target, transcriptPath, createdAt, completedAt, cost, inputTokens, outputTokens }` mapped from the snake_case SQLite columns.
- [x] 3.2 Update `GET /runs/:id` in `server/src/run/routes.ts` to call `res.json(mapRunRow(row))`.
- [x] 3.3 Update `GET /runs` to use `mapRunRow` for the base run object before attaching `openGate`. Confirm the `openGate` shape is unchanged.
- [x] 3.4 Add an integration test asserting both endpoints return `projectId` and `createdAt` (and never any of `project_id`, `created_at`, `transcript_path`, `completed_at`, `input_tokens`, `output_tokens`).

## 4. UI: API client + hook hydration

- [x] 4.1 Add `getRunEvents: (id: string) => Promise<WsEvent[]>` to `ui/src/api/client.ts`, calling `GET /api/runs/${id}/events`.
- [x] 4.2 Update `ui/src/hooks/useRunStream.ts` to: (a) seed `events` from `api.getRunEvents(runId)` on mount before opening the WS, (b) maintain a `Set<string>` of seen event keys where `key = ev.kind + '|' + ev.t + '|' + JSON.stringify(ev.payload)`, (c) dedupe both REST-seeded and WS-arrived events against this set, (d) expose a `hydrated: boolean` flag that becomes `true` once the REST call resolves (success or empty).
- [x] 4.3 Add a unit test under `ui/src/hooks/__tests__/` mocking `fetch` for REST and a fake WS to confirm: REST events are seeded first, WS replay duplicates are dropped, novel WS events are appended, `hydrated` flips to `true` after REST resolves.

## 5. UI: ActiveRun hydration gating

- [x] 5.1 Consume `hydrated` from `useRunStream` in `ui/src/components/ActiveRun/ActiveRun.tsx`. While `!hydrated`, render the Pipeline pane with no derived state (either a simple "Loading…" row or the empty `PHASE_TEMPLATE` with no `active`/`done` projections) so the user does not see a misleading "no phase active" flash.
- [x] 5.2 Verify by hand: open a run, navigate to Dashboard, navigate back; the Pipeline pane restores the active phase with its expanded body and ticking duration counter, matching what was shown before navigation.

## 6. UI: Gate redirects back to Active Run

- [x] 6.1 In `ui/src/App.tsx` change the `<ReviewGate onResolved={...} />` prop from `goDashboard` to `() => goRun(runId)`.
- [x] 6.2 Update `ui/src/components/ReviewGate/ReviewGate.test.tsx` (or add a new test) asserting that after a successful approve and after a successful reject, `onResolved` is invoked exactly once and the parent route handler receives the correct runId.

## 7. UI: Request-changes textarea + stacked buttons

- [x] 7.1 In `ui/src/components/ReviewGate/ReviewGate.tsx`, replace the `<input className="review-gate__changes-input">` with `<textarea className="review-gate__changes-input" rows={4}>` preserving the same `value`, `onChange`, and `placeholder`.
- [x] 7.2 In `ui/src/components/ReviewGate/ReviewGate.css`, update `.review-gate__changes-input` to set `resize: vertical`, `min-height` covering at least 4 rows at the base font size, `font-family: inherit`, `width: 100%`. Restructure `.review-gate__action-row` (and wrap the buttons if needed) so the Submit / Cancel buttons render on a row below the textarea instead of inline to its right.
- [x] 7.3 Extend `ReviewGate.test.tsx` to assert: the rendered "Request changes" form contains a `<textarea>` (not an `<input type="text">`), and the test setup that previously used `getByRole('textbox')` still resolves to the textarea.

## 8. Verification

- [x] 8.1 Run `npm test` (or whatever the project's test command is across `server/`, `protocol/`, `ui/`) and confirm all tests pass, including the new ones from sections 1, 2, 3, 4, 6, 7.
- [x] 8.2 Run `npm run lint` and confirm clean. Pay special attention to the CSS lint (`ui/scripts/check-css-prefixes.js`) since `ReviewGate.css` is being edited.
- [ ] 8.3 Manual smoke test (single browser session): (a) start a run, watch phase 1 begin, navigate to Dashboard and back — Pipeline pane is restored, telemetry shows a real "Started" time and the project id; (b) drive the run to a spec+plan gate, click Approve — land on Active Run, see streaming resume; (c) drive another run to a gate, click Request changes, paste a multi-paragraph block of text into the textarea — confirm it grows vertically and the Submit/Cancel buttons stay visible; submit — land on Active Run.
