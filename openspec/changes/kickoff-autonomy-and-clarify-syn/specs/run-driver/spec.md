## MODIFIED Requirements

### Requirement: Per-run Agent SDK lifecycle

The system SHALL spawn one `query()` call from `@anthropic-ai/claude-agent-sdk` per run, with `cwd` set to `Project.path` (which equals the run's `target`), with the in-process MCP server from `gate-bridge` registered, and with `permissionMode` set to `acceptEdits`.

The run's initial prompt SHALL be exactly `Start feature --autonomy=<level>: <user-prompt>`, where `<level>` is the validated `autonomy` value from the `CreateRunRequest` and `<user-prompt>` is the validated `prompt` value. The prompt SHALL NOT begin with a `/` character — a leading slash is interpreted by the Anthropic Agent SDK as a slash-command invocation and would cause the SDK to terminate the run immediately with `Unknown command` (no API call, no SKILL invocation). The `--autonomy=<level>` flag SHALL always be present — the server SHALL NOT elide it even when `<level>` matches the project's default. No other prompt prefix is applied based on topology or any kickoff-time hint.

The `CreateRunRequest` shape SHALL be `{ projectId: string, prompt: string, target: string, autonomy: 'autopilot' | 'balanced' | 'guided' | 'manual' }`. All four fields are required; the server SHALL respond 400 to any request missing one or supplying an `autonomy` value outside the four allowed strings. Any additional fields submitted by older clients (notably `scope`, `workspaceRoot`) SHALL be silently ignored — the server SHALL NOT reject the request on their presence. The persisted `Run` record SHALL include `autonomy` and SHALL NOT include `scope` or `workspaceRoot` fields.

#### Scenario: Kickoff against a monolith with explicit autonomy

- **WHEN** the user POSTs `/api/runs` with `{ projectId: "...", target: "/Users/x/proj/foo", prompt: "Add CSV export", autonomy: "balanced" }`
- **THEN** the driver calls `query({ prompt: "Start feature --autonomy=balanced: Add CSV export", options: { cwd: "/Users/x/proj/foo", mcpServers: { bosch: <inproc> }, permissionMode: "acceptEdits" } })`
- **AND** the persisted `Run` record carries `autonomy: "balanced"`

#### Scenario: Kickoff against a monorepo with `autopilot` autonomy

- **WHEN** the user POSTs `/api/runs` with `{ projectId: "...", target: "/Users/x/work/platform", prompt: "Add invoice PDF in billing", autonomy: "autopilot" }`
- **THEN** the driver calls `query()` with `cwd = "/Users/x/work/platform"` and prompt = `"Start feature --autonomy=autopilot: Add invoice PDF in billing"`
- **AND** no `[scope: ...]` prefix is applied
- **AND** the agent is responsible for locating the correct sub-package from the prompt text and skill context

#### Scenario: Kickoff against a multi-repo workspace with `manual` autonomy

- **WHEN** the user POSTs `/api/runs` with `{ projectId: "...", target: "/Users/x/work/meas", prompt: "Outbox dispatcher across datahandler and controller", autonomy: "manual" }`
- **THEN** the driver calls `query()` with `cwd = "/Users/x/work/meas"` (the workspace root) and prompt = `"Start feature --autonomy=manual: Outbox dispatcher across datahandler and controller"`
- **AND** the agent is responsible for deciding which child repo(s) under the workspace to touch

#### Scenario: Prompt never starts with a slash

- **GIVEN** any valid `CreateRunRequest`
- **WHEN** the driver constructs the initial prompt
- **THEN** the prompt's first character is not `/`
- **AND** the prompt is plain text the Agent SDK will route as conversational input (not as a slash command)
- **AND** the run will not be terminated with `Unknown command: /...` at `duration_ms ≈ 12` with `num_turns: 0`

#### Scenario: Missing autonomy is rejected

- **WHEN** the user POSTs `/api/runs` with `{ projectId: "...", target: "/Users/x/proj/foo", prompt: "Add CSV export" }` (no `autonomy` field)
- **THEN** the server responds 400 with a JSON error naming `autonomy` as the missing field and listing the four allowed values
- **AND** no `query()` call is made
- **AND** no `Run` record is persisted

#### Scenario: Invalid autonomy is rejected

- **WHEN** the user POSTs `/api/runs` with `{ projectId: "...", target: "/Users/x/proj/foo", prompt: "Add CSV export", autonomy: "medium" }`
- **THEN** the server responds 400 with a JSON error naming `autonomy` as the invalid field and listing the four allowed values
- **AND** no `query()` call is made
- **AND** no `Run` record is persisted

#### Scenario: Extra fields are still ignored

- **WHEN** the user POSTs `/api/runs` with `{ projectId: "...", target: "/Users/x/proj/foo", prompt: "Add CSV export", autonomy: "balanced", scope: "billing", workspaceRoot: "/Users/x/work" }`
- **THEN** the server responds 201
- **AND** the persisted `Run` record carries `autonomy: "balanced"` but no `scope` or `workspaceRoot` fields
- **AND** the driver's initial prompt is `"Start feature --autonomy=balanced: Add CSV export"` (no scope prefix, no leading slash)

### Requirement: Skill source validation rejects un-instrumented gate patterns

The system SHALL validate the target repo's `.claude/skills/feature-workflow/SKILL.md` before starting any run. The validation SHALL reject (HTTP 409, with a `reason` string suitable for direct display to the user) any SKILL that:

- Does not exist at the expected path.
- Exists but does not contain the substring `mcp__bosch__` (legacy un-instrumented skill).
- Contains the substring `AskUserQuestion` (forbidden tool for orchestrator-to-user prompts; the `clarify_request` MCP tool is the only allowed mechanism).
- Contains the substring `` Reply `confirm` `` (legacy print-and-pray confirmation pattern from the broken Phase 1-syn block).
- Contains the substring `accept [Enter] or override` (legacy print-and-pray fallback from the broken autonomy prompt).

The validation SHALL run synchronously during `POST /api/runs` request handling, before any `query()` call is made and before any `Run` record is created. The validator SHALL be a pure substring match (no parsing, no code-fence skipping) — the proscribed strings are all unambiguous tokens that have no legitimate use in a compliant SKILL.

Each rejection SHALL return a `reason` distinguishable from the others so the UI can render an actionable message. The recommended messages:

- Missing file → "This repo has no feature-workflow skill. Run /claudboard-workflow to generate one."
- Missing `mcp__bosch__` → "This repo's feature-workflow was generated with an older template. Re-run /claudboard-workflow to update."
- Any of the three proscribed patterns → "This repo's feature-workflow uses un-instrumented gate patterns. Re-run /claudboard-workflow to regenerate it under the current contract."

#### Scenario: Compliant SKILL passes validation

- **GIVEN** a target repo whose `SKILL.md` uses `mcp__bosch__clarify_request` at every human-input site and contains no `AskUserQuestion`, no `` Reply `confirm` ``, and no `accept [Enter] or override`
- **WHEN** the user POSTs `/api/runs` with a valid request body
- **THEN** the server responds 201 and the run starts

#### Scenario: SKILL containing AskUserQuestion is rejected

- **GIVEN** a target repo whose `SKILL.md` contains the substring `AskUserQuestion` anywhere
- **WHEN** the user POSTs `/api/runs`
- **THEN** the server responds 409 with the "un-instrumented gate patterns" reason
- **AND** no `query()` call is made
- **AND** no `Run` record is persisted

#### Scenario: SKILL containing the legacy 1-syn print-and-pray prompt is rejected

- **GIVEN** a target repo whose `SKILL.md` contains the substring `` Reply `confirm` `` (from the legacy Phase 1-syn block)
- **WHEN** the user POSTs `/api/runs`
- **THEN** the server responds 409 with the "un-instrumented gate patterns" reason

#### Scenario: SKILL containing the legacy autonomy print-and-pray fallback is rejected

- **GIVEN** a target repo whose `SKILL.md` contains the substring `accept [Enter] or override`
- **WHEN** the user POSTs `/api/runs`
- **THEN** the server responds 409 with the "un-instrumented gate patterns" reason

#### Scenario: Missing SKILL still rejected as before

- **GIVEN** a target repo with no `.claude/skills/feature-workflow/SKILL.md`
- **WHEN** the user POSTs `/api/runs`
- **THEN** the server responds 409 with the "no feature-workflow skill" reason

#### Scenario: Outdated SKILL (no `mcp__bosch__`) still rejected as before

- **GIVEN** a target repo whose `SKILL.md` exists but contains no `mcp__bosch__` references
- **WHEN** the user POSTs `/api/runs`
- **THEN** the server responds 409 with the "older template" reason
