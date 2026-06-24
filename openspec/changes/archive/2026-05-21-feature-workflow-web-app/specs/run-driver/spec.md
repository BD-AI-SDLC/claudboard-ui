## ADDED Requirements

### Requirement: Per-run Agent SDK lifecycle

The system SHALL spawn one `query()` call from `@anthropic-ai/claude-agent-sdk` per run, with `cwd` set to the run's `target`, with the in-process MCP server from `gate-bridge` registered, and with `permissionMode` set to `acceptEdits`.

The run's initial prompt SHALL be `/start-feature <user-prompt>`, with `<user-prompt>` optionally prefixed by `[scope: <scope-path>]` when the run was kicked off against a monorepo scope.

#### Scenario: Kickoff against a monolith

- **WHEN** the user POSTs `/api/runs` with `{ target: "/Users/x/proj/foo", prompt: "Add CSV export" }`
- **THEN** the driver calls `query({ prompt: "/start-feature Add CSV export", options: { cwd: "/Users/x/proj/foo", mcpServers: { bosch: <inproc> }, permissionMode: "acceptEdits" } })`

#### Scenario: Kickoff against a monorepo scope

- **WHEN** the user POSTs `/api/runs` with `{ target: "/Users/x/work/platform", scope: "packages/billing", prompt: "Add invoice PDF" }`
- **THEN** the driver calls `query()` with cwd = the repo and prompt = `/start-feature [scope: packages/billing] Add invoice PDF`

#### Scenario: Kickoff against a multi-repo workspace member

- **WHEN** the user POSTs `/api/runs` with `{ target: "/Users/x/work/meas/datahandler", workspaceRoot: "/Users/x/work/meas", prompt: "Outbox dispatcher" }`
- **THEN** the driver calls `query()` with cwd = `target`; the SDK loads both `target/.claude/` and any inherited config the workflow itself reads from `workspaceRoot/.claude/`

### Requirement: Run status state machine

The system SHALL track each run through these statuses: `running`, `paused-gate`, `paused-user`, `done`, `failed`, `dead`. Transitions:

- `running → paused-gate` when `gate_request` tool is called by the SKILL
- `paused-gate → running` when the UI resolves the gate
- `running → paused-user` when the user POSTs `/runs/:id/pause`
- `paused-user → running` when the user POSTs `/runs/:id/resume`
- `running → done` when the SDK query iterator completes successfully
- `running → failed` when the SDK query throws or the SKILL signals an error
- any non-terminal → `dead` when the server process restarts and finds this run was not in a terminal status

#### Scenario: Successful run completes with status done

- **WHEN** a run executes through all phases and the SDK iterator completes
- **THEN** the run's final status is `done` and its `completed_at` timestamp is set

#### Scenario: Server restart marks live runs as dead

- **WHEN** the server boots and finds a run with status `running` or `paused-gate` or `paused-user` in SQLite
- **THEN** that run's status is updated to `dead`; the transcript is preserved; no recovery attempt is made

### Requirement: Transcript persistence

The system SHALL persist every SDK message for a run to `~/.bosch-sdlc/transcripts/<run-id>.jsonl`, one JSON object per line, in arrival order. Each line SHALL include `{ t: <iso-timestamp>, type: <message-type>, payload: <message> }`.

#### Scenario: Messages are appended in order

- **WHEN** the SDK yields messages M1, M2, M3 for a run
- **THEN** the transcript file contains three lines in that order, each timestamped, with the original message preserved in `payload`

#### Scenario: Transcript is queryable after run completes

- **WHEN** a completed run is fetched via `GET /api/runs/:id/transcript`
- **THEN** the response streams the JSONL file contents

### Requirement: WebSocket event broadcast

The system SHALL broadcast normalized events to all WS clients subscribed to a run via `/api/runs/:id/stream`. Event shape: `{ run_id, t, kind, payload }`. Kinds include `phase-start`, `phase-complete`, `checkpoint-start`, `checkpoint-complete`, `agent-start`, `agent-complete`, `gate-request`, `gate-resolved`, `status-change`, `transcript-message`.

#### Scenario: Phase start emits to subscribed clients

- **WHEN** the SKILL calls the `phase_start` MCP tool with `{ num: 1, title: "Ticket · Clarify · Specify · Plan" }`
- **THEN** every WS client subscribed to that run's stream receives `{ run_id, t, kind: "phase-start", payload: { num: 1, title: "..." } }`

#### Scenario: New WS subscriber receives recent history on connect

- **WHEN** a WS client connects to `/api/runs/:id/stream` for an in-flight run
- **THEN** the server first replays the most recent N events (default 200) from the run buffer, then begins live forwarding
