## 1. Driver: explicit always-allow callback

- [x] 1.1 In `server/src/run/driver.ts` add a `canUseTool` property to the `options` object passed to `query()` at line 57. Implementation: `async (_toolName, input) => ({ behavior: 'allow' as const, updatedInput: input })`. Leave `permissionMode: 'bypassPermissions'` in place — it's now a hint; the callback is the deterministic grant.
- [x] 1.2 Verify the callback signature matches `@anthropic-ai/claude-agent-sdk@^0.3.0` by checking `node_modules/@anthropic-ai/claude-agent-sdk/dist/index.d.ts` for the `Options.canUseTool` type. If the SDK version on disk types `behavior` as a discriminated union, narrow accordingly.
- [ ] 1.3 Manually verify: start a run against `/Users/LUP1BG/Documents/BoschProjects/meas/` with a prompt that forces an early `Bash` call (e.g. `"List the child repos under datahandler"`). Confirm the transcript no longer contains the `"Claude requested permissions to use Bash"` tool_result.
- [ ] 1.4 Sanity: confirm `mcp__bosch__*` MCP tool calls from the skill (phase_start, gate_request, etc.) still flow — the callback runs for them too and must return `allow`.

## 2. UI: extract and rewrite the stream renderer

- [x] 2.1 Create `ui/src/components/ActiveRun/stream.ts`. Export `type StreamEntry` as a discriminated union over `header` / `text` / `thinking` / `tool` / `footer` matching the shape in the proposal. Export `buildStream(events: WsEvent[]): StreamEntry[]`.
- [x] 2.2 In `buildStream`, maintain two maps as you walk events in order: `toolById: Map<string, ToolEntry>` (keyed by `tool_use_id`) and `agentByTask: Map<string, string>` (keyed by the parent `Task` tool_use id, valued by the resolved sub-agent name). Compute `depth = msg.parent_tool_use_id ? 1 : 0` and `agent = msg.parent_tool_use_id ? agentByTask.get(parent) ?? 'sub' : 'main'`.
- [x] 2.3 Handle `msg.type === 'system'` (init): emit a single `header` entry on the first occurrence — `{ kind: 'header', model: msg.model, tools: msg.tools?.length ?? 0 }`. Ignore repeats.
- [x] 2.4 Handle `msg.type === 'assistant'`: iterate `msg.message.content`. For `text` blocks emit `{ kind: 'text', agent, depth, text }`. For `thinking` blocks emit `{ kind: 'thinking', agent, depth, text }`. For `tool_use` blocks emit `{ kind: 'tool', agent, depth, toolName: block.name, argSummary: summarizeArgs(block.name, block.input) }`, store the entry in `toolById` by `block.id`, and if `block.name === 'Task'` also set `agentByTask.set(block.id, block.input.subagent_type ?? block.input.description ?? 'sub')`.
- [x] 2.5 Handle `msg.type === 'user'`: iterate `msg.message.content` for `tool_result` blocks. Look up the matching entry by `block.tool_use_id`, then mutate `entry.resultPreview = previewResult(entry.toolName, block.content)` and `entry.isError = !!block.is_error`. If no match, drop silently.
- [x] 2.6 Handle `msg.type === 'result'`: emit `{ kind: 'footer', durationMs: msg.duration_ms ?? 0, costUsd: msg.total_cost_usd ?? 0 }`.
- [x] 2.7 Implement `summarizeArgs(name, input)`:
  - `Bash` → first line of `input.command`, truncated to 60 chars with `…` suffix when truncated.
  - `Read` / `Write` / `Edit` → `input.file_path` (no truncation; paths are useful even when long).
  - `Grep` / `Glob` → `input.pattern`.
  - `Task` → `input.subagent_type ?? input.description ?? ''`.
  - Default → take the first key/value pair, render as `key=value` truncated to 60 chars.
- [x] 2.8 Implement `previewResult(toolName, content)`:
  - Normalize `content` to a single string: if it's a string take it directly; if it's an array of `{ type: 'text', text }` blocks concatenate the `text` fields with `\n`; otherwise `JSON.stringify` it.
  - For `toolName === 'Read'`: return `"<n> lines"` where n is the line count of the normalized string (Read dumps file contents — preview is noise).
  - For everything else: take the first 3 lines, truncate each to 200 chars, join with `\n`. If more than 3 lines or any line was truncated, suffix with ` …`.
- [x] 2.9 Create `ui/src/components/ActiveRun/stream.test.ts` using Vitest. Cover at minimum:
  - text-only assistant message produces one `text` entry with `agent: 'main'`, `depth: 0`.
  - assistant emits a `Bash` `tool_use`, then a `user` `tool_result` referencing it → one `tool` entry with `argSummary` matching the command first line and `resultPreview` matching the first 3 lines of the result.
  - assistant emits a `Task` `tool_use` with `input.subagent_type: 'sdd-expert-agent'`, then two subsequent messages with `parent_tool_use_id` set to the Task's id → those messages produce entries with `agent: 'sdd-expert-agent'` and `depth: 1`.
  - a `tool_result` with `is_error: true` flips `entry.isError = true`.
  - `system` init followed by two more system messages produces exactly one `header` entry.
  - `result` message produces a `footer` entry with the duration / cost extracted.

## 3. UI: wire the new stream into ActiveRun.tsx

- [x] 3.1 Delete the inline `buildStreamFromEvents`, `TranscriptLine`, and `SdkMessage` type declarations from `ui/src/components/ActiveRun/ActiveRun.tsx` (lines ~138–184).
- [x] 3.2 Import `buildStream` and `StreamEntry` from `./stream.js` at the top of `ActiveRun.tsx`. Replace `const streamLines = buildStreamFromEvents(events)` with `const streamEntries = buildStream(events)`.
- [x] 3.3 Replace the JSX inside `<div className="active-run__stream" ref={streamRef}>` (currently the `streamLines.map(...)` block at ~285–291) with a `streamEntries.map((entry, i) => renderEntry(entry, i))` invocation. Define `renderEntry(entry, i)` as a local helper in the component (or co-locate in `stream.tsx` if you prefer to keep `stream.ts` JSX-free — pick one).
- [x] 3.4 `renderEntry` cases (one `<div>` per entry, with `data-depth={entry.depth}` for the CSS indent):
  - `header`: `ⓘ session started · {model} · {tools} tools`
  - `text`: agent label + the text (preserve newlines with `white-space: pre-wrap`)
  - `thinking`: agent label + text, with `active-run__ev--thinking` class for dimming
  - `tool`: `⏺ {toolName}({argSummary})` on line 1; if `resultPreview` present, `⎿ {resultPreview}` on a continuation line; apply `active-run__ev--error` class when `isError`
  - `footer`: `✓ run complete ({durationMs/1000}s · ${costUsd.toFixed(2)})`
- [x] 3.5 Update `ActiveRun.css`: add `.active-run__ev--header`, `.active-run__ev--text`, `.active-run__ev--thinking` (dimmed: `color: var(--muted)` or similar token), `.active-run__ev--tool`, `.active-run__ev--footer`, plus `.active-run__ev--error` (red foreground), plus `[data-depth="1"]` indent (e.g. `padding-left: 16px; border-left: 2px solid var(--border)`). Add a class for the `⎿` continuation line so it aligns under the tool name, not under the time/agent columns.
- [ ] 3.6 Manual visual check: start a run, scroll the Live stream pane, confirm text/tool/result/sub-agent rendering matches the target sketch in the proposal. The pane should no longer contain any visible `{"type":...}` JSON.
- [ ] 3.7 Verify the existing `paused-gate` injected row at lines 292–304 still renders correctly alongside the new entries (it's untouched; just confirm the styling doesn't fight the new classes).

## 4. UI: tick interval for duration counters

- [x] 4.1 In `ui/src/components/ActiveRun/ActiveRun.tsx`, just below the existing `useState` for `selAgent` (~line 188), add `const [, tick] = useState(0)`.
- [x] 4.2 Add a `useEffect` that derives `isTerminal = status === 'done' || status === 'failed'` and, when not terminal, starts a `setInterval(() => tick(t => t + 1), 1000)`. Return the cleanup. Dependency array: `[isTerminal]`. Place the effect after the existing `useEffect`s.
- [x] 4.3 Note: `status` is computed from `run?.status ?? 'running'` at ~line 215, which is below where the effect needs to read it. Lift the `status` derivation above the new `useEffect`, or read `run?.status` directly inside the effect. Pick whichever keeps the diff small.
- [x] 4.4 Extend `elapsed(start?: number, end?: number): string` (line 54) to accept an optional `end`; compute against `end ?? Date.now()`.
- [x] 4.5 At the phase duration call site (~line 246), pass `ph.completedAt` as the second argument: `{elapsed(ph.startedAt, ph.completedAt)}`.
- [x] 4.6 At the agent duration call site (~line 262), pass `a.completedAt`: `{elapsed(a.startedAt, a.completedAt)}`.
- [ ] 4.7 Manual check: open an Active Run, watch the active phase counter advance once per second. Pause the run via the existing pause control — the counter should keep ticking (paused ≠ terminal). Let the run reach `done` — confirm the counters freeze at their completion values and the interval is cleared (no console errors, no leak).

## 5. Validation

- [x] 5.1 `npm run build -w protocol -w server` — should pass; no protocol or server type changes were made beyond the one driver line.
- [x] 5.2 `npm run build -w ui` — should pass; the new module typechecks and the JSX matches the new `StreamEntry` shape.
- [x] 5.3 `npm test -w server -w ui` — existing tests still pass; new `stream.test.ts` is exercised. (Note: integration.test.ts has a pre-existing failure on `createSdkMcpServer` unrelated to this change; 36/36 other tests pass.)
- [x] 5.4 `openspec validate fix-active-run-display-and-permissions --strict` — proposal, tasks, and spec deltas parse cleanly.
- [ ] 5.5 End-to-end smoke: run the feature workflow against `/Users/LUP1BG/Documents/BoschProjects/meas/` with a non-trivial prompt. Confirm (a) no Bash permission stall, (b) Live stream is readable, (c) the active phase counter ticks every second.

## 6. Pipeline builder: read event timestamps and consume checkpoints

- [x] 6.1 In `ui/src/components/ActiveRun/ActiveRun.tsx`, locate the four `Date.now()` sites inside `buildPipelineFromEvents` (lines ~99, ~106, ~117, ~125). Replace each with `new Date(ev.t).getTime()`. The `ev` binding is in scope at all four sites — confirm before editing.
- [x] 6.2 Preserve the `??` idiom at the `phase-start` site so a duplicate `phase-start` event doesn't shift the timer: `ph.startedAt = ph.startedAt ?? new Date(ev.t).getTime()`.
- [x] 6.3 Extend `PhaseState` (lines ~20-28) with `currentCheckpoint?: string`.
- [x] 6.4 In `buildPipelineFromEvents`, add a branch for `ev.kind === 'checkpoint-start'`: look up the active phase via `activeNum`; set `ph.currentCheckpoint = ev.payload.title`.
- [x] 6.5 Add a branch for `ev.kind === 'checkpoint-complete'`: clear `currentCheckpoint` on the active phase (`CheckpointCompleteSchema` only carries `num`, which is the checkpoint number — match by active phase, not by checkpoint number).
- [x] 6.6 Verify against the actual generated skill at `/Users/LUP1BG/Documents/BoschProjects/meas/.claude/skills/feature-workflow/SKILL.md` that checkpoint titles are human-readable (e.g. `"1a. Clarify scope"`) — those become the visible `op` in the pane.

## 7. Synthetic main row + always-expanded body

- [x] 7.1 In `buildPipelineFromEvents`, just before the final `return Array.from(phaseByNum.values()).sort(...)`, walk each phase whose `startedAt` is set and prepend a synthetic main agent: `{ id: 'main', name: 'main', op: ph.currentCheckpoint ?? 'orchestrating', status: ph.status === 'done' ? 'done' : 'active', startedAt: ph.startedAt, completedAt: ph.completedAt }`. Pending phases (no `startedAt`) stay empty.
- [x] 7.2 Confirm `AGENT_MARKS` (line 39) already has an entry for `'main'` — it does (`'•'`). No change needed.
- [x] 7.3 At line 274, drop the `&& ph.agents.length > 0` clause from the JSX condition so the body renders whenever the phase is `active` or `gate`. After 7.1, `ph.agents` will always contain at least the synthetic main row for active phases, so the body is never visually empty.

## 8. Pipeline builder tests

- [x] 8.1 Create `ui/src/components/ActiveRun/pipeline.test.ts` (or co-locate with existing `stream.test.ts` if you prefer one test file per component). Extract `buildPipelineFromEvents` to its own export if needed for testability (otherwise re-import from `ActiveRun.tsx`).
- [x] 8.2 Test: timer stability. Build an event list with one `phase-start` at `t = "2026-05-20T10:00:00.000Z"`. Call `buildPipelineFromEvents` twice. Assert the resulting phase's `startedAt` is identical between the two calls (proves the `Date.now()` bug is gone).
- [x] 8.3 Test: checkpoint propagation. Events: `phase-start { num: 1 }`, `checkpoint-start { num: 1, title: "1a. Clarify scope" }`. Assert the phase has `currentCheckpoint === "1a. Clarify scope"` and the synthesized main agent has `op === "1a. Clarify scope"`.
- [x] 8.4 Test: checkpoint clearing. Append `checkpoint-complete { num: 1 }`. Assert `currentCheckpoint` is undefined and the synthesized main agent has `op === "orchestrating"`.
- [x] 8.5 Test: main row presence. Events: `phase-start { num: 1 }` only. Assert the phase's `agents` array has at least one entry with `name === 'main'` and `op === 'orchestrating'`.
- [x] 8.6 Test: pending phase has no main row. Empty event list. Assert all 7 phases (from PHASE_TEMPLATE) have `agents.length === 0`.

## 9. Manual verification (folds in / supersedes prior 4.7)

- [ ] 9.1 Start a fresh feature run against `/Users/LUP1BG/Documents/BoschProjects/meas/`. Within 2 seconds of Phase 1's `phase-start`, confirm: (a) the phase 1 row is visually expanded, (b) a `main · orchestrating` row appears, (c) its timer increments by ~1 each second.
- [ ] 9.2 During Phase 1a, when the skill calls `checkpoint_start({ num: 1, title: "1a. Clarify scope" })`, confirm the main row's `op` text updates.
- [ ] 9.3 When the orchestrator spawns a sub-agent via `Task`, confirm a second row appears below the main row labeled with the agent name. Both rows tick independently.
- [ ] 9.4 When Phase 1 completes, confirm the main row freezes at the phase's actual duration (not at zero, not still ticking).
- [ ] 9.5 Watch a previously-active-now-complete phase across 5+ seconds; its duration does not advance. Active phase below it continues to advance.
