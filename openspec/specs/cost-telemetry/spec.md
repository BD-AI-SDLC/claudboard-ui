## ADDED Requirements

### Requirement: Plugin resolver locates the active claudboard install

The server SHALL provide a single canonical resolver that returns the active claudboard installation's path, version, and `compute-cost.sh` script path, by reading `~/.claude/plugins/installed_plugins.json` and selecting the highest-version `claudboard@claudboard` entry. When no install is found, the resolver SHALL return `null`. Both the existing claudboard-availability checks (`server/src/bootstrap/plugin-check.ts` and `server/src/claudboard/skill-discovery.ts`) and the cost engine SHALL consume this resolver.

#### Scenario: claudboard is installed
- **WHEN** the resolver is called and `installed_plugins.json` contains a `claudboard@claudboard` entry with `installPath` pointing to an extant directory
- **THEN** the resolver returns `{ installPath, version, computeCostScript }` where `computeCostScript` is `<installPath>/skills/claudboard/scripts/compute-cost.sh`

#### Scenario: multiple versions installed
- **WHEN** `installed_plugins.json` lists multiple versions of `claudboard@claudboard`
- **THEN** the resolver returns the entry with the highest semver

#### Scenario: claudboard is not installed
- **WHEN** `installed_plugins.json` is missing, malformed, or contains no `claudboard@claudboard` entry
- **THEN** the resolver returns `null` and emits no error

#### Scenario: install path is stale
- **WHEN** `installed_plugins.json` references an `installPath` that no longer exists on disk
- **THEN** the resolver returns `null`

### Requirement: Cost engine invokes compute-cost.sh and parses its JSON output

The server SHALL provide a cost engine that spawns `compute-cost.sh` with `--format json` and the given `--since` / optional `--until` ISO-8601 timestamps, against a given session JSONL path, and returns a parsed `CostJson` object on success or `null` on any failure (script exit non-zero, parse error, spawn error, missing script). The engine MUST NOT throw.

#### Scenario: successful compute
- **WHEN** the engine is invoked with a valid script path, a valid JSONL path, and `since` / `until` covering ≥1 assistant turn
- **THEN** the engine spawns `compute-cost.sh --since <ts> --until <ts> --format json <jsonl>`, parses stdout, and returns `{ costUsd, inputTokens, outputTokens, cacheReadTokens, apiCalls, model }`

#### Scenario: script exits non-zero (e.g. schema assertion on empty JSONL)
- **WHEN** `compute-cost.sh` exits with a non-zero code
- **THEN** the engine returns `null` and does not throw

#### Scenario: script output is not parseable JSON
- **WHEN** the script exits 0 but stdout is empty or invalid JSON
- **THEN** the engine returns `null`

#### Scenario: script path is null (claudboard not installed)
- **WHEN** the engine is called with `scriptPath === null`
- **THEN** the engine returns `null` synchronously without spawning anything

### Requirement: Session JSONL path is derived from cwd and session_id

The server SHALL derive the canonical Claude Code session JSONL path by normalizing the run's `cwd` to match Claude Code's own slug convention: every run of one-or-more characters outside `[A-Za-z0-9-]` collapses to a single `-`. The resulting path is `~/.claude/projects/<normalized-cwd>/<sessionId>.jsonl`.

When the fast-path derived file does not exist, the engine SHALL fall back to a single scan of `~/.claude/projects/*/${sessionId}.jsonl` and use the first match. This guards against future changes to Claude Code's slug normalization without paying readdir cost on the happy path.

#### Scenario: standard absolute cwd
- **WHEN** the path derivation is called with `cwd = "/Users/alice/code/myrepo"` and `sessionId = "abc-123"`
- **THEN** it returns `~/.claude/projects/-Users-alice-code-myrepo/abc-123.jsonl`

#### Scenario: cwd containing a dot
- **WHEN** the path derivation is called with `cwd = "/Users/alice/code/myproj.cloud"` and `sessionId = "abc-123"`
- **THEN** it returns `~/.claude/projects/-Users-alice-code-myproj-cloud/abc-123.jsonl` (the `.` is normalized to `-`, matching Claude Code's behavior)

#### Scenario: fast-path miss falls back to sessionId glob
- **WHEN** the regex-derived path does not exist on disk but `~/.claude/projects/<other-slug>/<sessionId>.jsonl` does
- **THEN** the engine uses the matched file rather than reporting "not found"

### Requirement: Cost tracker subscribes to broadcast and captures session_id, phase boundaries, and terminal status

The server SHALL register a single cost-tracker subscriber against `broadcast()` in `ws-server.ts`. The tracker SHALL:
- Capture `session_id` from `transcript-message` events whose payload is a Claude Code `system` message with `subtype: "init"`, keyed by `runId`.
- Record `(phaseNum, phaseTitle, startedAt)` on every `phase-start` event.
- On every `phase-complete` event, asynchronously compute the cost for the slice `[phaseStartedAt, phaseCompletedAt]` and persist a row to `phase_costs`.
- On every `status-change` event whose payload status is `done`, `failed`, or `cancelled`, asynchronously compute the total cost for the slice `[runStartedAt, now]` and update `runs.cost_usd`, `input_tokens`, `output_tokens`.

The tracker MUST NOT block the producer of broadcast events; all cost computation runs asynchronously after the broadcast completes.

#### Scenario: session_id captured from SDK init message
- **WHEN** a `transcript-message` event arrives with `payload.message = { type: 'system', subtype: 'init', session_id: 's1', ... }`
- **THEN** the tracker stores `sessionId='s1'` keyed by that runId

#### Scenario: phase-complete triggers per-phase cost computation
- **WHEN** a `phase-start` event arrives for `num=3, title="Develop"` at `T1`, followed by a `phase-complete` event for `num=3` at `T2`
- **THEN** the tracker invokes the cost engine with `--since T1 --until T2` and inserts one row into `phase_costs` with `(run_id, phase_num=3, phase_title="Develop", cost_usd, ...)`

#### Scenario: terminal status triggers total computation
- **WHEN** a `status-change` event arrives with `payload.status='done'` for a run started at `T0`
- **THEN** the tracker invokes the cost engine with `--since T0` (no `--until`) and updates `runs.cost_usd`, `input_tokens`, `output_tokens` for that runId

#### Scenario: phase-complete before session_id is captured
- **WHEN** a `phase-complete` event arrives before any `system.init` message has been observed for that run
- **THEN** the tracker skips the cost computation for that phase and continues (no crash, no row)

#### Scenario: compute returns null (script missing or non-zero exit)
- **WHEN** the cost engine returns `null` for a `phase-complete`
- **THEN** no row is inserted into `phase_costs` and no `cost-update` event is broadcast

#### Scenario: claudboard not installed at boot
- **WHEN** the resolver returns `null` at server startup
- **THEN** the tracker is registered as a no-op and exactly one `console.warn` is emitted: `cost-telemetry: claudboard plugin not detected; cost capture disabled`

### Requirement: Cost updates are broadcast as a new WsEvent kind

The protocol SHALL define a new `cost-update` WsEvent kind. The cost tracker SHALL broadcast this event after every successful per-phase or total cost computation. The event SHALL be persisted to the run's event log so it replays on WS reconnect.

#### Scenario: per-phase cost-update shape
- **WHEN** the tracker successfully computes a per-phase cost
- **THEN** it calls `broadcast(runId, { run_id, t, kind: 'cost-update', payload: { scope: 'phase', phaseNum, phaseTitle, costUsd, inputTokens, outputTokens, cacheReadTokens, apiCalls, model } })`

#### Scenario: total cost-update shape
- **WHEN** the tracker successfully computes a total cost on terminal status
- **THEN** it calls `broadcast(runId, { run_id, t, kind: 'cost-update', payload: { scope: 'total', costUsd, inputTokens, outputTokens, cacheReadTokens, apiCalls, model } })` with no `phaseNum` / `phaseTitle`

#### Scenario: cost-update events replay to late-joining UI clients
- **WHEN** a client connects to `/api/runs/<id>/stream` after a `cost-update` event has been broadcast
- **THEN** the buffered `cost-update` event is replayed to the new client from the room buffer

### Requirement: Per-phase cost rows are persisted to a new phase_costs table

The server SHALL maintain a `phase_costs` table with the following columns: `id INTEGER PK AUTOINCREMENT`, `run_id TEXT NOT NULL REFERENCES runs(id)`, `phase_num INTEGER NOT NULL`, `phase_title TEXT NOT NULL`, `cost_usd REAL NOT NULL`, `input_tokens INTEGER NOT NULL`, `output_tokens INTEGER NOT NULL`, `cache_read_tokens INTEGER NOT NULL DEFAULT 0`, `api_calls INTEGER NOT NULL`, `model TEXT NOT NULL`, `computed_at TEXT NOT NULL DEFAULT (datetime('now'))`, `UNIQUE(run_id, phase_num)`. The migration SHALL be additive and idempotent.

#### Scenario: fresh install creates the table
- **WHEN** the server boots against a database that has never been migrated
- **THEN** `phase_costs` is created with all columns and the `UNIQUE(run_id, phase_num)` constraint

#### Scenario: existing install adds the table
- **WHEN** the server boots against a pre-existing database without `phase_costs`
- **THEN** `phase_costs` is created via `CREATE TABLE IF NOT EXISTS` without affecting any existing data

#### Scenario: duplicate phase compute does not double-insert
- **WHEN** the tracker computes the same `(run_id, phase_num)` twice (e.g. after a restart that replayed events)
- **THEN** the second insert raises a UNIQUE constraint that is caught and ignored; only the first row remains

### Requirement: Total cost is persisted to a new runs.cost_usd column

The server SHALL add a new `cost_usd REAL` column to the `runs` table, guarded by a `PRAGMA table_info('runs')` check. The existing `cost_cents` column SHALL remain unchanged. The tracker SHALL write `cost_usd` (and the existing `input_tokens` / `output_tokens` columns) on terminal status.

#### Scenario: column is added on existing install
- **WHEN** the server boots against a database whose `runs` table lacks `cost_usd`
- **THEN** `ALTER TABLE runs ADD COLUMN cost_usd REAL` runs and existing rows have `cost_usd = NULL`

#### Scenario: column is preserved on subsequent boot
- **WHEN** the server boots against a database whose `runs` table already has `cost_usd`
- **THEN** the migration is a no-op and existing values are preserved

### Requirement: Run REST response exposes costUsd and phaseCosts

`GET /api/runs/:id` SHALL include `costUsd: number | null` and `phaseCosts: PhaseCost[]` on the response body. The bulk `GET /api/runs` SHALL include `costUsd` on each row but MAY omit `phaseCosts` (callers fetch detail on demand).

#### Scenario: detail endpoint returns both fields
- **WHEN** a client requests `GET /api/runs/<id>` for a completed run
- **THEN** the response includes `costUsd` (number or null) and `phaseCosts` (array, possibly empty)

#### Scenario: list endpoint returns costUsd only
- **WHEN** a client requests `GET /api/runs`
- **THEN** every row in the response includes `costUsd` (number or null); `phaseCosts` is not required

### Requirement: ActiveRun telemetry rail renders a Cost section live

The ActiveRun UI SHALL render a Cost section in the right-hand telemetry rail, positioned below the existing Run info / Events sections. The section SHALL show one Total row and one row per phase, plus a Tokens (in/out) and Model footer. Per-phase rows SHALL appear live as `cost-update` events arrive over WS, and SHALL hydrate from `run.phaseCosts` on initial REST load. Empty phases (cost exactly `$0.00`) SHALL still render their row.

#### Scenario: rail renders Total and per-phase rows
- **WHEN** the run has received `cost-update` events for phases 1, 2, and 3 with costs `0.42`, `0.05`, `2.31`, and a total `cost-update` of `2.78`
- **THEN** the Cost section renders `Total $2.78`, `1 · <title> $0.42`, `2 · <title> $0.05`, `3 · <title> $2.31`, plus the tokens/model footer from the most recent event

#### Scenario: rail hydrates from REST on initial load
- **WHEN** the page is loaded for a completed run whose `GET /api/runs/<id>` returns non-empty `phaseCosts` and `costUsd`
- **THEN** the Cost section is fully populated immediately, before any WS events arrive

#### Scenario: zero-cost phase still renders
- **WHEN** a `cost-update` event arrives with `scope='phase', phaseNum=2, costUsd=0`
- **THEN** the rail renders `2 · <title> $0.00` (not hidden, not blank)

#### Scenario: Cost section hidden when claudboard absent
- **WHEN** the run has no `cost-update` events AND `run.phaseCosts` is empty AND `run.costUsd` is null
- **THEN** the Cost section is not rendered at all (no header, no rows)

### Requirement: Recent runs panel renders a cost column on every row

The Recent runs panel SHALL render a cost column on every row. Present `costUsd` values SHALL render as `$X.XX` via `formatUsd`. Null `costUsd` values SHALL render as `—`. Rows whose `status === 'running'` MAY render a small skeleton placeholder instead of the dash.

#### Scenario: row with cost
- **WHEN** a run has `costUsd = 4.23`
- **THEN** the row renders `$4.23` in the cost column

#### Scenario: completed row with no cost (no claudboard)
- **WHEN** a run has `status = 'done'` and `costUsd = null`
- **THEN** the row renders `—` in the cost column

#### Scenario: running row with no cost yet
- **WHEN** a run has `status = 'running'` and `costUsd = null`
- **THEN** the row renders a small skeleton placeholder (e.g. `…`) in the cost column

### Requirement: System remains functional when claudboard is absent

When the plugin resolver returns `null`, all runs SHALL complete successfully without cost data. The server SHALL emit exactly one boot-time warning. The UI SHALL hide the Cost section in ActiveRun and render `—` in the Recent runs cost column.

#### Scenario: feature run completes without claudboard
- **WHEN** the user starts a feature run on a server where the resolver returns `null`
- **THEN** the run completes normally; `runs.cost_usd` is `NULL`; `phase_costs` has no rows; no `cost-update` events are broadcast; the ActiveRun rail shows no Cost section

#### Scenario: prereq run completes without claudboard
- **WHEN** a prereq CLI run completes on a server where the resolver returns `null`
- **THEN** the run completes normally; `runs.cost_usd` is `NULL`; no errors are logged after the single boot warning
