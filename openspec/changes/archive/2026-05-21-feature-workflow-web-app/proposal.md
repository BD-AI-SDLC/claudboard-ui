## Why

The `feature-workflow` Claude Code skill (generated per-repo by the claudboard plugin) takes a repo from "I want to build X" to a merged PR autonomously, but it can only be driven from the `claude` CLI by users who already know slash commands, agent names, and gate semantics. That excludes everyone outside the small group comfortable in a terminal-based agent loop. We want any developer in the org — and ideally any non-engineer stakeholder watching a run — to kick off, monitor, gate, and resume the workflow from a browser.

The bosch-workflow design (a React mock) already defines the exact UI surface we want: workspace overview, per-project prereq state, kickoff form, live run with phases/agents/stream/telemetry, and a spec+plan review gate. We have the workflow. We have the design. We need the app that connects them.

## What Changes

- Add a Node server that drives the existing `feature-workflow` skill via the Anthropic Agent SDK — same skill files, same sub-agents, same scripts, just a different driver than the `claude` CLI.
- Add an in-process MCP server exposing typed tools (`phase_start`, `checkpoint_start`, `agent_start`, `gate_request`, etc.) so the workflow can emit structured events and request human approval without parsing prose.
- Add a React + TypeScript UI matching the bosch-workflow design at pixel parity, talking to the server over REST + WebSocket.
- Add `npx bosch-sdlc` packaging so users boot the whole app with one command.
- Support all three repo topologies day one (monolith, monorepo microservices, multi-repo workspace), normalized to a single `(target, scope, workspaceRoot?)` shape.
- Add in-session pause/resume for runs. **No crash recovery** — if the server dies mid-run, that run is `dead`; only its transcript survives.
- Reuse the user's existing `~/.claude/` MCP configuration for JIRA/ADO/etc. credentials — no new secret store, no new login UX.
- **BREAKING for downstream**: modify the `claudboard-workflow` SKILL template in the `claude-repo-scan` plugin so generated `feature-workflow` skills emit typed events and call `gate_request` instead of free-form approval prose. Repos with a previously-generated feature-workflow must be re-generated to be drivable by this web app.

## Capabilities

### New Capabilities

- `workspace-registry`: Discover repos on the local filesystem, classify topology, normalize to `(target, scope, workspaceRoot?)`, persist registry and per-repo prereq state in SQLite.
- `run-driver`: Per-run lifecycle around the Agent SDK — spawn `query()` with the right cwd, iterate messages, persist transcript JSONL, broadcast events, manage run status.
- `gate-bridge`: In-process MCP server exposing typed phase/checkpoint/agent/gate tools. `gate_request` awaits a deferred resolved when the UI replies, so the workflow continues seamlessly across human approval.
- `pause-resume`: User-initiated pause that holds the SDK iterator between message boundaries; resume releases it. Distinct from SKILL-initiated gates. Server crash kills the run irrecoverably.
- `prereq-runner`: Drive `/analyse`, `/generate`, `/claudboard-workflow`, `/refresh`, `/techdebt` through the same SDK runner, surface their output paths and status into the project view.
- `web-ui`: React + TypeScript + plain CSS (no UI libraries, no CSS modules, per-component `.css` files). Five screens at visual parity with bosch-workflow: Dashboard, Project, Kickoff, Active Run, Review Gate.
- `packaging`: `npx bosch-sdlc` boot — free port, prebuilt UI served statically, browser launch, Claude Code precondition check, config dir at `~/.bosch-sdlc/`.
- `workflow-instrumentation`: Upstream edit to the `claudboard-workflow` SKILL template in `claude-repo-scan` so generated `feature-workflow/SKILL.md` calls the typed MCP tools and uses `gate_request` at the Phase 1d gate.

### Modified Capabilities

None — `openspec/specs/` is empty; this is the project's first spec-driven change.

## Impact

- **New code**: this repo (`Bosch-sdlc-tool`) gets a `server/` (Node + Agent SDK + in-process MCP + Express + WS), a `ui/` (Vite + React + TS), a shared `protocol/` (TypeScript types for REST/WS messages and MCP tool payloads), and an `npx`-distributable package bin.
- **External code edit**: `claude-repo-scan/skills/claudboard-workflow/references/` SKILL template — required for the web app to receive typed events from the workflow.
- **Filesystem footprint**: SQLite + JSONL transcripts at `~/.bosch-sdlc/`. Reads (never writes) `~/.claude/` for MCP server configuration.
- **Runtime dependencies**: Node ≥ 20, `@anthropic-ai/claude-agent-sdk`, Express, `ws`, `better-sqlite3`, `open`; UI deps: React 18, Vite, TypeScript. No UI component libraries.
- **User-visible precondition**: Claude Code must be installed and `~/.claude/` populated with at least one MCP server (for any auth that the workflow needs — JIRA, ADO, etc.).
- **Out of scope**: authentication, multi-tenant, cloud deployment, remote repos, wrapping skills other than `feature-workflow` and the claudboard prereqs, auto-migration of existing feature-workflow installations.
