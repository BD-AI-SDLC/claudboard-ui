# Example: Gate File Route from `server/src/gate/routes.ts`

Source: `server/src/gate/routes.ts`

This shows how the gate module exposes a `GET` endpoint with complex parameter handling,
path traversal security, and the project's consistent error-response style.

```typescript
// Pattern: multiple early returns with `return void res.status(N).json(...)`
router.get('/gates/:gateId/files/:fileIndex', async (req, res) => {
  const { gateId, fileIndex } = req.params as { gateId: string; fileIndex: string }
  const db = getDb()

  // 1. Fetch the row — type the result inline (not as any[])
  const gate = db
    .prepare('SELECT id, kind, payload, snapshot FROM gates WHERE id = ?')
    .get(gateId) as
    | { id: string; kind: string; payload: string; snapshot: string | null }
    | undefined

  // 2. Not-found guard — early return idiom
  if (!gate || gate.kind !== 'spec+plan') {
    return void res.status(404).json({ error: 'Gate not found' })
  }
  if (!gate.snapshot) {
    return void res.status(404).json({ error: 'Gate has no snapshot' })
  }

  // 3. JSON parse with try/catch — never assume DB content is valid JSON
  let snapshot: SpecPlanGateSnapshot
  let manifest: { workspaceRoot: string; specDir: string; specFiles: string[]; planPath: string }
  try {
    snapshot = JSON.parse(gate.snapshot) as SpecPlanGateSnapshot
    manifest = JSON.parse(gate.payload) as typeof manifest
  } catch {
    return void res.status(500).json({ error: 'Corrupt gate snapshot' })
  }

  // 4. resolveUnderWorkspace — mandatory for any user-derived path
  let absPath: string
  try {
    absPath = await resolveUnderWorkspace(manifest.workspaceRoot, relPath)
  } catch (err) {
    if (err instanceof WorkspaceBoundaryError) {
      return void res.status(400).json({ error: err.message })
    }
    return void res
      .status(500)
      .json({ error: `Failed to resolve path: ${(err as Error).message}` })
  }

  // 5. Happy path — typed response using protocol interface
  const response: GateFileLiveResponse = {
    path: live.path,
    content: live.content,
    size: live.size,
    mtime: live.mtime,
    drifted,
    snapshotMtime: snapshotFile.mtime,
  }
  res.json(response)
})
```

**Key points:**
- Every `return void res.status(N).json(...)` prevents fall-through to the happy path
- SQL query result typed with a local interface (not `as any[]`)
- `resolveUnderWorkspace` called before any `readFile` — path traversal protection
- Protocol type (`GateFileLiveResponse`) used for the final response shape — not a local ad-hoc object
- `req.params` destructured with a cast to `{ gateId: string; fileIndex: string }` (required by TypeScript strict mode since Express types `params` as `Record<string, string>`)
