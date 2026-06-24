## 1. Project scaffolding

- [x] 1.1 Initialize monorepo layout with `server/`, `ui/`, `protocol/` workspaces (npm workspaces)
- [x] 1.2 Add root `package.json` with `bin: { "bosch-sdlc": "./server/dist/bin.js" }`, Node ≥ 20 engine
- [x] 1.3 Add TypeScript config shared across workspaces (strict mode, NodeNext)
- [x] 1.4 Add ESLint + Prettier with shared base config (no UI library rules; no global state)
- [x] 1.5 Add GitHub Actions CI: typecheck, lint, test for each workspace
- [x] 1.6 Add a CSS-class-prefix lint script for `ui/` that fails on unprefixed top-level selectors

## 2. Shared protocol package (`protocol/`)

- [x] 2.1 Define TypeScript types for REST request/response shapes (`Workspace`, `Project`, `Run`, `PrereqState`, `GatePayload`, `RunEvent`, `RunStatus`)
- [x] 2.2 Define discriminated union for WS event kinds (`phase-start`, `phase-complete`, `checkpoint-start`, `checkpoint-complete`, `agent-start`, `agent-complete`, `gate-request`, `gate-resolved`, `status-change`, `transcript-message`)
- [x] 2.3 Define MCP tool input schemas (Zod) for `phase_start`, `phase_complete`, `checkpoint_start`, `checkpoint_complete`, `agent_start`, `agent_complete`, `gate_request`
- [x] 2.4 Publish `protocol` as a local workspace dep consumed by both `server/` and `ui/`

## 3. Server scaffolding (`server/`)

- [x] 3.1 Add deps: `express`, `ws`, `better-sqlite3`, `open`, `zod`, `@anthropic-ai/claude-agent-sdk`, `vite` (devDep, for build only)
- [x] 3.2 Express app bootstrap: JSON parsing, error middleware, structured logging
- [x] 3.3 WS server attached to the same HTTP server, room model keyed by `run_id`
- [x] 3.4 SQLite migration runner; schema for `workspaces`, `projects`, `prereqs`, `runs`, `gates`

## 4. Workspace registry (capability: workspace-registry)

- [x] 4.1 Filesystem scanner: walk a root dir, detect `.git` and `.claude` markers
- [x] 4.2 Topology classifier with the three rules (monolith / monorepo / multi-repo-workspace)
- [x] 4.3 Prereq detector for all five prereqs with freshness rules (7-day cutoff + git-diff-since)
- [x] 4.4 SQLite persistence: upsert workspaces and projects, soft-delete (`status: "detached"`) on missing path
- [x] 4.5 REST: `GET /api/workspaces`, `POST /api/workspaces`, `DELETE /api/workspaces/:id`, `GET /api/projects`, `GET /api/projects/:id`, `GET /api/projects/:id/prereqs`
- [x] 4.6 Unit tests for classifier covering the three scenarios in the spec

## 5. Gate bridge (capability: gate-bridge)

- [x] 5.1 In-process MCP server factory using `createSdkMcpServer({ name: "bosch", tools: {...} })`
- [x] 5.2 Implement non-gate event tools as fire-and-forget broadcasters
- [x] 5.3 Implement `gate_request` with deferred lifecycle: create → persist to `gates` table → broadcast → await → return
- [x] 5.4 REST: `POST /api/runs/:id/gate/:gate_id/resolve` resolves the deferred
- [x] 5.5 Reconnect handling: persist current open gate per run; on WS reconnect, re-emit the open gate event
- [x] 5.6 Unit tests covering approve, reject-with-changes, and disconnect-mid-gate

## 6. Run driver (capability: run-driver)

- [x] 6.1 Run record creation: validate topology fields, insert `runs` row with status `running`, allocate transcript path
- [x] 6.2 Build prompt string per topology (monolith / monorepo+scope / multi-repo-workspace)
- [x] 6.3 Spawn `query()` with `{ cwd: target, mcpServers: { bosch }, permissionMode: "acceptEdits" }`
- [x] 6.4 Iterator consumer loop: await message → persist to JSONL → broadcast as `transcript-message` event → loop
- [x] 6.5 Status transitions wired to MCP events (`gate_request` → `paused-gate`; success/throw → `done`/`failed`)
- [x] 6.6 REST: `POST /api/runs`, `GET /api/runs/:id`, `GET /api/runs`, `GET /api/runs/:id/transcript` (JSONL streaming)
- [x] 6.7 WS: `/api/runs/:id/stream` — replay recent buffer on connect, then live forward
- [x] 6.8 Boot-time sweep: any non-terminal run in DB → mark `dead`

## 7. Pause / resume (capability: pause-resume)

- [x] 7.1 Per-run `paused-user` deferred slot; iterator awaits it between messages when set
- [x] 7.2 REST: `POST /api/runs/:id/pause`, `POST /api/runs/:id/resume` with 409 on invalid status
- [x] 7.3 Status invariants test: cannot pause from `paused-gate`, `done`, `failed`, `dead`
- [x] 7.4 Test the pause-then-gate sequence (paused-user → running → paused-gate)

## 8. Prereq runner (capability: prereq-runner)

- [x] 8.1 Predecessor validation table (`generate` requires `analyse: done`, etc.)
- [x] 8.2 REST: `POST /api/prereqs/:cmd` with body `{ target }` — `cmd ∈ { analyse, generate, claudboard-workflow, refresh, techdebt }`
- [x] 8.3 Reuse run driver for the actual SDK call; mark these runs `kind: "prereq"` in the DB
- [x] 8.4 On completion, re-run prereq detection for the affected repo and persist
- [x] 8.5 Surface output path in the prereq response

## 9. Workflow instrumentation (capability: workflow-instrumentation, lives in `claude-repo-scan`)

- [x] 9.1 Edit `claude-repo-scan/skills/claudboard-workflow/references/SKILL.md.template`: add typed MCP tool calls at every phase, checkpoint, and Agent invocation boundary
- [x] 9.2 Replace Phase 1d "wait for user approval" prose with `mcp__bosch__gate_request` call carrying `{ kind: "spec+plan", payload: { ticket, spec, plan } }`
- [x] 9.3 Add reject-branch logic: if gate result is `{ status: "rejected", changes }`, re-invoke sdd-expert and architect with the change request as additional context, then re-issue `gate_request`
- [x] 9.4 Update the claudboard-workflow skill's tests/fixtures so generated SKILLs include the new tool references
- [x] 9.5 In `server/run-driver`: detect old SKILLs (no `mcp__bosch__` references) and reject kickoff with HTTP 409 and the prescribed message
- [x] 9.6 In `ui/Project`: surface "Re-generate feature-workflow" CTA when the repo's SKILL is outdated

## 10. UI scaffolding (`ui/`, capability: web-ui)

- [x] 10.1 `npm create vite@latest` template, React + TS; strip default styles
- [x] 10.2 Add Geist + Geist Mono via fontsource (npm) — no Google CDN at runtime
- [x] 10.3 Port `bosch-workflow/project/src/styles.css` tokens + global rules into `ui/src/styles/tokens.css` and `ui/src/styles/global.css`
- [x] 10.4 Set up component layout: `ui/src/components/<Name>/<Name>.tsx` + `<Name>.css` co-located; one default export per component
- [x] 10.5 Add typed API client wrapping fetch + WS, generated against `protocol/` types
- [x] 10.6 Add WS subscription hook `useRunStream(runId)` with buffered replay
- [x] 10.7 Verify dep audit: no Tailwind/shadcn/Radix/MUI/Chakra/etc. in `package.json`

## 11. UI components and screens (capability: web-ui)

- [x] 11.1 Primitives: `Icon`, `Chip`, `Meter`, `Spark`, `StatusChip`, `HealthBar`, `Sidebar`, `TopBar` — visual parity with mock
- [x] 11.2 Dashboard screen: metrics tiles + repositories card + activity feed + vertical-operations grid, wired to `/api/dashboard/summary` and `/api/projects`
- [x] 11.3 Project screen: per-repo deep view with prereq panel that drives `POST /api/prereqs/:cmd`
- [x] 11.4 Kickoff screen: prompt input, scope picker (shown only when target is a monorepo), submit → `POST /api/runs`
- [x] 11.5 Active Run screen with three-pane split (Pipeline / Stream / Telemetry), driven by `useRunStream`
- [x] 11.6 Review Gate screen: spec rendering with Gherkin highlighting + plan list + approve/reject actions wired to `POST /api/runs/:id/gate/:gate_id/resolve`
- [x] 11.7 Run banner with gate CTA appearing on `paused-gate` status
- [x] 11.8 Visual parity QA: side-by-side diff vs the bosch-workflow mock for each of the five screens

## 12. Packaging (capability: packaging)

- [x] 12.1 `server/src/bin.ts` entry: precondition checks → port pick → server start → `open` browser
- [x] 12.2 Claude Code precondition: check `~/.claude/` exists and has at least one MCP server in its config
- [x] 12.3 First-boot `~/.bosch-sdlc/` creation with 0700 perms, SQLite schema init, empty `transcripts/`
- [x] 12.4 Vite build wired into the package's `prepublishOnly` script; ship `dist/` only
- [x] 12.5 `npm pack --dry-run` audit to confirm no source `.tsx` or `node_modules/vite` in the tarball
- [x] 12.6 Smoke test: `npx <local-tarball> bosch-sdlc` boots, serves UI, opens browser on a fresh machine

## 13. Integration tests

- [x] 13.1 End-to-end test: scaffold a tiny repo with a stub feature-workflow SKILL that exercises the typed MCP tools, run a full kickoff, approve a gate, assert run reaches `done`
- [x] 13.2 Pause/resume test against the same stub repo
- [x] 13.3 Reject gate test: assert SKILL receives `{ status: "rejected", changes }` and re-issues `gate_request`
- [x] 13.4 Old-SKILL rejection test: stub repo missing `mcp__bosch__` references is rejected on kickoff with HTTP 409
- [x] 13.5 Multi-repo workspace scan test: parent dir with three child repos + shared `.claude/` produces the expected registry entries

## 14. Documentation

- [x] 14.1 README: what it is, who it's for, the Claude Code prerequisite, `npx bosch-sdlc` quickstart
- [x] 14.2 Architecture diagram (the runtime spine from design.md) as an SVG checked into the repo
- [x] 14.3 Document the workflow-instrumentation contract for plugin authors who want to write their own driver
