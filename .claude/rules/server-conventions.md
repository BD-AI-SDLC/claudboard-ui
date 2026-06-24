---
paths:
  - server/src/**
---

# Server Conventions

## Module Structure

The server is feature-module organised. Each business domain lives in its own directory under `server/src/`:

```
server/src/
├── registry/      ← project/repo CRUD + filesystem browser
├── gate/          ← spec+plan & clarify gate lifecycle
├── run/           ← feature run creation, streaming, lifecycle
├── prereq/        ← prerequisite runs (analyse, generate, workflow)
├── bootstrap/     ← Claude CLI install state
├── claudboard/    ← claudboard prereq runs
├── db.ts          ← singleton DB + migrations
├── ws-server.ts   ← WebSocket broadcast + room management
└── app.ts         ← Express app composition
```

Each module exposes a named `Router` from `routes.ts` plus domain logic files. New modules follow this same pattern — never put business logic directly in `routes.ts`.

## Router Pattern

```typescript
// server/src/<module>/routes.ts
import { Router } from 'express'
import { getDb } from '../db.js'
import type { MyType } from '@bosch-sdlc/protocol'

const router = Router()

router.get('/things', (_req, res) => {
  const db = getDb()
  const rows = db.prepare('SELECT * FROM things').all() as ThingRow[]
  res.json(rows.map(mapThingRow))
})

router.post('/things', (req, res) => {
  const body = req.body as MyCreateRequest
  if (!body.name) return void res.status(400).json({ error: 'name is required' })
  // ...
  res.status(201).json(result)
})

export { router as thingRouter }
```

Register the router in `app.ts`:

```typescript
import { thingRouter } from './thing/routes.js'
// ...
app.use('/api', thingRouter)
```

## Early-Return Idiom

**Always** use `return void res.status(N).json(...)` for early returns. This prevents accidental double-response and satisfies TypeScript's void-return check:

```typescript
// ✓ correct
if (!body.id) return void res.status(400).json({ error: 'id is required' })
const row = db.prepare('SELECT * FROM foo WHERE id = ?').get(body.id)
if (!row) return void res.status(404).json({ error: 'Not found' })
res.json(row)

// ✗ wrong — missing return, missing void
if (!body.id) { res.status(400).json({ error: 'id is required' }) }
```

## DB Access

Use `getDb()` — never construct `new Database()` directly:

```typescript
import { getDb } from '../db.js'

const db = getDb()
const row = db.prepare('SELECT * FROM runs WHERE id = ?').get(id) as RunRow | undefined
```

- SQL columns are `snake_case`; TypeScript is `camelCase`. Map via inline row-mapper functions (see `registry/routes.ts::mapProjectRow` as pattern).
- For additive migrations (new columns), use `PRAGMA table_info` + `ALTER TABLE ADD COLUMN` in `db.ts`. Never `DROP` or recreate tables.
- Always enable FK enforcement (`PRAGMA foreign_keys = ON`) — it is set in `getDb()`.

## ESM Import Extensions

All relative imports **must** use `.js` extensions, even when importing `.ts` source:

```typescript
// ✓ correct
import { broadcast } from '../ws-server.js'
import { getDb } from '../db.js'

// ✗ wrong — omitting extension breaks NodeNext module resolution
import { broadcast } from '../ws-server'
```

## WebSocket Broadcasting

Never call `ws.send()` directly. Always use `broadcast(runId, event)`:

```typescript
import { broadcast } from '../ws-server.js'
import type { WsEvent } from '@bosch-sdlc/protocol'

const event: WsEvent = {
  run_id: runId,
  t: new Date().toISOString(),
  kind: 'phase-start',
  payload: { num: 1, title: 'Setup' },
}
broadcast(runId, event)
```

`broadcast` persists the event to the run's event log (HTTP history replay) and fans out to all connected WebSocket clients.

## MCP Tool Registration

New MCP tools are added to `createBoschMcpServer` in `gate/mcp-server.ts`:

```typescript
import { SomeNewSchema } from '@bosch-sdlc/protocol'
import { tool } from '@anthropic-ai/claude-agent-sdk'

tool(
  'tool_name',
  'Description of what the tool does.',
  SomeNewSchema.shape,          // ← always pass .shape from protocol Zod schema
  async (input) => {
    emit('some-event', input)   // ← use the local emit() helper
    return ok()                  // ← use ok() for void tools
  },
)
```

- Always define the Zod schema in `protocol/src/mcp-schemas.ts` first, then import it here.
- Use `.shape` (not the full schema) to pass to `tool()`.

## Security: Path Resolution

Any user-supplied file path from a gate payload or request body **must** pass through `resolveUnderWorkspace` before I/O:

```typescript
import { resolveUnderWorkspace, WorkspaceBoundaryError } from './resolve-under-workspace.js'

try {
  const absPath = await resolveUnderWorkspace(workspaceRoot, userSuppliedPath)
  // safe to use absPath
} catch (err) {
  if (err instanceof WorkspaceBoundaryError) {
    return void res.status(400).json({ error: err.message })
  }
  throw err
}
```

This uses `realpath` for symlink resolution and asserts the resolved path is under `workspaceRoot`. Never skip this check.

## Testing

- Tests live in `server/src/<module>/__tests__/` adjacent to the module.
- Use Jest + `ts-jest` + supertest for integration tests:

```typescript
import request from 'supertest'
import { createApp } from '../../app.js'

describe('GET /api/things', () => {
  it('returns 200 with a list', async () => {
    const app = createApp()
    const res = await request(app).get('/api/things')
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
  })
})
```

- Bootstrap guard can be bypassed in tests via `__setStateForTest('ready')` from `bootstrap/guard.ts`.
- Run with: `node --experimental-vm-modules ../node_modules/.bin/jest` (required for ESM).

## Logging

Use `console.info/warn/error` for now — a structured logger (`pino`) is a planned improvement. Do not add new `console.log` calls — use `console.info` for informational messages.
