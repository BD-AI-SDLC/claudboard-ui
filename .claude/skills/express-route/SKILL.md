---
name: express-route
description: >
  Add a new REST API endpoint to the bosch-sdlc server. Covers route handler,
  request/response types in protocol, DB queries, and supertest tests.
  Use this skill whenever the user asks to add an endpoint, add an API route,
  expose a new REST resource, add a GET/POST/PUT/DELETE handler, or implement
  a new server API. Also triggers on "I need to store X", "add endpoint for X",
  "make X available via the API", or "hook up X to the frontend".
---

# Add Express Route

## Architecture

```
server/src/
└── <module>/
    ├── routes.ts          ← Router with the new handler (add here)
    ├── <logic>.ts         ← Domain logic extracted from routes.ts
    └── __tests__/
        └── <module>.test.ts  ← supertest integration test

protocol/src/
├── types.ts               ← Add request/response interfaces here (if new shapes)
└── index.ts               ← Re-export new types

server/src/app.ts          ← Register router here (only for brand-new modules)
```

## Step-by-step

### 1. Identify or create the module

Check `server/src/` for an existing module that owns the domain (e.g. a new `runs/` endpoint goes in `run/routes.ts`). If the domain is genuinely new, create `server/src/<module>/routes.ts`.

### 2. Add protocol types (if needed)

If the request body or response has a new shape, add interfaces to `protocol/src/types.ts` and re-export from `protocol/src/index.ts`:

```typescript
// protocol/src/types.ts
export interface CreateThingRequest {
  name: string
  repoId: string
}

export interface Thing {
  id: string
  name: string
  repoId: string
  createdAt: string
}
```

Build protocol after changes: `npm run build -w protocol`

### 3. Write the route handler

Add the handler to the module's `routes.ts`. Follow the established pattern:

```typescript
import { Router } from 'express'
import { randomUUID } from 'node:crypto'
import { getDb } from '../db.js'
import type { CreateThingRequest, Thing } from '@bosch-sdlc/protocol'

const router = Router()  // if not already defined in this file

// GET — list or fetch
router.get('/things', (_req, res) => {
  const db = getDb()
  const rows = db.prepare('SELECT * FROM things ORDER BY created_at DESC').all() as ThingRow[]
  res.json(rows.map(mapThingRow))
})

// POST — create
router.post('/things', (req, res) => {
  const body = req.body as CreateThingRequest
  if (!body.name || !body.repoId) {
    return void res.status(400).json({ error: 'name and repoId are required' })
  }
  const db = getDb()
  const id = randomUUID()
  db.prepare('INSERT INTO things (id, name, repo_id, created_at) VALUES (?, ?, ?, datetime(\'now\'))').run(id, body.name, body.repoId)
  const row = db.prepare('SELECT * FROM things WHERE id = ?').get(id) as ThingRow
  res.status(201).json(mapThingRow(row))
})

// DELETE — soft or hard delete
router.delete('/things/:id', (req, res) => {
  const db = getDb()
  const result = db.prepare('DELETE FROM things WHERE id = ?').run(req.params['id'])
  if (result.changes === 0) return void res.status(404).json({ error: 'Not found' })
  res.status(204).send()
})

export { router as thingRouter }
```

Key conventions:
- `return void res.status(N).json(...)` for every early return — **no exceptions**
- `req.params['key']` with bracket notation (TypeScript `noUncheckedIndexedAccess`)
- `snake_case` SQL columns, `camelCase` TypeScript — map via a `mapThingRow` function
- Type SQL query results with an inline interface (`ThingRow`), not `as any`

### 4. Register a brand-new module in app.ts

Only needed when you created a **new** module directory (not adding to an existing router):

```typescript
// server/src/app.ts
import { thingRouter } from './thing/routes.js'
// ...
app.use('/api', thingRouter)  // add in alphabetical order with other routers
```

### 5. Add DB migration (if new table or column)

New tables go in `db.ts` inside the `CREATE TABLE IF NOT EXISTS` block. New columns on existing tables use the additive migration pattern at the bottom of `runMigrations()`:

```typescript
// db.ts — inside runMigrations()
const thingCols = db.prepare("PRAGMA table_info('things')").all() as Array<{ name: string }>
if (!thingCols.some((c) => c.name === 'new_column')) {
  db.exec('ALTER TABLE things ADD COLUMN new_column TEXT')
}
```

### 6. Write a supertest test

```typescript
// server/src/thing/__tests__/thing.test.ts
import request from 'supertest'
import { createApp } from '../../app.js'

describe('Thing API', () => {
  let app: ReturnType<typeof createApp>
  beforeEach(() => { app = createApp() })

  it('GET /api/things returns 200 with array', async () => {
    const res = await request(app).get('/api/things')
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
  })

  it('POST /api/things creates and returns 201', async () => {
    const res = await request(app)
      .post('/api/things')
      .send({ name: 'test', repoId: 'repo-1' })
    expect(res.status).toBe(201)
    expect(res.body.name).toBe('test')
  })

  it('POST /api/things returns 400 when name missing', async () => {
    const res = await request(app).post('/api/things').send({})
    expect(res.status).toBe(400)
  })
})
```

Run tests: `node --experimental-vm-modules ../node_modules/.bin/jest --testPathPattern=thing`

## Common Patterns

### Guarding with `bootstrapGuard`

For routes that should only work once Claude CLI is installed, add the middleware:

```typescript
import { bootstrapGuard } from '../bootstrap/guard.js'
router.post('/things', bootstrapGuard, async (req, res) => { ... })
```

In tests, call `__setStateForTest('ready')` from `bootstrap/guard.ts` in a `beforeEach`.

### Async handlers

Express 4 does not catch promise rejections from async handlers automatically. For routes that `await`, either use a try/catch or append `.catch((err) => next(err))`:

```typescript
router.get('/things/:id', async (req, res, next) => {
  try {
    const data = await fetchSomething(req.params['id']!)
    res.json(data)
  } catch (err) {
    next(err)
  }
})
```

### Path validation for file I/O

Any path that comes from user input or a gate payload must go through `resolveUnderWorkspace`:

```typescript
import { resolveUnderWorkspace, WorkspaceBoundaryError } from '../gate/resolve-under-workspace.js'

const absPath = await resolveUnderWorkspace(workspaceRoot, userPath).catch((err) => {
  if (err instanceof WorkspaceBoundaryError) return void res.status(400).json({ error: err.message })
  throw err
})
```

## References

See `references/example-route.md` for an annotated real-codebase example.
