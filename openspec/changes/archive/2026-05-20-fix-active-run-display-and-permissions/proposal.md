## Why

Three independent regressions were observed running the feature workflow against `/Users/LUP1BG/Documents/BoschProjects/meas/`:

1. **The agent stalls on every Bash call** even though the driver sets `permissionMode: 'bypassPermissions'` (`server/src/run/driver.ts:60`). The transcript records a top-level error (`parent_tool_use_id: null`) of the form `"Claude requested permissions to use Bash, but you haven't granted it yet."` In a headless server context the SDK's bypass-mode acceptance flow can't run, so bypass silently falls back to default and there is no terminal to grant the prompt — the run freezes with no UI signal.
2. **The Live stream pane shows raw SDK message JSONs.** `buildStreamFromEvents` in `ui/src/components/ActiveRun/ActiveRun.tsx:179` stringifies the entire SDK message envelope per line, producing output like `{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","name":"Bash","input":{"command":"…"}}]}}`. It's unusable for following what the agent is doing.
3. **The phase / agent duration counters stay frozen at `0s`.** `elapsed(ph.startedAt)` (`ui/src/components/ActiveRun/ActiveRun.tsx:246`) reads `Date.now()` at render time, but the component only re-renders on a new WebSocket event or the 10-second REST poll. Between events the timer is visually frozen, which is most of the time.

A first round of fixes for the above landed (tasks 1-5 below). A second run against the same target surfaced three more issues in the Pipeline pane on the same screen:

4. **The duration counters are STILL pinned at `0s`** even with the 1-second tick effect from task 4. The root cause is upstream of the tick: `buildPipelineFromEvents` (`ui/src/components/ActiveRun/ActiveRun.tsx:99,106,117,125`) bakes `Date.now()` into `startedAt` / `completedAt` on every call. Because the function builds a fresh `Map<number, PhaseState>` on every render and never persists state across renders, `startedAt` is re-assigned to the current clock each tick. `elapsed()` then computes `Date.now() − Date.now() ≈ 0`. The tick fires correctly; it just makes the bug evaluate more frequently. WebSocket events already carry an ISO timestamp (`WsEventBase.t` in `protocol/src/events.ts:17`) — the builder should use it.
5. **The active phase body collapses when no sub-agent has fired yet.** The JSX condition at `ui/src/components/ActiveRun/ActiveRun.tsx:274` is `(ph.status === 'active' || ph.status === 'gate') && ph.agents.length > 0`. Until the orchestrator spawns a sub-agent via `Task` — which in Phase 1 doesn't happen until 1a-ws — the agents body is empty and the phase row degenerates to just its title and (broken) timer. Visually the run looks idle while the orchestrator is busy reading the JIRA ticket, parsing config, and asking clarification questions.
6. **The main orchestrator's work is invisible because no event represents it.** Sub-agents call `mcp__bosch__agent_start` / `agent_complete`; the orchestrator does not, because it isn't itself a `Task` spawn. The skill *does* emit `checkpoint_start` / `checkpoint_complete` for sub-phases like "1a. Clarify", "1c. Plan" — but `buildPipelineFromEvents` only handles phase + agent + gate events. Checkpoint events are dropped on the floor. There is no visual indication of *what the orchestrator is doing right now* within a phase.

Six issues across three layers, but they share one user-facing symptom: the Active Run screen looks broken on a real workflow run.

## What Changes

- **Driver explicitly grants every tool call via a `canUseTool` callback.** `runFeature` passes `canUseTool: async (_name, input) => ({ behavior: 'allow', updatedInput: input })` to `query()`. The callback is consulted whenever the SDK would otherwise prompt, regardless of `permissionMode`, so behavior is deterministic across the bypass-mode acceptance discrepancy described above. The blanket allow is acceptable for this dev tool: `cwd` is already pinned to the project path the user explicitly opened, and the only irreversible operation that matters in the target repos (force-push to master) is blocked by the git remote, not by the agent harness.
- **The Live stream pane renders SDK messages as structured entries** instead of stringified JSON. Each entry is one of: session header (model + tool count), agent text bubble, tool call (`⏺ ToolName(argSummary)` plus a 3-line `⎿ resultPreview`), thinking block (dimmed, always visible — no toggle in this iteration), or run footer (duration + cost). Tool calls and their matching `tool_result` are paired by `tool_use_id`. Messages with `parent_tool_use_id` set are indented one level under their parent `Task` call and labeled with the parent task's `subagent_type`. The message-walking logic is extracted from `ActiveRun.tsx` into a new `ui/src/components/ActiveRun/stream.ts` module so it can be unit-tested.
- **The Active Run screen ticks once per second** while the run is in a non-terminal status. A single `useEffect` interval drives a tick state, forcing re-renders that unfreeze both the phase durations (`ph.startedAt`) and the agent durations (`a.startedAt`). When the run reaches `done` or `failed`, the interval is cleared. The `elapsed()` helper learns a `completedAt` upper bound so finished phases freeze at their final duration instead of growing forever after completion.
- **`buildPipelineFromEvents` reads event timestamps, not wall-clock.** All four `Date.now()` sites inside the builder switch to `new Date(ev.t).getTime()`. With this fix, repeated calls during re-renders produce stable values, the elapsed counters actually advance once per second (driven by the existing tick), and completed phases freeze at their real completion times rather than at "whenever the user last had the tab focused."
- **The active phase body always expands** while the phase is `active` or `gate`. The `ph.agents.length > 0` clause is dropped from the JSX condition so the body renders even when empty — consistent with the user's mental model of "the phase has begun, show me what's happening."
- **A synthetic `main` row represents orchestrator activity per phase.** Every phase grows an implicit first row labeled `main` with `op` set to the most recent open checkpoint title within that phase. The row is populated by walking `checkpoint-start` / `checkpoint-complete` events (currently ignored). When no checkpoint is yet open, `op` falls back to `"orchestrating"`. The row's `startedAt` equals the phase's, and its `completedAt` mirrors the phase's, so the timer advances with the phase and freezes when the phase completes. Sub-agent rows continue to render below it.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `run-driver`: A new requirement is added stating the driver MUST register a `canUseTool` callback on the `query()` call that approves every tool invocation. This is additive to the existing in-flight changes to `permissionMode` and does not conflict with them — the callback is the deterministic grant mechanism; `permissionMode` becomes informational.
- `web-ui`: Two new requirements are added on top of the existing "Five screens at visual parity with bosch-workflow" requirement: one specifies the Active Run Live stream render contract (structured entries replacing raw JSON), and one specifies that Active Run duration counters tick once per second while the run is non-terminal.

## Impact

- **Code edited.**
  - `server/src/run/driver.ts` — `query()` `options` gains a `canUseTool` callback (+3 lines net).
  - `ui/src/components/ActiveRun/ActiveRun.tsx` — first round (tasks 1-5): `buildStreamFromEvents` and the inline `TranscriptLine`/`SdkMessage` types are removed (lines ~138–184); the JSX in the Live stream pane (lines ~284–304) re-renders the new `StreamEntry[]` shape; a `useEffect` tick is added near the top of the component; `elapsed()` gains an optional `completedAt` parameter and the call sites at lines 246 and 262 pass it. Second round (tasks 6-8): `buildPipelineFromEvents` rewritten — four `Date.now()` sites switched to `new Date(ev.t).getTime()`, two new branches handle `checkpoint-start` / `checkpoint-complete`, `PhaseState` grows a `currentCheckpoint?: string` field, a synthetic `main` row is prepended to each active phase; the JSX condition at line 274 loses its `ph.agents.length > 0` clause. Net diff roughly `+270 / −70`.
  - `ui/src/components/ActiveRun/ActiveRun.css` — new classes for the four entry kinds, dimmed thinking, indent for sub-agent rows, and the `⎿` continuation glyph.
- **Code added.**
  - `ui/src/components/ActiveRun/stream.ts` — pure module exporting `buildStream(events: WsEvent[]): StreamEntry[]` and the entry types. No React imports.
  - `ui/src/components/ActiveRun/stream.test.ts` — Vitest unit tests covering: (a) text-only assistant message, (b) `Bash` tool_use paired with its `tool_result`, (c) `Task` tool_use with two child messages emitted under it, (d) `is_error` tool_result rendered with the error flag, (e) `system` init produces a single header, `result` produces a single footer.
- **Code unchanged.**
  - The WebSocket protocol — no new event kinds, no schema changes; we render the same `transcript-message` payloads differently, and the previously-ignored `checkpoint-start` / `checkpoint-complete` events are now consumed by the UI.
  - The MCP gate bridge — untouched.
  - The Telemetry pane on Active Run — untouched (the tick fix re-renders it too, which is the desired side effect).
  - `permissionMode` value stays whatever the in-flight `unify-workspace-as-single-project` change settles on; this change does not re-litigate it.
- **No protocol / DB / REST changes. No new runtime dependencies.**
- **Out of scope.**
  - Pattern denylist in `canUseTool` (e.g. block `rm -rf /`, `git push --force`). Deferred; reconsider when a real incident motivates it.
  - Markdown rendering inside text bubbles, syntax highlighting in tool results, dedicated diff view for `Edit` results. Reserved for a "full Claude Code parity" pass; today's target is 70% parity.
  - "Hide thinking" toggle in the pane head. ~30 min to add later if the dimmed-visible default proves noisy.
  - Click-to-expand for collapsed tool results beyond the 3-line preview. In scope of the renderer but not required for tests to pass — implementer's judgement call during tasks 2.x.
  - Re-investigating which `permissionMode` value the SDK actually honors in headless mode. The `canUseTool` callback makes that question moot for this run path.
