# Design: cost telemetry

## Context

`runs.cost_cents`, `runs.input_tokens`, `runs.output_tokens` already exist in the SQLite schema (`server/src/db.ts:130,145`) and are surfaced on the `Run` protocol type — but nothing in the codebase ever writes them. The UI's stream parser at `ui/src/components/ActiveRun/stream.ts:134` already understands the SDK's `result` message and renders a one-shot footer with cost, but that data is never persisted and there is no telemetry-rail or recent-runs surface.

The claudboard plugin ships a hardened cost calculator at `~/.claude/plugins/cache/claudboard/claudboard/<ver>/skills/claudboard/scripts/compute-cost.sh` which:
- deduplicates assistant turns by `requestId` (Claude Code writes one JSONL line per content block; naive sums over-count 3–4×),
- handles 5m/1h cache writes, cache reads, and per-model pricing from its bundled `pricing.md`,
- accepts `--since`/`--until` ISO-8601 timestamps for slicing,
- emits compact JSON with `--format json`.

Both this project's run paths spawn Claude Code under the hood:
- `server/src/run/driver.ts:60-86` — SDK `query()`, transcript at `~/.bosch-sdlc/transcripts/<runId>.jsonl` (wrapper) AND canonical session JSONL at `~/.claude/projects/<cwd-slug>/<sessionId>.jsonl` (the rich one compute-cost.sh needs).
- `server/src/prereq/cli-runner.ts:149-167` — direct `claude --output-format stream-json`, same dual-file output.

The first `system` message in both streams carries `session_id`, confirmed by inspecting actual `~/.bosch-sdlc/transcripts/*.jsonl` files. We have everything we need to invoke `compute-cost.sh` from the server with no changes to the run loops themselves.

This change layers a passive subscriber on top of the existing `broadcast()` egress, persists cost in two shapes (per-phase rows + per-run total), and surfaces both in the existing UI.

## Goals / Non-Goals

**Goals:**
- Capture per-phase and per-run cost for every run launched by the server, automatically and without changing the run-loop semantics.
- Render cost live as phases complete — not just at run end.
- Show cost on every Recent runs row.
- Be a no-op (with one boot warning, no UI distraction) when claudboard isn't installed; runs must continue normally.
- Fix the latent `isClaudboardInstalled` path bug in the same change since we're consolidating plugin-path logic anyway.

**Non-Goals:**
- Migrating existing `Run.cost` (USD) / `PrereqRecord.cost` (cents) to a single unit. The cents-vs-USD inconsistency is real but out of scope here — we introduce `costUsd` as a new field with explicit semantics and leave the old fields as-is.
- Authoring a Stop hook for `feature-workflow`. compute-cost.sh runs independently of any hook; we don't need one.
- Parsing the claudboard hook's `systemMessage` text. We compute independently from the JSONL.
- Budgets, alerts, limits, or per-project/per-day aggregation. Single-run telemetry only.
- Replicating pricing logic in TypeScript. We treat `compute-cost.sh` as the source of truth.

## Decisions

### D1. Reuse claudboard's `compute-cost.sh` rather than reimplementing in TypeScript

The script is hardened (handles cache breakdowns, request-id dedup, schema-assertion), updated by claudboard releases, and the source of pricing data lives alongside it (`pricing.md`). Reimplementing in TS would either duplicate ~150 LOC of careful jq + awk or drift from claudboard's pricing updates. Cost: one external script dependency + a ~50–300ms shell spawn per phase. Worth it.

**Alternative considered:** parse `total_cost_usd` directly from the SDK/CLI `result` message (already available, no spawn). Rejected because that gives ONLY the run total — no per-phase breakdown, which is the user-facing feature.

### D2. Subscriber-tracker architecture (Option C from explore)

Add a small `subscribe(handler)` API alongside `broadcast` in `server/src/ws-server.ts`. A new `server/src/cost/tracker.ts` module subscribes once at boot. This means:
- The MCP server's `emit()` (`server/src/gate/mcp-server.ts:89-97`) and the SDK driver's transcript broadcast (`server/src/run/driver.ts:78-86`) don't change.
- The CLI runner's broadcast (`server/src/prereq/cli-runner.ts:215-221`) doesn't change.
- All cost logic lives in one file, testable in isolation by injecting a fake `computeFn`.

**Alternative A** (inline in both runners): rejected — duplicates logic in two places, harder to test, mixes concerns.
**Alternative B** (inline in `mcp-server.ts emit()`): rejected — only the SDK path goes through MCP; prereq CLI runs would miss out.

### D3. Live per-phase compute, fire-and-forget

On every `phase-complete`, spawn `compute-cost.sh --since <phaseStart> --until <phaseComplete> --format json`. Await the spawn in the tracker (not in the run loop), persist, broadcast. The run loop never waits on cost.

**Alternative considered:** batch at run end (one spawn, all rows at once). Rejected — loses the live feedback the user explicitly asked for ("per phase, so we can have a phase cost and total cost").
**Alternative considered:** live + final reconciliation pass. Rejected as marginal — sum of phase rows is the total; if a few turns leak past the last `phase-complete`, the terminal-status total catches them.

### D4. New `costUsd` field; do not migrate existing `cost` fields

Today: `Run.cost` is USD (`server/src/run/serialize.ts:39` divides by 100), `PrereqRecord.cost` is raw cents, UI `formatCost` (`ui/src/components/Project/OperationCard.tsx:49`) assumes cents. This inconsistency exists in production; touching it would force a coordinated change to consumers and tests that's out of scope here.

Introduce:
- `Run.costUsd: number | null` (new authoritative field) + `Run.phaseCosts: PhaseCost[]`
- `PhaseCost.costUsd: number`
- DB: `runs.cost_usd REAL` (additive, nullable), new `phase_costs` table with `cost_usd REAL NOT NULL`
- UI: new `formatUsd(n: number)` in `ui/src/util/format.ts`. Extract existing `formatCost(cents)` from `OperationCard.tsx:49` into the same util file as a separate function (keep cents semantics for prereqs).

The old `Run.cost` field continues to be `null` because nothing has ever written it; this change does not start writing it either. Future work can deprecate `cost` once consumers have migrated.

### D5. Single canonical claudboard resolver; fix latent bug

`server/src/bootstrap/plugin-check.ts:6` (`CLAUDBOARD_SENTINEL`) and `server/src/claudboard/skill-discovery.ts:5` (`PLUGIN_PATH`) both point at `~/.claude/plugins/marketplaces/claudboard/...` — but actual installs are at `~/.claude/plugins/cache/claudboard/claudboard/<ver>/`. On any machine that installed claudboard via the standard plugin marketplace, both functions return `false` despite claudboard being installed. This is a latent bug; nothing currently breaks because callers degrade gracefully, but our new cost engine can't degrade if the resolver lies.

New `server/src/cost/resolver.ts` reads `~/.claude/plugins/installed_plugins.json`, picks the active claudboard install (highest semver under `claudboard@claudboard`), and returns:
```ts
{ installPath: string; version: string; computeCostScript: string } | null
```

Both existing checks switch to a thin adapter that calls the resolver and returns the boolean/`ClaudboardAvailability` shape they advertise. Tests update accordingly.

### D6. Session JSONL path derivation

The slug comes from `target` (the run's cwd, already stored on the run row). The `sessionId` comes from the first `system.subtype === 'init'` message in the stream — both paths deliver this through the `transcript-message` event.

**Slug rule** — mirrors Claude Code's own normalization: every run of one-or-more characters outside `[A-Za-z0-9-]` collapses to a single `-`. Equivalent regex: `cwd.replace(/[^A-Za-z0-9-]+/g, '-')`.

The earlier version of this design ("`target.replaceAll('/','-')`, matching the claudboard Stop hook's `sed`") was wrong: it only handled `/`. Any cwd containing a `.` (e.g. `craftsphere.cloud`) or other special character produced a slug that didn't match what Claude Code actually writes to disk, causing `computeCost` to receive a non-existent file path and return `null` silently. The hook has the same latent bug; we don't inherit it.

**Hybrid lookup** — `sessionJsonlPath()` returns the regex-derived path (fast path; correct in >95% of cases). The engine then tries that path first; if it doesn't exist, it falls back to a one-shot scan of `~/.claude/projects/*/${sessionId}.jsonl` and uses the first match. The glob fallback is ~50 readdirs at ms-scale and only runs when the fast path misses — so cost stays negligible while we stay robust to any future change in Claude Code's slug rules.

Unit-tested with fixture cwd strings (including a `.` case and a space case); the production path uses `path.join` only after slug derivation, so we avoid filesystem semantics for the slug step itself.

### D7. No-claudboard UX: hide, don't explain

When `resolver()` returns `null`:
- Tracker no-ops every event handler.
- One `console.warn` at server boot: `cost-telemetry: claudboard plugin not detected; cost capture disabled`.
- UI hides the Cost section in ActiveRun entirely (no error UI, no install prompt).
- Recent runs column still renders — `costUsd` is just always `null` → em-dash.

Rationale: this is a power-user feature; an install prompt for an optional plugin in the telemetry rail of every run would be noise.

### D8. Live-update protocol shape

New `CostUpdateEvent` added to `protocol/src/events.ts`:
```ts
interface CostUpdateEvent extends WsEventBase {
  kind: 'cost-update'
  payload: {
    scope: 'phase' | 'total'
    phaseNum?: number       // present iff scope === 'phase'
    phaseTitle?: string
    costUsd: number
    inputTokens: number
    outputTokens: number
    cacheReadTokens: number
    apiCalls: number
    model: string
  }
}
```
The UI accumulates `cost-update` events by `(scope, phaseNum)` and renders. On REST hydration (refresh, terminal runs), `run.phaseCosts` from `GET /api/runs/:id` seeds the same data structure.

## Risks / Trade-offs

- **Timestamp skew at `--since/--until` boundaries** → Our `new Date().toISOString()` (event emission time) vs. Claude Code's own clock for JSONL turns. Typically sub-second; could misattribute the first assistant turn of phase N+1 to phase N's bucket. **Mitigation:** acceptable; document; per-phase sums equal the run total to the cent on the most common case (single-machine runs). If meaningful drift shows up in QA, we can widen the `--until` by 100ms or use the JSONL timestamps directly via `compute-cost.sh` (it already supports it).

- **Race: terminal-status compute may miss last 1–2 turns** → If the SDK fires `done` before Claude Code flushes the last assistant turn to the JSONL, the total compute can be slightly low. **Mitigation:** per-phase rows still sum correctly; a known ~$0.01-class discrepancy is acceptable for v1. If unacceptable, add a 500ms grace before the total spawn (single place to change).

- **Shell spawn latency (~50–300ms per phase)** → Fire-and-forget; never blocks the run loop. Cost rail updates can lag the `phase-complete` event by up to a couple hundred ms. **Mitigation:** acceptable; visually equivalent to other progressive UI updates already in the rail.

- **`compute-cost.sh` schema assertion can exit non-zero on the very first assistant turn** → e.g. an empty or pre-init JSONL. **Mitigation:** the engine treats any non-zero exit as a `null` result; the tracker logs at debug level only and skips the row; no UI error.

- **External script + dynamic install path** → claudboard could update its layout in a future release. **Mitigation:** the resolver consumes `installed_plugins.json` (the marketplace-managed manifest), not a hard-coded relative path; if claudboard moves the script, only the resolver's `computeCostScript` join changes.

- **Cosmetic duplication during mixed runs** → If the user happens to be running `/opsx:apply` from their own shell while a server run is in flight, claudboard's own Stop hook will print a `systemMessage` line into the user's terminal that may also leak into the server's transcript. Different sinks, no functional conflict. **Mitigation:** none needed; cosmetic only.

- **Two `isClaudboardInstalled()` callers change behavior simultaneously** → Today both return `false` on this machine; after the fix they return `true`. This may flip the bootstrap path (`server/src/bootstrap/state.ts:60`) and the `/api/claudboard/available` route's response. **Mitigation:** existing tests at `server/src/bootstrap/__tests__/state.test.ts` mock `isClaudboardInstalled`; production behavior change is the intended fix (the function is *supposed* to return `true` when claudboard is installed). Manual QA: confirm bootstrap proceeds through `ready` state and the claudboard prereq route returns 200 on a fresh-install machine.

## Migration Plan

1. Schema migration is additive and re-runnable: `CREATE TABLE IF NOT EXISTS phase_costs (...)` and `PRAGMA table_info('runs')`-guarded `ALTER TABLE runs ADD COLUMN cost_usd REAL`. No data backfill.
2. Existing runs (rows with `cost_usd IS NULL` and no `phase_costs` entries) render with em-dash / hidden section — no migration needed for historical data.
3. Rollback: drop the cost subscriber registration in `server/src/app.ts`; the `phase_costs` table and `cost_usd` column can stay (no harm).

## Open Questions

*(None at proposal time. All design choices locked in explore mode.)*
