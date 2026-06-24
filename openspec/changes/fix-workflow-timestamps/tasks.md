## 1. Server schema defaults

- [x] 1.1 Audit `server/src/db.ts` for every `DEFAULT (datetime('now'))` occurrence (currently in `projects`, `repos`, `workspaces` legacy migration, `runs`, `gates`, `prereq_*` tables, the `runs_new` migration block). Compile a definitive list with line numbers.
- [x] 1.2 Replace each occurrence with `DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))`. Apply in both `CREATE TABLE` statements and the additive migration blocks.
- [x] 1.3 Verify no other server file constructs SQLite timestamp values via `datetime('now')` outside `db.ts` (grep `server/src/`). The `UPDATE runs SET completed_at=datetime('now')` style calls in `run/driver.ts:89,99,132` and `gates/...resolved_at=datetime('now')` in `run/driver.ts:137` and `run/sweep.ts:10` must also switch to the `strftime` form.
- [x] 1.4 Add a server-side smoke test (in `server/src/__tests__/`) that inserts a fresh `runs` row, reads it back, and asserts the `created_at` string matches the ISO 8601 UTC regex `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$`.

## 2. UI time helper

- [x] 2.1 Create `ui/src/lib/` directory if it does not exist. Add `ui/src/lib/time.ts` exporting `parseServerTime(s: string): Date` and `formatStreamTime(iso: string): string` per the contracts in design.md §Decision 2 and §Decision 5.
- [x] 2.2 Add unit tests at `ui/src/lib/time.test.ts` covering: ISO with `Z`, ISO with `±HH:MM` offset, legacy `"YYYY-MM-DD HH:MM:SS"` (asserted as UTC), empty string (returns NaN Date), garbage string (returns NaN Date). For `formatStreamTime`, assert the 8-character `HH:MM:SS` output for a fixed UTC moment under a forced local timezone (use `process.env.TZ = 'Europe/Berlin'` in the test setup).

## 3. Route UI consumers through the helper

- [x] 3.1 Grep `ui/src/` for `new Date(` calls operating on server-origin strings. Confirmed call sites today: `ActiveRun.tsx:528` for `run.createdAt`. Sweep for `run.completedAt`, `gate.createdAt`, `gate.resolvedAt`, `project.createdAt`, `repo.createdAt`, anywhere they may already be rendered.
- [x] 3.2 Replace each `new Date(serverString)` with `parseServerTime(serverString)`. Where the call is followed by `.toLocaleTimeString()` / `.toLocaleString()`, keep the formatter unchanged.
- [x] 3.3 Where the helper returns a NaN Date, wrap the renderer to show the existing `—` placeholder rather than `"Invalid Date"`. Add an inline guard or a small wrapper component as fits the call site.

## 4. Stream entry time field

- [x] 4.1 In `ui/src/components/ActiveRun/stream.ts`, extend each variant of `StreamEntry` (`HeaderEntry`, `TextEntry`, `ThinkingEntry`, `ToolEntry`, `FooterEntry`) with `time?: string`.
- [x] 4.2 In `buildStream()`, capture `ev.t` once per outer loop iteration and set it on every entry pushed within that iteration. Apply to text, thinking, tool (tool_use creation only — do **not** overwrite on tool_result mutation in the `user` message branch), and footer. Header keeps `time` unset.
- [x] 4.3 Add unit tests to `ui/src/components/ActiveRun/stream.test.ts` (or create the file if it does not exist) asserting that `time` is propagated correctly for each entry kind, and that tool entries retain the `tool_use` time after a later `tool_result` mutation.

## 5. Render the stream time slot

- [x] 5.1 In `ui/src/components/ActiveRun/ActiveRun.tsx` `renderEntry()`, replace every empty `<span className="active-run__ev-time" />` with `<span className="active-run__ev-time">{entry.time ? formatStreamTime(entry.time) : '—'}</span>` (header keeps the dash; the other four kinds always have a time).
- [x] 5.2 Verify visually in the dev stack (`launch-app` skill) that the column is populated, fits the 70px slot, and is dimmed (existing `--dim` color rule on `.active-run__ev-time`).
- [x] 5.3 If the existing `<span className="active-run__ev-time">—</span>` at `ActiveRun.tsx:456` is for an unrelated row outside `renderEntry()`, leave it as-is.

## 6. Verification and ship

- [x] 6.1 Run full CI from repo root: `npm run typecheck && npm run lint && npm test`.
- [x] 6.2 Launch the dev stack and start any workflow run. Confirm: (a) the "Started" time in the Active Run telemetry matches the system clock; (b) every Live stream row displays `HH:MM:SS` in the time column, with the header row showing `—`.
- [x] 6.3 Smoke-test with a legacy DB if one is at hand (a `state.db` from a prior version): verify the "Started" time on rows written before the schema change still renders correctly via `parseServerTime`'s legacy branch.
- [ ] 6.4 Commit per Conventional Commits (`fix(ui): …` and `fix(server): …` as appropriate, or a single bundled `fix(workflow): correct timestamps in active run`).
