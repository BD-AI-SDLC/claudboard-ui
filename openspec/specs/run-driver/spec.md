## ADDED Requirements

### Requirement: Tool permission policy is an explicit always-allow callback

The system SHALL register a `canUseTool` callback on the `query()` call from `@anthropic-ai/claude-agent-sdk` for every run. The callback SHALL return `{ behavior: 'allow', updatedInput: input }` for every invocation, for every tool name, without inspection of the tool name or its input.

This callback is the deterministic mechanism that grants tool access. The `permissionMode` option remains set (its value is governed by the run-driver "Per-run Agent SDK lifecycle" requirement) but is treated as advisory: when `permissionMode` would otherwise leave a tool prompt open in a headless context, the callback resolves it.

The blanket allow is acceptable for this dev tool because: (a) the agent's `cwd` is pinned to the project path the user explicitly opened from the Kickoff screen, so relative file paths cannot escape that scope without absolute-path commands the user is implicitly authorizing; (b) the only irreversible operation that matters in the target repos — force-push to master — is blocked by the git remote, not by the agent harness; and (c) all repository contents are version-controlled, so local damage is recoverable.

The callback SHALL apply uniformly to built-in tools (Bash, Read, Write, Edit, Grep, Glob, Task, etc.) and to in-process MCP tools registered by the run driver (notably `mcp__bosch__*`).

#### Scenario: Top-level Bash call no longer stalls

- **GIVEN** a run is started against any Project with a prompt whose execution requires a top-level `Bash` call
- **WHEN** the agent invokes `Bash` with `parent_tool_use_id` null
- **THEN** the `canUseTool` callback fires and returns `{ behavior: 'allow', updatedInput: input }`
- **AND** the Bash call executes
- **AND** the run transcript does NOT contain a `tool_result` with content `"Claude requested permissions to use Bash, but you haven't granted it yet."`

#### Scenario: Sub-agent Bash call also flows

- **GIVEN** a run is started and the top-level agent invokes the `Task` tool to spawn a sub-agent (e.g. `sdd-expert-agent`)
- **WHEN** the sub-agent invokes any built-in tool — including `Bash` — with `parent_tool_use_id` set to the Task tool's id
- **THEN** the `canUseTool` callback fires and returns allow
- **AND** the tool executes without prompting

#### Scenario: MCP gate-bridge tools also flow

- **GIVEN** a run reaches a point where the skill calls `mcp__bosch__phase_start` or `mcp__bosch__gate_request`
- **WHEN** the SDK consults `canUseTool` for the MCP tool name
- **THEN** the callback returns allow
- **AND** the MCP tool call reaches the in-process server, which broadcasts the corresponding WebSocket event or registers the gate as usual

### Requirement: Per-run Agent SDK lifecycle

The system SHALL spawn one `query()` call from `@anthropic-ai/claude-agent-sdk` per run, with `cwd` set to `Project.path` (which equals the run's `target`), with the in-process MCP server from `gate-bridge` registered, and with `permissionMode` set to `acceptEdits`.

The run's initial prompt SHALL be exactly `/start-feature <user-prompt>`. No prompt prefix is applied based on topology or any kickoff-time hint. The agent decides which sub-paths or child repos to touch based on the prompt and the skill's logic.

The `CreateRunRequest` shape SHALL be `{ projectId: string, prompt: string, target: string }`. Any additional fields submitted by older clients (notably `scope`, `workspaceRoot`) SHALL be silently ignored — the server SHALL NOT reject the request on their presence. The persisted `Run` record SHALL NOT include `scope` or `workspaceRoot` fields.

#### Scenario: Kickoff against a monolith

- **WHEN** the user POSTs `/api/runs` with `{ projectId: "...", target: "/Users/x/proj/foo", prompt: "Add CSV export" }`
- **THEN** the driver calls `query({ prompt: "/start-feature Add CSV export", options: { cwd: "/Users/x/proj/foo", mcpServers: { bosch: <inproc> }, permissionMode: "acceptEdits" } })`

#### Scenario: Kickoff against a monorepo

- **WHEN** the user POSTs `/api/runs` with `{ projectId: "...", target: "/Users/x/work/platform", prompt: "Add invoice PDF in billing" }`
- **THEN** the driver calls `query()` with `cwd = "/Users/x/work/platform"` and prompt = `"/start-feature Add invoice PDF in billing"`
- **AND** no `[scope: ...]` prefix is applied
- **AND** the agent is responsible for locating the correct sub-package from the prompt text and skill context

#### Scenario: Kickoff against a multi-repo workspace

- **WHEN** the user POSTs `/api/runs` with `{ projectId: "...", target: "/Users/x/work/meas", prompt: "Outbox dispatcher across datahandler and controller" }`
- **THEN** the driver calls `query()` with `cwd = "/Users/x/work/meas"` (the workspace root) and prompt = `"/start-feature Outbox dispatcher across datahandler and controller"`
- **AND** the agent is responsible for deciding which child repo(s) under the workspace to touch

#### Scenario: Old client sends a deprecated scope field

- **WHEN** the user POSTs `/api/runs` with `{ projectId: "...", target: "/Users/x/work/platform", prompt: "Add invoice PDF", scope: "packages/billing" }`
- **THEN** the request succeeds with the same behavior as if `scope` had not been sent — prompt = `"/start-feature Add invoice PDF"`, no `[scope: ...]` prefix, no error response

#### Scenario: Old client sends a deprecated workspaceRoot field

- **WHEN** the user POSTs `/api/runs` with `{ projectId: "...", target: "/Users/x/work/meas", prompt: "Outbox dispatcher", workspaceRoot: "/Users/x/work/meas" }`
- **THEN** the request succeeds with the same behavior as if `workspaceRoot` had not been sent — the driver uses `cwd = target` and persists no `workspaceRoot` on the run record

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
