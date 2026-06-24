# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working in this repository.

## Project Overview

`bosch-sdlc` is a local web dashboard that drives AI-powered SDLC workflows (feature development, spec/plan reviews, prerequisite analysis) via the Anthropic Agent SDK. The server spawns Claude runs in-process, persists state to SQLite, and broadcasts structured events over WebSocket; the React UI renders pipeline progress and human gate reviews in real time.

## Services

| Service | Stack | Directory | Purpose |
|---------|-------|-----------|---------|
| `server` | Express 4 + better-sqlite3 + Agent SDK + ws | `server/` | REST API, WebSocket server, run orchestration, MCP tools |
| `ui` | React 18 + Vite 5 + vanilla CSS | `ui/` | Browser dashboard — phase monitoring, gate review |
| `protocol` | TypeScript + Zod 4 (shared library) | `protocol/` | Cross-boundary types, Zod MCP schemas, `WsEvent` union |

## Commands

### protocol (from `protocol/`)
- Build: `npm run build -w protocol`
- Typecheck: `npm run typecheck -w protocol`

### server (from `server/`)
- Build: `npm run build -w server`
- Dev: `npm run dev -w server`
- Test: `npm run test -w server`
- Single test: `node --experimental-vm-modules ../node_modules/.bin/jest --testPathPattern=<name>`
- Typecheck: `npm run typecheck -w server`
- Lint: `npm run lint -w server`

### ui (from `ui/`)
- Dev: `npm run dev -w ui` | Build: `npm run build -w ui` | Test: `npm run test -w ui`
- Typecheck: `npm run typecheck -w ui`
- Lint: `npm run lint -w ui` *(includes CSS prefix enforcement check)*

### Root (from repo root)
- Full build: `npm run build` *(protocol → server → ui; sequential — do not parallelize)*
- All tests: `npm test`
- Full CI check: `npm run typecheck && npm run lint && npm test`
- Pack tarball: `npm run pack`

### Git (always from repo root)
- Branch: `feature/<name>` or `fix/<name>`
- Commit: Conventional commits — `feat:`, `fix:`, `chore:`, `docs:`, etc.

## Local Dev

Launch flow is non-trivial (build order matters, watcher processes compete). Use the **`launch-app`** skill rather than rediscovering it — it covers pre-flight checks, the protocol → server → ui sequence, and ports.

- Server: http://localhost:3742 (Express + WS, `BOSCH_SDLC_PORT` to override)
- UI: http://localhost:5173 (Vite, proxies `/api` and `/ws` to 3742)
- Local state: `~/.bosch-sdlc/state.db` + `~/.bosch-sdlc/transcripts/`

### Legacy kv_settings DBs

The `SqliteError: no such table: kv_settings` startup crash is fixed at the source. If a pre-fix DB still trips it on first launch after pulling, recover with `sqlite3 ~/.bosch-sdlc/state.db "CREATE TABLE IF NOT EXISTS kv_settings (key TEXT PRIMARY KEY, value TEXT)"` then restart.

## Key Architecture

- **Repo structure:** Monorepo — `server/` + `ui/` + `protocol/` (shared library); npm workspaces; build order is always `protocol → server & ui`
- **Server pattern:** Feature-module layout (`registry/`, `gate/`, `run/`, `prereq/`, `bootstrap/`, `claudboard/`); each module owns `routes.ts` + domain logic; deferred-Promise pattern suspends the async generator at human review gates
- **UI pattern:** Feature-grouped React components; custom hooks for WS streaming and polling; single `api/client.ts` abstraction; vanilla CSS co-located with each component (BEM-like naming)
- **Data:** Single SQLite DB via `better-sqlite3`; WAL mode; FK enforced; additive-only migrations guarded by `PRAGMA table_info`
- **WebSocket:** `broadcast(runId, event)` in `ws-server.ts` is the single egress point — maintains replay buffer, persists to event log, and fans out to all clients
- **Protocol:** `protocol/` is the single source of truth for all shared types — Zod schemas for MCP tools, TypeScript interfaces for REST/WS, `WsEvent` discriminated union

## Coding Rules & Skills

### Auto-loaded Rules (`.claude/rules/`)

| Rule file | Auto-loads when touching |
|-----------|--------------------------|
| `server-conventions.md` | `server/src/**` |
| `ui-conventions.md` | `ui/src/**` |
| `protocol-conventions.md` | `protocol/src/**` |

### Skills (`.claude/skills/`)

| Scope | Skill |
|-------|-------|
| Launch the dev stack (server + UI) for live testing | `launch-app` |
| Add a new REST API endpoint | `express-route` |
| Add a new WebSocket event type | `ws-event` |
| Implement tasks from an OpenSpec change | `openspec-apply-change` |
| Archive a completed OpenSpec change | `openspec-archive-change` |
| Explore ideas / clarify requirements | `openspec-explore` |
| Propose a new OpenSpec change | `openspec-propose` |

## Critical Rules (always apply)

- **Build protocol first** — `npm run build -w protocol` must complete before building server or ui; the workspace root `npm run build` enforces this automatically
- **Never duplicate types** — all shared interfaces and schemas belong in `protocol/src/`; import from `@bosch-sdlc/protocol` in server and ui; do not re-declare protocol types locally
- **All DB access via `getDb()`** — never construct `new Database()` directly; new columns use `ALTER TABLE ADD COLUMN` guarded by `PRAGMA table_info`, never `DROP/CREATE TABLE`
- **Early-return pattern** — use `return void res.status(N).json(...)` for every early return in Express handlers; prevents accidental double-response
- **No direct `ws.send()`** — always call `broadcast(runId, event)` from `ws-server.ts`; this persists events to the log, maintains the replay buffer, and fans out to all connected clients
- **`resolveUnderWorkspace` on every user-supplied path** — any file path from a gate payload or user input must pass through `resolveUnderWorkspace(workspaceRoot, relPath)` before any I/O; no exceptions
- **ESM `.js` extensions** — all relative imports in server and protocol must use `.js` extension even when importing `.ts` source files (NodeNext module resolution)
