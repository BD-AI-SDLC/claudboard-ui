---
generated_at: 2026-05-28T00:00:00Z
repo: /Users/LUP1BG/Documents/BoschProjects/Bosch-sdlc-tool
monorepo: true
services: [server, ui]
version: "2.1.0"
---

# Project Analysis: bosch-sdlc-tool (Monorepo)

## What (purpose & value)

`bosch-sdlc` is a local web dashboard that drives AI-powered SDLC workflows via the Anthropic Agent SDK. It wraps the `feature-workflow` Claude Code skill — which already lives in each target repo — with a browser UI for non-engineer stakeholders: live phase/checkpoint/agent streaming, spec+plan gate review, and prereq (analyse → generate → workflow) lifecycle management. The server spawns Claude runs in-process (Agent SDK) or as CLI subprocesses, persists state to SQLite, and broadcasts structured events over WebSocket. The React UI renders pipeline progress and human gate reviews in real time.

---

## Monorepo Topology

| Package | Stack | Directory | Purpose |
|---------|-------|-----------|---------|
| server | Express 4 + better-sqlite3 + Agent SDK + ws | `server/` | REST API, WebSocket server, run orchestration, MCP tools |
| ui | React 18 + Vite 5 + vanilla CSS | `ui/` | Browser dashboard — phase monitoring, gate review |

| Library | Directory | Consumed by |
|---------|-----------|-------------|
| @bosch-sdlc/protocol | `protocol/` | server, ui |

---

## How (global — applies to all services)

- **Build order:** protocol → server & ui (sequential per CLAUDE.md critical rule)
- **Package manager:** npm workspaces; `package-lock.json` present (npm)
- **TypeScript:** strict mode, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, ES2022 target, NodeNext module resolution (ESM everywhere)
- **Linting:** ESLint 9 (`eslint.config.js`) + Prettier 3 (`.prettierrc.json`)
- **CI/CD:** GitHub Actions (`.github/workflows/ci.yml`) — single job: `npm ci` → typecheck → lint → test
- **Deploy:** No automation (local CLI tool, installed via `npm install -g` or tarball)
- **Branch strategy:** `feature/<name>`, `fix/<name>` — from CLAUDE.md; confirmed by git log (`feature/fix-pause-button`, `fix/...`)
- **Commit conventions:** Conventional commits (`feat:`, `fix:`, `Merge pull request`) — evident in git log
- **Cross-service communication:** `protocol` package via npm workspace reference (`"@bosch-sdlc/protocol": "*"`)

### Per-Service Summary

| Service | Testing | Architecture | Conventions | Avg Score |
|---------|---------|--------------|-------------|-----------|
| server | 6/10 | 8/10 | 7/10 | 7.0/10 |
| ui | 6/10 | 8/10 | 7/10 | 7.0/10 |
| protocol | 9/10 | 9/10 | 9/10 | 9.0/10 |

**Quality variance:** Consistent across server and ui. Protocol library is exemplary — small, focused, Zod-first. Server and UI both solid but share common gaps: no coverage thresholds, console-based logging, large component/module candidates.

**Adaptive Depth:** server → Medium-Full rules (existing rules already comprehensive; gap is missing skill implementations). ui → Full rules (existing). protocol → Full rules (existing).

### Global Watch

- [INFO] No code coverage thresholds in either Jest (server) or Vitest (ui) config — tests run in CI but no enforcement gate
- [INFO] CI single-job flat pipeline (no staging, no deploy stage) — acceptable for a local tool but blocks future distribution path
- [INFO] No SBOM generation, no Dependabot/Snyk configured — dependency security scanning absent

### Proposed Global Artifacts

**CLAUDE.md** — exists and is comprehensive; no global additions needed.

**Rules (global):** None needed — per-service rules already cover all conventions.

---

## Service Analysis: server

### Stack & Versions

- Node.js ≥20 (LTS) · TypeScript 5.4
- Express 4.19 · better-sqlite3 12 · ws 8.17 · Zod 4
- `@anthropic-ai/claude-agent-sdk` 0.3 (Agent SDK, in-process query loop)
- Jest 29 + ts-jest + supertest (test)
- Source files: 63 (including 22 test files); 41 production `.ts` files

### Quality Assessment

**Testing:** 6/10
Evidence: Jest + ts-jest ESM preset, 22 test files, supertest integration tests, `bootstrapGuard` test-escaping via `__setStateForTest`. No coverage thresholds; `--experimental-vm-modules` required (fragile); no testcontainers.

**Architecture:** 8/10
Evidence: Feature-based module grouping (`registry/`, `gate/`, `run/`, `prereq/`, `bootstrap/`, `claudboard/`). Each module has `routes.ts` + domain logic — clear separation of routing from business logic. Deferred Promise gate pattern is elegant and domain-appropriate. Singleton `getDb()` with WAL + FK enforced.

**Conventions:** 7/10
Evidence: ESLint + Prettier configured. Consistent `return void res.status().json()` early-exit pattern (47 usages). ESM `.js` import extensions consistently applied. `snake_case` SQL columns mapped to `camelCase` TypeScript via row-mapper functions. One `as any[]` bypass in `run/routes.ts:81` — minor.

**Dependencies:** 6/10
Evidence: All dependencies use caret ranges (`^`) — patch/minor float allowed. No BOM concept (npm). Workspace cross-reference (`"@bosch-sdlc/protocol": "*"`) is correct monorepo idiom. Node 20 LTS, React 18, all packages reasonably current. No SBOM, no audit enforcement in CI.

**CI/CD:** 4/10
Evidence: GitHub Actions single job: typecheck → lint → test. No coverage gate, no deployment automation, no environment promotion. Acceptable for local tool; inadequate for distributed package.

**Documentation:** 8/10
Evidence: Comprehensive README (purpose, install, workflow, architecture), CLAUDE.md with commands/architecture/rules/critical rules, per-module rules file (`server-conventions.md`). No OpenAPI spec (REST API undocumented for external consumers). No ADRs.

**Security:** 7/10
Evidence: Intentionally no auth (single-user local tool). Strong: `resolveUnderWorkspace` with `realpath` symlink resolution and boundary assertion guards all file I/O in gate handlers. `BOSCH_GATE_MAX_FILE_BYTES` cap prevents oversized reads. Only 2 `process.env` accesses, neither sensitive. No hardcoded secrets detected.

**Observability:** 3/10
Evidence: `console.info/error/warn` only. No structured logging framework (pino/winston). No metrics, no tracing, no health-check actuator beyond a trivial `/health` endpoint. Request logging via inline middleware (not structured).

**Quality Score Summary:**

| Dimension | Score | Evidence |
|-----------|-------|----------|
| Testing | 6/10 | Jest+supertest, 22 test files, no coverage thresholds |
| Architecture | 8/10 | Feature-module grouping, deferred Promise gate, singleton DB |
| Conventions | 7/10 | Consistent early-return pattern, ESM .js imports, one `as any[]` |
| Dependencies | 6/10 | Caret ranges, no audit enforcement, current versions |
| CI/CD | 4/10 | typecheck+lint+test only, no coverage gate, no deploy |
| Documentation | 8/10 | Comprehensive README + CLAUDE.md + rules |
| Security | 7/10 | resolveUnderWorkspace boundary guard, intentional no-auth |
| Observability | 3/10 | console.* only, no structured logging or metrics |
| **Average** | **6.1/10** | |

**Adaptive Depth Decision:** 6.1 avg → Medium rules (existing `server-conventions.md` already at full depth — gap is missing skill implementations, not rules)

**API Surface:**
- Modules: 6 routers (`projectRegistryRouter`, `gateRouter`, `runRouter`, `prereqRouter`, `bootstrapRouter`, `claudboardRouter`)
- Endpoints: ~68 (GET:47 POST:9 PUT:1 DELETE:11) — high GET count driven by run/event polling routes
- Versioning: None detected
- Documentation: None (no OpenAPI tooling)

**Preserve:**
- `resolveUnderWorkspace` (gate/resolve-under-workspace.ts) — `realpath` + boundary assertion on all user-supplied paths is excellent security-in-depth
- Deferred Promise gate pattern (`gate/deferred.ts`) — suspends the async generator cleanly without polling; elegant design
- Protocol-first schema design — Zod schemas in `protocol`, `.shape` passed to `tool()`, TypeScript types inferred via `z.infer<>` — no type duplication
- Additive migration pattern (`db.ts`) — `PRAGMA table_info` guards before every `ALTER TABLE ADD COLUMN` prevents migration failures on re-run
- `broadcast(runId, event)` abstraction — no direct `ws.send()` calls anywhere outside `ws-server.ts`
- `bootstrapGuard` middleware (bootstrap/guard.ts) — clean separation of readiness gating from route logic
- `return void res.status().json()` early-exit idiom — consistent, prevents accidental double-response
- Conventional commits: `feat:`, `fix:` prefixes in git log — should be enforced

**Watch:**
- [MEDIUM] God module candidate: `prereq/cli-runner.ts` at 360 LOC — handles process spawning, stream parsing, `AskUserQuestion` extraction, answer injection, and transcript writing. Extract subprocess I/O parsing into a dedicated `stream-parser.ts`.
- [MEDIUM] God module candidate: `gate/mcp-server.ts` at 264 LOC — all MCP tool registrations in one function. Acceptable given it is the single MCP surface, but adding tools will grow it further.
- [LOW] `run/routes.ts:81` — `as any[]` bypass on SQL result from LEFT JOIN query. Type the row inline with an interface (pattern used elsewhere in the file).
- [LOW] Duplicated WebSocket connection setup in `useRunStream.ts` — success path and error-fallback path are ~20 lines of near-identical WebSocket setup code. Extract to a `connectWs(runId)` helper.
- [INFO] No structured logging — `console.*` calls make log aggregation and filtering impossible if the tool is ever used in a shared/server context. Consider `pino` behind a thin logger module.
- [INFO] No coverage thresholds in Jest config — tests pass regardless of coverage regression.
- [INFO] `permissionMode: 'bypassPermissions'` in `run/driver.ts` — intentional (local tool), but should be prominently documented in rules so future contributors don't assume this is safe to retain in non-local contexts.

**Compound severity check:** No qualifying compound pairs detected (no `@FeignClient` / external HTTP calls from server; no broad exception catches in CRUD paths; no security framework × PII fields — auth is intentionally absent by design).

**Debt:**
- [INFO] `--experimental-vm-modules` required for ESM Jest — this flag has been stable for years but is still "experimental"; consider migrating to Vitest for consistency with ui, or accept the flag as a known requirement.
- [INFO] No OpenAPI spec — REST API consumed only by the bundled UI today, but adding one would enable tooling (Postman, generated clients) with no runtime cost.
- [INFO] `run/routes.ts` uses `as any[]` for the JOIN query result — the only TypeScript strictness bypass in production server code.

### Existing .claude/ Coverage

- `server-conventions.md` (paths: `server/src/**`) — covers module structure, DB access, migrations, MCP tools, WebSocket, run lifecycle, error handling, testing ✓
- `openspec-apply-change/`, `openspec-archive-change/`, `openspec-explore/`, `openspec-propose/` — openspec workflow skills ✓
- **Gap:** CLAUDE.md lists `express-route` and `ws-event` skills in the skills index table, but neither `.claude/skills/express-route/` nor `.claude/skills/ws-event/` exist on disk. These are referenced but not implemented.

### Workflow Signals

```yaml
workflow_signals:
  cross_service_edges: []
  shared_libraries:
    - {name: "@bosch-sdlc/protocol", consumer_count: 2}
  auth_perimeter: "none"
  ticket_prefix: null
```

### Architectural Patterns

```yaml
architectural_patterns:
  - {type: deferred-promise-gate, style: async-suspension, evidence: ["server/src/gate/deferred.ts:10", "server/src/gate/mcp-server.ts:205"]}
```

### Proposed Artifacts (scoped to server)

**Already covered (no action):**
- `server-conventions.md` — all routing, DB, MCP, WebSocket, and error conventions documented ✓

**Gap — Skills to implement (referenced in CLAUDE.md but missing from disk):**
- `express-route/` — trigger: adding a new REST endpoint; scope: `server/src/**`; creates `routes.ts` fragment; references `server-conventions.md` Router pattern
- `ws-event/` — trigger: adding a new WebSocket event type; scope: `protocol/src/**` + `server/src/ws-server.ts`; creates event interface + kind literal + union member; references `protocol-conventions.md` event pattern

---

## Service Analysis: ui

### Stack & Versions

- React 18.3 · TypeScript 5.4 · Vite 5.2
- Vitest 4.1 + React Testing Library 16 + jsdom 29
- `react-markdown` 9.1 · `@fontsource/geist` (monospace + sans)
- Vanilla CSS (co-located, BEM-like)
- Source files: 61 (including 18 test files); 43 production `.ts/.tsx` files

### Quality Assessment

**Testing:** 6/10
Evidence: Vitest + RTL, 18 test files, co-located (`.test.tsx` beside component). Good coverage of hooks (`useRunStream`, `useBootstrapStatus`, `useTheme`), pipeline logic (`pipeline.test.ts`), and key components. No coverage thresholds. No E2E tests (Playwright/Cypress).

**Architecture:** 8/10
Evidence: Feature-based component grouping (`ActiveRun/`, `ReviewGate/`, `Project/`, `Dashboard/`, `claudboard/`). Custom hooks for complex logic (`useRunStream` for WS, `useBootstrapStatus` for polling). Single API client abstraction (`api/client.ts`). No state management library — `useState` + prop drilling — appropriate for this app size.

**Conventions:** 7/10
Evidence: ESLint + Prettier. BEM-like CSS class names enforced by `ui/scripts/check-css-prefixes.js` lint step. Co-located files (component + CSS + test) consistently applied. Relative imports with `.js` extensions. Props interfaces defined as local `interface Foo {}` (not exported when component-private). Vanilla CSS custom properties for theming via `data-theme`.

**Dependencies:** 6/10
Evidence: Caret ranges. React 18 (current). Vitest 4.1 (current). No lodash or heavy utility libraries — good hygiene. `react-markdown` is the only notable runtime dep beyond React itself.

**CI/CD:** 4/10
Evidence: Same single-job CI as server (typecheck → lint → test). CSS prefix check runs in lint step — nice. No deploy stage.

**Documentation:** 8/10
Evidence: `ui-conventions.md` is thorough — component structure, CSS conventions, state management, API access, imports, testing. CLAUDE.md covers UI layer.

**Security:** 7/10
Evidence: Same-origin fetch (no auth headers needed — served by same Express process). No CSP, but that's a server-side concern. No hardcoded endpoints or secrets. `resolveUnderWorkspace` concern is server-side only.

**Observability:** 3/10
Evidence: No `console.log` in production UI code (clean!). No error boundary components detected. No Sentry or error tracking.

**Quality Score Summary:**

| Dimension | Score | Evidence |
|-----------|-------|----------|
| Testing | 6/10 | Vitest+RTL, 18 test files, no coverage thresholds, no E2E |
| Architecture | 8/10 | Feature-grouped, custom hooks, single API client |
| Conventions | 7/10 | ESLint+Prettier, BEM CSS enforced by lint script |
| Dependencies | 6/10 | Caret ranges, lean dep set, all current |
| CI/CD | 4/10 | typecheck+lint+test only, no coverage gate |
| Documentation | 8/10 | ui-conventions.md comprehensive |
| Security | 7/10 | Same-origin, no secrets, no console.log |
| Observability | 3/10 | No error boundaries, no tracking |
| **Average** | **6.1/10** | |

**Adaptive Depth Decision:** 6.1 avg → Medium rules (existing `ui-conventions.md` already at full depth)

**API Surface:** N/A (UI consumer, not provider)

**Preserve:**
- Zero `console.log` in production UI code — no debug pollution
- Co-located test files (`Component.test.tsx` beside `Component.tsx`) — easy to find, easy to maintain
- `useRunStream` deduplication pattern using `eventKey` + `seenRef` — prevents WebSocket replay duplicates from the HTTP history/WS overlap window
- CSS prefix enforcement via `check-css-prefixes.js` lint script — automated convention enforcement
- `api/client.ts` abstraction — all fetch calls behind typed methods, no raw fetch scattered across components
- `@bosch-sdlc/protocol` types consumed directly — no local type duplication

**Watch:**
- [MEDIUM] God component: `ActiveRun.tsx` at 502 LOC — manages pipeline state, agent state, stream events, clarify interview, WS subscription, and rendering. Consider extracting pipeline state management into a `usePipelineState` hook.
- [MEDIUM] God component: `ReviewGate.tsx` at 432 LOC — handles spec+plan display, clarify gate, file drift detection, and gate resolution. Consider splitting into `SpecPlanGate.tsx` and `ClarifyGate.tsx`.
- [MEDIUM] God component: `Project.tsx` at 321 LOC — git hotspot (15 commits in 3 months) + large size. Most actively changed file in codebase — high change frequency + large size = bug risk.
- [LOW] Duplicated WebSocket setup code in `useRunStream.ts` — the `try` (success) and `catch` (error fallback) blocks each contain an identical 15-line WebSocket setup and `onmessage` handler. Extract to a private `openWs(runId, seen, setEvents)` helper.
- [INFO] No React error boundaries — unhandled component errors will crash the full app. Add a top-level `<ErrorBoundary>` in `App.tsx`.
- [INFO] No coverage thresholds in Vitest config.

**Compound severity check:** No qualifying pairs detected.

**Debt:**
- [INFO] No E2E tests — browser-level gate review flow (WebSocket connection → event stream → gate approval) is not integration-tested.
- [INFO] `Project.tsx` is the most-changed file (15 git touches in 3 months) and the 3rd-largest component (321 LOC) — candidate for decomposition before it becomes a maintenance liability.

### Existing .claude/ Coverage

- `ui-conventions.md` (paths: `ui/src/**`) — covers component structure, CSS, state management, API access, imports, testing ✓

### Workflow Signals

```yaml
workflow_signals:
  cross_service_edges: []
  shared_libraries:
    - {name: "@bosch-sdlc/protocol", consumer_count: 2}
  auth_perimeter: "none"
  ticket_prefix: null
```

### Architectural Patterns

```yaml
architectural_patterns: []
```

### Proposed Artifacts (scoped to ui)

**Already covered (no action):**
- `ui-conventions.md` — all component, CSS, state, and API conventions documented ✓

---

## Service Analysis: protocol (Library)

### Stack & Versions

- TypeScript 5.4 · Zod 4 · ESM
- 9 source files (no tests — types are validated by consumers)
- Build: `tsc` only

### Role

Single source of truth for all cross-boundary types. Exports: Zod schemas (MCP tool inputs), TypeScript interfaces (REST shapes, run/gate/repo models), discriminated union `WsEvent`.

### Quality Assessment (condensed)

- **Architecture:** 9/10 — file-per-concern (`types.ts`, `events.ts`, `mcp-schemas.ts`, `index.ts`), Zod-first with `z.infer<>` derivation, `.describe()` on MCP-facing fields
- **Conventions:** 9/10 — naming conventions (`PascalCaseSchema`, `PascalCase` type, `PascalCaseEvent`, `kebab-case` kind literals) strictly followed
- **Documentation:** 9/10 — `protocol-conventions.md` is thorough; inline JSDoc on ambiguous fields

### Existing .claude/ Coverage

- `protocol-conventions.md` (paths: `protocol/src/**`) — covers Zod schema-first pattern, file organization, event discriminated union, naming ✓

### Proposed Artifacts (scoped to protocol)

**Already covered (no action):**
- `protocol-conventions.md` — all patterns documented ✓

---

## Global Proposed Artifacts Summary

### CLAUDE.md

Exists and is comprehensive. **One update recommended:** Add a note that `express-route` and `ws-event` skills referenced in the skills index table are not yet implemented on disk (stubs needed or table should reflect actual state).

### Rules (all existing, no gaps)

| Rule file | paths: glob | Status |
|-----------|-------------|--------|
| `server-conventions.md` | `server/src/**` | ✓ Exists — full depth |
| `ui-conventions.md` | `ui/src/**` | ✓ Exists — full depth |
| `protocol-conventions.md` | `protocol/src/**` | ✓ Exists — full depth |

### Skills

**Existing (4 implemented):**
- `openspec-apply-change/` — implement OpenSpec change tasks ✓
- `openspec-archive-change/` — archive completed changes ✓
- `openspec-explore/` — explore ideas/requirements ✓
- `openspec-propose/` — propose new changes ✓

**Missing (2 referenced in CLAUDE.md but not on disk):**
- `express-route/` — Add new REST API endpoint; trigger: "add endpoint", "new route", "add API"; scope: `server/src/**`; creates named Router fragment following `server-conventions.md` pattern
- `ws-event/` — Add new WebSocket event type; trigger: "add event", "new WS event", "add WebSocket"; scope: `protocol/src/**` + `server/src/ws-server.ts`; touches `events.ts` (interface + union) + `mcp-schemas.ts` (optional Zod schema) + MCP tool registration in `gate/mcp-server.ts`

**No skill overlap detected** — `express-route` and `ws-event` are complementary workflows with non-overlapping file scopes.

---

## Context Overhead Estimate

| Artifact | Est. lines | Est. tokens |
|----------|-----------|-------------|
| CLAUDE.md | ~185 | ~222 |
| server-conventions.md | ~108 | ~140 |
| ui-conventions.md | ~90 | ~117 |
| protocol-conventions.md | ~65 | ~85 |
| openspec skills (4 × ~80) | ~320 | ~448 |
| **Total persistent** | **~768** | **~1,012** |

Context overhead is well within reasonable bounds. Rules load conditionally on path match; skill SKILLs load on intent match only.
