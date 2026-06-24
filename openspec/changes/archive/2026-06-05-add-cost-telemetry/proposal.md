# Add cost telemetry

## Why

The server already has the data plumbing for cost (`runs.cost_cents`, `runs.input_tokens`, `runs.output_tokens` exist at `server/src/db.ts:130, :145`), and the protocol/Run type already exposes the fields — but nothing ever writes them. Users running a feature workflow or a claudboard prereq today have no idea what their run cost. The claudboard plugin ships a precise per-session cost calculator (`compute-cost.sh`, dedupes assistant turns by `requestId`, reads its own `pricing.md`) which both our SDK and CLI run paths can target because both spawn Claude Code as a subprocess and produce the canonical session JSONL at `~/.claude/projects/<cwd-slug>/<sessionId>.jsonl`.

We want a clear, live view of cost per phase and per run inside the existing UI, computed from the existing tool — not a new ML model, not a new budget system.

## What Changes

- **New cost engine + tracker on the server**: a subscriber attached to the existing `broadcast()` egress in `server/src/ws-server.ts:18` listens for `phase-start` / `phase-complete` / terminal `status-change` events, captures `session_id` from the SDK/CLI `system.init` message, spawns `compute-cost.sh --since <ts> [--until <ts>] --format json`, persists results, and broadcasts a new `cost-update` WS event.
- **Live per-phase cost**: every `phase-complete` triggers one spawn, broadcasts `cost-update { scope: 'phase' }`; the UI rail renders one row per phase as they finish.
- **Total cost on terminal status**: on `done|failed|cancelled`, one final spawn writes `runs.cost_usd` and broadcasts `cost-update { scope: 'total' }`.
- **New DB column** `runs.cost_usd REAL` (additive, behind `PRAGMA table_info` guard per project convention). Existing `runs.cost_cents` column is left untouched.
- **New table** `phase_costs (id, run_id, phase_num, phase_title, cost_usd, input_tokens, output_tokens, cache_read_tokens, api_calls, model, computed_at, UNIQUE(run_id, phase_num))`.
- **New protocol types**: `PhaseCost` interface, `Run.costUsd: number | null`, `Run.phaseCosts: PhaseCost[]`, and a `CostUpdateEvent` added to `WsEventKind` and the `WsEvent` union at `protocol/src/events.ts:99-111`.
- **Single canonical claudboard resolver** at `server/src/cost/resolver.ts`. Both existing `isClaudboardInstalled` implementations (`server/src/bootstrap/plugin-check.ts:17` and `server/src/claudboard/skill-discovery.ts:15`) — which currently point at the wrong path `~/.claude/plugins/marketplaces/claudboard/...` and silently return `false` even when claudboard IS installed — switch to the new resolver. **(Latent bug fix.)**
- **ActiveRun telemetry rail** (`ui/src/components/ActiveRun/ActiveRun.tsx:444-508`): new "Cost" section below the existing "Run info" / "Events" sections, showing Total + per-phase rows + tokens/model footer. Renders live from accumulated `cost-update` events; hydrates from `run.phaseCosts` on initial REST load.
- **Recent runs cost column** in `ui/src/components/Dashboard/RecentRunsPanel.tsx` — new trailing column showing `formatUsd(run.costUsd)`, em-dash for null, skeleton spinner for `running`.
- **No-claudboard graceful path**: resolver returns `null` → tracker becomes a no-op → UI hides the Cost section entirely → server logs ONE boot warning. Runs continue normally.

Not changing: existing `Run.cost` / `PrereqRecord.cost` semantics, the claudboard Stop hook itself, the SDK/CLI run loops, the WS event log shape (additive only).

## Capabilities

### New Capabilities
- `cost-telemetry`: per-phase and per-run cost capture for any Claude Code run launched by the server (SDK or CLI), with live WS updates and UI surfacing in ActiveRun + Recent runs.

### Modified Capabilities
*(None. The existing `run-driver`, `prereq-runner`, `workflow-instrumentation`, and `web-ui` capabilities are touched by code but their spec-level requirements are unchanged — they continue to do what they already do; we layer a passive subscriber on top.)*

## Impact

- **Protocol** (`protocol/src/events.ts`, `protocol/src/types.ts`): new `CostUpdateEvent`, new `PhaseCost`, two added fields on `Run`. All additive — no breaking change for existing consumers.
- **Server** (`server/src/`): new `cost/` module (`resolver.ts`, `engine.ts`, `tracker.ts`); a `subscribe()` API added to `ws-server.ts`; `db.ts` gets one new table + one additive column; `run/serialize.ts` populates the new fields; `run/routes.ts` includes `phaseCosts` on `GET /api/runs/:id`. Two existing `isClaudboardInstalled()` functions swap to the new resolver.
- **UI** (`ui/src/`): new `util/format.ts` with `formatUsd`; ActiveRun rail gains the Cost section; RecentRunsPanel grid gains a column; CSS updates in both component files.
- **External dependency**: relies on `~/.claude/plugins/cache/claudboard/claudboard/<ver>/skills/claudboard/scripts/compute-cost.sh` being present. Absence is handled gracefully (Cost section hidden, one warning logged, runs unaffected).
- **No data loss / no migration risk**: existing `cost_cents` rows untouched; new column nullable; new table additive.
- **Performance**: ~50–300ms shell spawn per `phase-complete` (fire-and-forget, never blocks the run loop). One additional spawn at terminal status. No impact on non-feature, non-prereq workloads.
