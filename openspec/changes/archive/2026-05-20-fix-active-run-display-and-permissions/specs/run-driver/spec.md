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
