## ADDED Requirements

### Requirement: Capture and route interactive AskUserQuestion tool calls

The prereq CLI runner SHALL spawn the `claude` subprocess with `--input-format stream-json --output-format stream-json` and keep stdin open for the lifetime of the run. The slash command SHALL be delivered as the first stream-json user message written to stdin (not as an argv positional, which is incompatible with `--input-format stream-json`).

When the runner observes an assistant message containing a `tool_use` block where `name === 'AskUserQuestion'`, it SHALL:

- register the `(toolUseId, questions)` pair in a per-run pending-question registry,
- broadcast a new WebSocket event of kind `interactive-question` with payload `{ toolUseId, questions }` on the run's room, and
- continue reading from stdout while awaiting an answer (no blocking).

The runner SHALL NOT synthesize answers, SHALL NOT auto-Skip, and SHALL NOT close stdin before the subprocess exits. Skills that ask multiple questions in sequence SHALL each produce a distinct `interactive-question` event and a distinct registry entry.

Existing behavioral guarantees from the prereq-runner capability — run record creation, dependency validation, transcript persistence, exit-code → status mapping, artifact-presence downgrade, stderr capture into `error_message` — are unchanged.

#### Scenario: AskUserQuestion produces an interactive-question event

- **GIVEN** a prereq run is in progress for `/claudboard-workflow`
- **WHEN** the subprocess emits an assistant message containing a `tool_use` with `name: "AskUserQuestion"`, `id: "toolu_abc"`, and `input: { questions: [{ question: "Which branch type prefixes?", header: "Branch types", options: [{ label: "feature, fix, refactor" }, { label: "feature, bugfix, hotfix" }] }] }`
- **THEN** the runner appends the raw stream-json line to the transcript as today
- **AND** the runner registers `"toolu_abc"` in the run's pending-question map with the questions payload
- **AND** the runner broadcasts a WebSocket event `{ kind: 'interactive-question', payload: { toolUseId: 'toolu_abc', questions: [{ question: "Which branch type prefixes?", header: "Branch types", options: [...] }] } }`
- **AND** the subprocess is not signaled and stdin remains open

#### Scenario: Non-interactive prereq runs unchanged

- **GIVEN** a prereq run is in progress for `/analyse`
- **WHEN** the subprocess never emits an AskUserQuestion tool call
- **THEN** no `interactive-question` event is broadcast
- **AND** the run completes via the existing exit-0 / exit-nonzero paths with the same observable behavior as before this change

### Requirement: Deliver user answers to the running CLI subprocess

The system SHALL expose `POST /api/runs/:id/cli-answer` accepting `{ toolUseId: string; answers: Array<{ answer: string }> }`. The handler SHALL look up the run's child-process stdin via the per-run registry and write a stream-json user message containing a `tool_result` block with `tool_use_id: <toolUseId>`, `content: <serialized answers>`, `is_error: false`. After a successful write the matching entry in the run's pending-question map SHALL be removed.

`serialized answers` is the concatenation of each `answers[i].answer` joined with newlines. For a single-select question this is just the chosen label. For a multi-select question this is one selected label per line. An empty `answers` array (Skip) SHALL produce an empty-string content, which the skill is responsible for handling.

The endpoint SHALL return:

- 200 with `{ ok: true }` on successful write.
- 400 with `{ error: <description> }` when the body shape is invalid.
- 404 with `{ error: 'Run not found' }` when no registry entry exists for the runId (the run has not started, has already exited, or never existed).
- 404 with `{ error: 'Tool use id not pending for this run' }` when the registry entry exists but the toolUseId is not in its pending-question map (already answered, or never observed).
- 409 with `{ error: 'Run has exited' }` when the registry entry was removed between lookup and write (race condition with subprocess exit).

The endpoint SHALL NOT be gated by the bootstrap state — it answers an in-flight run that started after bootstrap was already ready.

#### Scenario: Submit an answer for a pending question

- **GIVEN** a prereq run `r1` is in progress and has a pending question `"toolu_abc"` registered
- **WHEN** the client POSTs `/api/runs/r1/cli-answer` with `{ toolUseId: "toolu_abc", answers: [{ answer: "feature, fix, refactor" }] }`
- **THEN** the server writes a stream-json line to the subprocess's stdin matching the shape `{ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_abc', content: 'feature, fix, refactor', is_error: false }] } }`
- **AND** the pending-question entry for `"toolu_abc"` is removed from `r1`'s map
- **AND** the response is 200 with `{ ok: true }`
- **AND** the subprocess receives the tool_result and continues the conversation

#### Scenario: Skip a question

- **GIVEN** a pending question `"toolu_xyz"` is registered for run `r1`
- **WHEN** the client POSTs `/api/runs/r1/cli-answer` with `{ toolUseId: "toolu_xyz", answers: [] }`
- **THEN** the server writes a tool_result with empty `content` to stdin
- **AND** the pending-question entry is removed
- **AND** the response is 200

#### Scenario: Answer for an unknown run

- **WHEN** the client POSTs `/api/runs/unknown/cli-answer` with any valid body
- **THEN** the response is 404 with `{ error: 'Run not found' }`
- **AND** nothing is written to any stdin

#### Scenario: Answer for a tool_use_id that's already been answered

- **GIVEN** run `r1` is in progress with no pending questions registered
- **WHEN** the client POSTs `/api/runs/r1/cli-answer` with `{ toolUseId: "toolu_old", answers: [...] }`
- **THEN** the response is 404 with `{ error: 'Tool use id not pending for this run' }`

#### Scenario: Answer arrives after subprocess exits

- **GIVEN** run `r1` was in progress with pending question `"toolu_abc"`, but the subprocess exits before the answer POST arrives
- **WHEN** the client POSTs `/api/runs/r1/cli-answer` with `{ toolUseId: "toolu_abc", answers: [...] }`
- **THEN** the response is 404 with `{ error: 'Run not found' }` (the registry entry was removed on exit) or 409 if the write races and the stdin throws
- **AND** the run's status reflects its exit code as today
