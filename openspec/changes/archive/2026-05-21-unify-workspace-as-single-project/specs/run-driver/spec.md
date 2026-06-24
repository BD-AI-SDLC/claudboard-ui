## MODIFIED Requirements

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

## REMOVED Requirements

### Requirement: Monorepo scope is prepended to the kickoff prompt

**Reason**: The `[scope: <path>]` prompt prefix was the entire mechanical effect of the `scope` field in this codebase, and the explore session that produced this change established that the principle "agent decides what to touch inside the project" applies symmetrically across all three topologies. Pre-declaring scope at kickoff is inconsistent with how the multi-repo workspace case operates and was justified primarily by cost (avoiding agent crawl) — an argument that applies symmetrically to the workspace case where we accept the crawl.

**Migration**: The Kickoff UI's scope picker is removed (see `web-ui` spec delta). `CreateRunRequest.scope` and `Run.scope` are removed from the protocol. `buildPrompt()` in `server/src/run/prompt-builder.ts` collapses to a single branch returning `\`/start-feature ${userPrompt}\``. Old clients sending `scope` are not rejected — see the "Old client sends a deprecated scope field" scenario in the modified requirement above.

### Requirement: Run carries workspaceRoot for shared .claude resolution

**Reason**: The `workspaceRoot` field on `Run` (and the corresponding parameter on `runFeature`) was always plumbed but never read — the run driver underscored it as `_workspaceRoot`. With the unified model, `cwd = Project.path` is always the directory whose `.claude/` defines the skill, so there is no second path that the harness needs to resolve.

**Migration**: `Run.workspaceRoot`, `CreateRunRequest.workspaceRoot`, and the `_workspaceRoot` parameter on `runFeature` are removed. The `runs.workspace_root` DB column is dropped. Old clients sending `workspaceRoot` are not rejected — see the "Old client sends a deprecated workspaceRoot field" scenario above.
