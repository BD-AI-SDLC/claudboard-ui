## ADDED Requirements

### Requirement: Active Run Live stream renders SDK messages as structured entries

The Active Run screen's Live stream pane SHALL render each `transcript-message` WebSocket event as one or more structured entries derived from the SDK message envelope. The pane SHALL NOT display raw `JSON.stringify(message)` output for any message type.

The renderer SHALL produce a flat ordered list of entries of these kinds, each rendered as a distinct row:

- **header** — emitted once per run when the first `system` (init) message arrives. Shows the model name and the count of tools the SDK reported as available.
- **text** — emitted for each `text` block inside an `assistant` message's `content` array. Shows the agent label and the text with newlines preserved.
- **thinking** — emitted for each `thinking` block inside an `assistant` message's `content`. Shows the agent label and the thinking text, rendered with reduced visual emphasis (dimmed foreground). Thinking blocks are visible by default with no UI toggle.
- **tool** — emitted for each `tool_use` block inside an `assistant` message's `content`. Shows `⏺ <toolName>(<argSummary>)` on the primary line and `⎿ <resultPreview>` on a continuation line when the matching `tool_result` has been seen. The matching `tool_result` SHALL be located by `tool_use_id` and SHALL mutate the same entry rather than producing a separate entry. When `tool_result.is_error` is true the entry SHALL render with an error visual class.
- **footer** — emitted once per run when the SDK emits a `result` message. Shows the run duration in seconds and the total cost in USD.

Sub-agent messages (those whose envelope has a non-null `parent_tool_use_id`) SHALL be:

- labeled with the parent `Task` tool's `subagent_type` (falling back to its `description` and then to the literal string `"sub"`), and
- rendered indented one level deeper than top-level messages.

Top-level messages (envelope `parent_tool_use_id` is null) SHALL be labeled `"main"` and rendered at depth zero.

The argument summary SHALL be tool-aware:

- `Bash` → first line of `command`, truncated to 60 characters with `…` suffix when truncated
- `Read` / `Write` / `Edit` → the `file_path`
- `Grep` / `Glob` → the `pattern`
- `Task` → the `subagent_type` (falling back to `description`)
- Any other tool → the first key=value pair of the input, truncated to 60 characters

The result preview SHALL be tool-aware:

- For `Read`, render `"<n> lines"` where n is the line count of the result content (the file contents themselves are noise in the stream).
- For every other tool, render the first 3 lines of the normalized result content, each truncated to 200 characters, with a trailing `…` when content was elided.

The message-walking logic that produces the entry list SHALL live in a separate module `ui/src/components/ActiveRun/stream.ts` exporting a pure function `buildStream(events: WsEvent[]): StreamEntry[]` with no React imports. This module SHALL have unit tests covering each entry kind, sub-agent indentation, and error result flagging.

#### Scenario: Bash call with result renders as one paired tool entry

- **GIVEN** the SDK emits an assistant message containing a `tool_use` block with `name: "Bash"`, `id: "toolu_x"`, `input: { command: "ls server/src" }`, followed by a user message containing a `tool_result` with `tool_use_id: "toolu_x"`, `content: "app.ts\nbin.ts\ndb.ts\nws-server.ts"`, `is_error: false`
- **WHEN** the Live stream renders
- **THEN** exactly one tool entry appears with `toolName = "Bash"`, `argSummary = "ls server/src"`, and `resultPreview` containing the first 3 lines of the result
- **AND** the entry is rendered at depth zero with agent label `"main"`
- **AND** no `{"type":"tool_use",…}` JSON appears anywhere in the pane

#### Scenario: Sub-agent messages are indented and labeled by subagent_type

- **GIVEN** the top-level agent emits a `tool_use` for `Task` with `id: "toolu_task1"`, `input: { subagent_type: "sdd-expert-agent", description: "Generate BDD spec", prompt: "..." }`
- **AND** the SDK subsequently emits two assistant messages with `parent_tool_use_id: "toolu_task1"` — one containing a text block and one containing a `tool_use` block for `Write` with `file_path: "specs/foo.feature"`
- **WHEN** the Live stream renders
- **THEN** a top-level tool entry appears at depth 0 with `toolName = "Task"` and `argSummary = "sdd-expert-agent"`
- **AND** below it, two entries appear at depth 1 with agent label `"sdd-expert-agent"`: one text entry and one tool entry showing `Write(specs/foo.feature)`

#### Scenario: tool_result with is_error renders with an error class

- **GIVEN** a tool entry was emitted for a `Bash` `tool_use` with id `toolu_y`
- **WHEN** a `tool_result` arrives with `tool_use_id: "toolu_y"` and `is_error: true`
- **THEN** the same tool entry is mutated so its `isError` field is true
- **AND** the rendered row carries the `active-run__ev--error` (or equivalent error) class so the failure is visually distinct

#### Scenario: Thinking blocks render dimmed and always visible

- **GIVEN** the SDK emits an assistant message containing a `thinking` block with `thinking: "Reasoning about the file structure…"`
- **WHEN** the Live stream renders
- **THEN** a thinking entry appears in the stream
- **AND** the entry carries the `active-run__ev--thinking` class so it is visibly dimmed relative to text and tool entries
- **AND** no UI control to hide thinking blocks is present in this iteration

#### Scenario: System init produces exactly one header

- **GIVEN** the SDK emits a `system` message with `subtype: "init"`, `model: "claude-sonnet-4-6"`, and a `tools` array of length 18
- **WHEN** the Live stream renders
- **THEN** a single header entry appears as the first row showing the model and the tool count
- **AND** if further `system` messages arrive, no additional header entries are emitted

#### Scenario: Result produces a footer

- **GIVEN** the SDK emits a `result` message with `duration_ms: 47000` and `total_cost_usd: 0.12`
- **WHEN** the Live stream renders
- **THEN** a footer entry appears as the final row showing the duration in seconds and the cost

### Requirement: Active Run duration counters tick while the run is non-terminal

The Active Run screen SHALL re-render at least once per second while the run's status is not in a terminal state (`done` or `failed`), so that phase durations and agent durations in the Pipeline pane advance visibly without waiting for a WebSocket event or REST poll.

The re-render mechanism SHALL be a single `setInterval` driven from a `useEffect` whose dependency is the terminal-status boolean. When the run reaches a terminal status, the interval SHALL be cleared and no further ticks SHALL occur.

The `elapsed()` helper used by the Pipeline pane SHALL accept an optional `completedAt` upper bound. When `completedAt` is set, the helper SHALL compute elapsed time as `completedAt - startedAt` rather than `Date.now() - startedAt`, so a completed phase or agent freezes at its final duration instead of growing forever after completion. Call sites for phase durations and agent durations SHALL pass their respective `completedAt` values.

#### Scenario: Active phase counter ticks every second

- **GIVEN** a run is in `running` status with phase 1 marked active
- **WHEN** no WebSocket events or REST polls fire for 5 seconds
- **THEN** the rendered duration text on phase 1 advances by approximately 5 (modulo render scheduling) from its starting value
- **AND** the same applies to any active agent rows inside that phase

#### Scenario: Completed phase freezes at its final duration

- **GIVEN** phase 1 received a `phase-complete` event 30 seconds ago, while phase 2 is now active
- **WHEN** the tick interval fires
- **THEN** phase 1's rendered duration text remains constant at its completion value across ticks
- **AND** phase 2's rendered duration text continues to advance

#### Scenario: Tick stops on terminal status

- **GIVEN** a run reaches `done` status
- **WHEN** 10 seconds elapse with no further events
- **THEN** no further tick re-renders occur (the interval has been cleared)
- **AND** all phase and agent durations are frozen at their final values

### Requirement: Pipeline pane derives durations from event timestamps

The `buildPipelineFromEvents` helper in the Active Run screen SHALL derive every phase and agent timing (`startedAt`, `completedAt`) from the corresponding `WsEventBase.t` field of the originating event, NOT from `Date.now()`. This guarantees that re-invocations of the helper (which occur on every React re-render, including the 1-second tick added by the "duration counters tick" requirement above) produce stable timing values, so the `elapsed()` helper computes a true elapsed duration rather than zero.

The `phase-start` site SHALL preserve the existing `??` idiom so a duplicate `phase-start` event does not shift the timer.

#### Scenario: Repeated builder calls produce stable timings

- **GIVEN** a single `phase-start` event with `t = "2026-05-20T10:00:00.000Z"` and `payload.num = 1`
- **WHEN** `buildPipelineFromEvents` is called twice in succession (simulating two React re-renders)
- **THEN** the resulting phase's `startedAt` is identical between the two calls
- **AND** equal to `new Date("2026-05-20T10:00:00.000Z").getTime()`

#### Scenario: Active phase counter visibly advances

- **GIVEN** a run is in `running` status with phase 1 active for 30 seconds
- **WHEN** the 1-second tick effect fires
- **THEN** the rendered duration text on phase 1 reads approximately `30s` (modulo render scheduling)
- **AND** the value is monotonically non-decreasing across successive ticks

#### Scenario: Completed phase freezes at its real completion time

- **GIVEN** phase 1 received `phase-start` at `t1` and `phase-complete` at `t2` where `t2 - t1 = 47000ms`
- **WHEN** the Pipeline pane renders any time after `t2`
- **THEN** phase 1's rendered duration text reads `47s` and does not advance across ticks

### Requirement: Active phase body always expands

The Pipeline pane SHALL render the body (agents list, including the synthetic main row) whenever the phase status is `active` or `gate`, regardless of whether any sub-agents have been registered. The prior gating clause `ph.agents.length > 0` SHALL NOT be present.

#### Scenario: Phase 1 expands immediately on phase-start

- **GIVEN** a fresh run that has just emitted `phase-start { num: 1, title: "Ticket · Clarify · Specify · Plan" }` and no other events
- **WHEN** the Pipeline pane renders
- **THEN** phase 1's body is visible in the DOM with at least one agent row inside it
- **AND** the body remains visible across subsequent ticks until phase 1 receives `phase-complete`

### Requirement: Synthetic main row represents orchestrator activity per phase

The Pipeline pane SHALL prepend a synthetic agent row labeled `main` to every phase whose `startedAt` is set. The row's properties:

- `name: 'main'`
- `op`: the title of the most recently opened checkpoint within the phase that has not yet completed; falls back to the literal string `'orchestrating'` when no checkpoint is currently open
- `status: 'active'` while the phase is active or gated; `'done'` after `phase-complete`
- `startedAt`: equal to the phase's `startedAt`
- `completedAt`: equal to the phase's `completedAt` (undefined while the phase is active, so the row's elapsed timer ticks; set when the phase completes, so the timer freezes)

Pending phases (those with no `startedAt`) SHALL NOT have a main row.

The `buildPipelineFromEvents` helper SHALL consume `checkpoint-start` and `checkpoint-complete` WebSocket events (which were previously ignored) to track the current checkpoint per phase. The phase to which a checkpoint belongs SHALL be determined by which phase is active (`activeNum`) at the time the `checkpoint-start` event arrives.

The synthetic main row SHALL appear first in the phase's agent list. Sub-agent rows registered via `agent-start` continue to appear below it in arrival order.

#### Scenario: Main row appears the moment a phase starts

- **GIVEN** a fresh run that has emitted only `phase-start { num: 1 }`
- **WHEN** the Pipeline pane renders
- **THEN** phase 1's agent list contains exactly one row with `name === 'main'`, `op === 'orchestrating'`, `status === 'active'`

#### Scenario: Main row op tracks the current checkpoint

- **GIVEN** events `phase-start { num: 1 }`, then `checkpoint-start { num: 1, title: "1a. Clarify scope" }`
- **WHEN** the Pipeline pane renders
- **THEN** phase 1's main row has `op === "1a. Clarify scope"`

#### Scenario: Main row op reverts to orchestrating between checkpoints

- **GIVEN** events `phase-start { num: 1 }`, `checkpoint-start { num: 1, title: "1a. Clarify scope" }`, `checkpoint-complete { num: 1 }`
- **WHEN** the Pipeline pane renders
- **THEN** phase 1's main row has `op === "orchestrating"`

#### Scenario: Main row coexists with sub-agent rows

- **GIVEN** events `phase-start { num: 1 }`, `checkpoint-start { num: 1, title: "1a-ws. Affected repos" }`, `agent-start { name: "architect-agent", op: "infer-affected-repos" }`
- **WHEN** the Pipeline pane renders
- **THEN** phase 1's agent list contains exactly two rows in order: first `main` with `op === "1a-ws. Affected repos"`, then `architect-agent` with `op === "infer-affected-repos"`
- **AND** both rows display independently ticking elapsed timers

#### Scenario: Main row freezes when its phase completes

- **GIVEN** events `phase-start { num: 1, t: t1 }`, `phase-complete { num: 1, t: t2 }` where `t2 - t1 = 47s`
- **WHEN** the Pipeline pane renders any time after `t2`
- **THEN** phase 1's main row has `completedAt === t2`, `status === 'done'`, and its rendered duration reads `47s` across subsequent ticks
