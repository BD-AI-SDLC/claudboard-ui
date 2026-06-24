---
name: launch-app
description: >
  Launch the bosch-sdlc dev stack (protocol build + Express server on :3742 +
  Vite UI on :5173) so the user can interact with the app in a browser.
  Use this skill whenever the user asks to run, start, launch, boot, or fire
  up the app, wants to "see it", needs to verify a UI/server change live,
  asks for the dev server, or wants to manually test before pushing.
  Also triggers when a smoke check is needed — "is it working?", "open the
  dashboard", "let me see the change", "spin it up". Always run this skill
  instead of guessing the launch sequence from package.json — the build
  order is easy to get wrong.
---

# Launch bosch-sdlc

## Three services, one order

```
protocol (build)  →  server (dev)  →  ui (dev)  →  open http://localhost:5173
```

Protocol is a shared library — both server and ui import `@bosch-sdlc/protocol`. A stale build silently breaks types. Build it first, always.

## Pre-flight

Check nothing is already listening on the dev ports and that no zombie watchers are running. Multiple `tsx watch src/dev.ts` processes crash-loop and compete — kill all of them before starting fresh.

```bash
lsof -nP -iTCP:3742 -sTCP:LISTEN
lsof -nP -iTCP:5173 -sTCP:LISTEN
ps -A -o pid,command | grep "tsx watch src/dev" | grep -v grep
# If anything found and the user hasn't claimed it: kill <pids>
```

## Launch

Run from the repo root. Server and UI go in the background so they keep streaming while you do other work.

```bash
npm run build -w protocol           # required, blocks until done
npm run dev -w server               # background — listens on :3742
npm run dev -w ui                   # background — Vite on :5173, proxies /api + /ws to :3742
```

Server is healthy when:

```bash
curl -sf http://localhost:3742/api/bootstrap/status
# → {"state":"ready"}
```

Look for `[bosch-sdlc dev] Listening on http://localhost:3742` in the server task output. `tsx watch` auto-reloads on `src/` changes — no restart needed for code edits.

The user-facing URL is **http://localhost:5173** — tell the user to open it.

## Legacy kv_settings recovery

The source-level `SqliteError: no such table: kv_settings` bug is fixed (regression test in `server/src/__tests__/db-migration.test.ts`). A DB that hit the old crash before the fix may still need a one-time manual create:

```bash
sqlite3 ~/.bosch-sdlc/state.db "CREATE TABLE IF NOT EXISTS kv_settings (key TEXT PRIMARY KEY, value TEXT)"
```

**Nuclear** (destroys local projects + run history) — only with explicit user confirmation:

```bash
rm ~/.bosch-sdlc/state.db ~/.bosch-sdlc/state.db-shm ~/.bosch-sdlc/state.db-wal
```

## Useful state paths

- Database: `~/.bosch-sdlc/state.db`
- Run transcripts: `~/.bosch-sdlc/transcripts/`
- Server port override: `BOSCH_SDLC_PORT=<n>` (defaults to 3742; UI proxy is hardcoded — change `ui/vite.config.ts` if you change the port)

## Smoke endpoints

```bash
curl -s http://localhost:3742/api/bootstrap/status                # {"state":"ready"}
curl -s http://localhost:3742/api/projects                        # [] on a fresh DB
curl -s "http://localhost:3742/api/runs?projectId=<id>"           # runs for a project
```

## Driving the app

Empty DB → no projects → no runs → nothing to look at except the empty dashboard shell. To see real behaviour (gates, pipelines, cost, etc.), the user needs to register a project and kick off a run via the UI. Mention this if you've launched a fresh state and they expected to see data.
