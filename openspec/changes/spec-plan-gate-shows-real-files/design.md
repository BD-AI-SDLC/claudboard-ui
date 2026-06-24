## Context

The feature-workflow SKILL in the meas repo uses `mcp__bosch__gate_request({ kind: "spec+plan", payload: { spec, plan } })` at Phase 1d to pause for human approval before any code is written. The orchestrator (a Sonnet main agent) reaches Phase 1d holding only JSON metadata returned by its sub-agents — `{ specDir, specFiles, scenarioCount }` from `sdd-expert-agent` and `{ planPath, checkpointCount }` from `architect-agent`. The actual spec and plan text live on disk in `<workspaceRoot>/specs/<NNN>-<TICKET>-<slug>/`.

The current payload schema (`protocol/src/types.ts:61-66`) accepts free-text `spec?: string` and `plan?: string`. The SKILL prose tells the orchestrator to "Read the full text" before composing the payload, but doesn't enforce it. The model frequently skips the Read calls and fabricates a plausible-looking summary from the 1a clarifying conversation it has in memory. The user, looking at the gate in the bosch web UI, sees that fabrication instead of what was committed to disk — and approves it. The gate is the workflow's only human checkpoint; it's currently approving something nobody read.

This change moves the responsibility for materialising spec and plan content from the orchestrator (which can hallucinate) to the bosch MCP server (which reads from disk).

## Goals / Non-Goals

**Goals:**

- The bosch web UI's spec+plan gate always renders the actual files written to disk by `sdd-expert-agent` and `architect-agent`.
- The orchestrator cannot satisfy the gate by paraphrasing — the failure mode is removed structurally, not by stricter prose.
- Approved gates carry an immutable snapshot of the spec and plan text at gate-open time (audit trail).
- The UI can refresh content from disk after gate-open, so an out-of-band edit to a spec file is visible to the reviewer.
- Multi-file specs (`business-behavior-spec.md`, `authorization-spec.md`, and any future per-area files) are first-class — each file gets its own tab.

**Non-Goals:**

- Parsing `execution-plan.md` into structured `PlanCheckpoint[]` cards. v1 renders the plan as markdown. Structured rendering is a follow-up that requires either an architect-agent JSON sibling or a server-side parser — out of scope here.
- Editing spec or plan files from the UI. Read-only.
- Multi-workspace gate handling. `workspaceRoot` is a single path per request.
- Backward-compatible support for the old `spec?: string` / `plan?: string` payload shape. The only caller is the SKILL we control.
- Removing the orchestrator's ability to call `Read` on spec files for other purposes. Only the gate payload composition changes.

## Decisions

### Decision: Path manifest, not text content, on the wire

The `spec+plan` payload becomes `{ ticket, workspaceRoot, specDir, specFiles[], planPath }`. The server reads the files; the orchestrator does not pass content.

**Why:** Eliminates the hallucination failure class structurally. If the orchestrator never has to produce the text, it cannot fabricate it. Payload size drops from ~30 KB to ~250 bytes.

**Alternative considered — keep `spec`/`plan` as optional text fields for backward compat:** Rejected. There is exactly one caller (the meas feature-workflow SKILL) and we control it. Leaving the text fields in keeps the hallucination surface alive — a "lazy fallback" path the model can take. Worse than no escape hatch.

**Alternative considered — hash-and-verify (orchestrator sends text + SHA-256; server verifies against disk):** Rejected as a v1. More moving parts, adds a new error class (mismatch), and the orchestrator still has to produce the text — which means hallucinations that *happen* to match disk because the conversation was accurate would slip through unnoticed when conversation drifts.

### Decision: Server reads at gate-request time AND on demand

The MCP `gate_request` handler reads each file once and stores a snapshot in the gate row. The server also exposes `GET /gates/:id/files/:idx` so the UI can re-fetch live content from disk after the gate is open.

**Why:** Two needs, two reads. Snapshot at gate-open is the audit record ("this exact content was approved at HH:MM"). Live re-read on UI refresh handles the case where someone edits a spec file on disk between gate-open and approval — the reviewer should see current state, with a banner if it differs from the snapshot.

**Alternative considered — snapshot-only (no live re-read):** Rejected. Out-of-band edits during review are realistic (a colleague pushes a fix, the user reopens their editor). Showing stale snapshot text without a refresh option means reviewers approve text that doesn't exist anymore.

**Alternative considered — live-only (no snapshot):** Rejected. Loses the audit trail. The gate row needs to preserve "what was approved" for forensic and compliance use later.

### Decision: Path traversal guard at the boundary

The server validates that every requested file path resolves to a real path strictly under `workspaceRoot` (after symlink resolution). Any payload where a path escapes is rejected with a 400-equivalent MCP error before any read happens.

**Why:** The MCP server runs with the user's filesystem privileges. A malicious or buggy orchestrator request like `specDir: "../../../etc"` would otherwise expose arbitrary files in `gate-request` events broadcast over WebSocket. Guard at the trust boundary, once.

**Alternative considered — trust the orchestrator:** Rejected on principle, even though today's orchestrator is well-behaved. The SKILL is editable by anyone who can write to the meas repo; the validator is a cheap defence.

### Decision: UI renders plan as markdown, not structured checkpoints

`ReviewGate.tsx` is reshaped to accept `{ specFiles: { path, content, size, mtime }[], plan: { path, content, size, mtime } }`. Spec files render with the existing Gherkin highlighter inside a tab strip; plan content renders through a markdown component.

**Why:** Ships now. The current placeholder `PlanCheckpoint[]` was never populated by any caller — it was an aspirational shape. Markdown is what's actually on disk and what the user authored mentally. Structured cards can return as a follow-up when there's a producer for them.

**Alternative considered — block this change on the architect-agent emitting `execution-plan.json`:** Rejected. Couples two changes that have different blast radii. Markdown rendering is enough to satisfy "user sees the actual file."

### Decision: Break the schema; no migration path for in-flight gates

`GatePayload` for `kind: 'spec+plan'` becomes a discriminated, required-fields shape. Open gates from before the change are drained or cancelled at deploy time.

**Why:** This is a dev tool. The gates table is local SQLite. There is no fleet of clients, no API contract with external consumers. The only caller is the SKILL in one sibling repo, which is updated in lockstep. A migration path would cost more than the breakage.

**Mitigation:** Note in CHANGELOG; document the "drain open gates before upgrading" step in tasks.md.

## Risks / Trade-offs

- **Risk:** Server now reads files for every gate-request. → Mitigation: spec + plan files are kilobyte-scale and read once at gate-open + once per UI refresh. Negligible vs WebSocket broadcast cost.
- **Risk:** The MCP server's filesystem read could leak content outside the workspace. → Mitigation: path-traversal guard at the boundary (Decision above); reject the request before any read.
- **Risk:** Out-of-band edits during review could let a reviewer approve text that differs from the snapshot. → Mitigation: server compares disk to snapshot on each re-read; UI shows a "drift detected" banner when they diverge; the snapshot remains the audit record.
- **Risk:** Tying the gate to filesystem paths makes future remote-orchestrator setups harder (where the orchestrator and server run on different hosts). → Mitigation: out of scope; the run driver is currently in-process with the MCP server. If we split them later, that's a separate proposal that would reintroduce content-on-the-wire with a hash check.
- **Trade-off:** Plan rendered as markdown loses the "checkpoint card" visual the placeholder hinted at. → Accept; bring it back via a structured-plan follow-up.

## Migration Plan

1. Land the schema change in `protocol/`, then `server/`, then `ui/` (single PR — internal monorepo).
2. Before rolling the new server build, drain or cancel any `paused-gate` runs visible in the dashboard.
3. Ship the new SKILL in meas in a coordinated edit. The SKILL change is small (a payload-shape rewrite in Phase 1d), but it MUST land before the next workflow run, otherwise the old payload shape will be rejected by the new server.
4. Rollback: revert all three repos (this one + meas) to prior tag. No data migration on revert — the snapshot column is additive in SQLite and ignored by older code.

## Open Questions

- Does the server need a configurable file-size cap on spec/plan reads? Realistic specs are a few KB; an attacker-controlled SKILL could request a gigabyte file. Leaning toward a 1 MB hard cap per file, configurable. Decide during implementation.
- Should the drift banner offer a one-click "re-snapshot" to update the audit record, or is the snapshot strictly immutable once written? Default: immutable. Re-opens the audit semantics question if we change it later.
