import { Router } from 'express'
import { z } from 'zod'
import { join } from 'node:path'
import type {
  GateFileLiveResponse,
  GateResolution,
  SpecPlanGateSnapshot,
} from '@bosch-sdlc/protocol'
import { getDb } from '../db.js'
import { resolveGateDeferred } from './deferred.js'
import { readGateFile } from './mcp-server.js'
import { resolveUnderWorkspace, WorkspaceBoundaryError } from './resolve-under-workspace.js'

const router = Router()

const ApprovalBodySchema = z.object({
  result: z.enum(['approved', 'rejected']),
  changes: z.string().optional(),
})

const ClarifyAnswersBodySchema = z.object({
  answers: z.array(
    z.union([
      z.string(),
      z.object({ selected: z.number().optional(), note: z.string().optional() }),
    ])
  ),
})

const ClarifySkipBodySchema = z.object({
  skipped: z.literal(true),
})

const ResolveBodySchema = z.union([
  ApprovalBodySchema,
  ClarifyAnswersBodySchema,
  ClarifySkipBodySchema,
])

router.post('/runs/:runId/gate/:gateId/resolve', (req, res) => {
  const { runId, gateId } = req.params as { runId: string; gateId: string }

  const parsed = ResolveBodySchema.safeParse(req.body)
  if (!parsed.success) {
    return void res.status(400).json({
      error: 'Body must be one of: { result: "approved"|"rejected", changes? } | { answers: string[] } | { skipped: true }',
    })
  }

  const db = getDb()
  const gate = db.prepare('SELECT * FROM gates WHERE id = ? AND run_id = ?').get(gateId, runId)
  if (!gate) return void res.status(404).json({ error: 'Gate not found' })

  const resolved = resolveGateDeferred(runId, gateId, parsed.data as GateResolution)
  if (!resolved) {
    return void res
      .status(409)
      .json({ error: 'Gate is not awaiting resolution (already resolved or run is dead)' })
  }

  res.json({ resolved: true })
})

// GET /gates/:gateId/files/:fileIndex
//   :fileIndex is an integer 0..specFiles.length-1 → addresses spec files
//   :fileIndex === 'plan'                          → addresses the plan
router.get('/gates/:gateId/files/:fileIndex', async (req, res) => {
  const { gateId, fileIndex } = req.params as { gateId: string; fileIndex: string }
  const db = getDb()

  const gate = db
    .prepare('SELECT id, kind, payload, snapshot FROM gates WHERE id = ?')
    .get(gateId) as
    | { id: string; kind: string; payload: string; snapshot: string | null }
    | undefined

  if (!gate || gate.kind !== 'spec+plan') {
    return void res.status(404).json({ error: 'Gate not found' })
  }
  if (!gate.snapshot) {
    return void res.status(404).json({ error: 'Gate has no snapshot' })
  }

  let snapshot: SpecPlanGateSnapshot
  let manifest: { workspaceRoot: string; specDir: string; specFiles: string[]; planPath: string }
  try {
    snapshot = JSON.parse(gate.snapshot) as SpecPlanGateSnapshot
    manifest = JSON.parse(gate.payload) as typeof manifest
  } catch {
    return void res.status(500).json({ error: 'Corrupt gate snapshot' })
  }

  let snapshotFile: { path: string; content: string; mtime: string } | null = null
  let relPath: string | null = null
  if (fileIndex === 'plan') {
    if (!snapshot.plan) {
      return void res.status(404).json({ error: 'Gate has no plan' })
    }
    snapshotFile = snapshot.plan
    relPath = manifest.planPath
  } else {
    const idx = Number.parseInt(fileIndex, 10)
    if (
      !Number.isInteger(idx) ||
      idx < 0 ||
      idx >= snapshot.specFiles.length ||
      String(idx) !== fileIndex
    ) {
      return void res.status(404).json({ error: 'fileIndex out of range' })
    }
    snapshotFile = snapshot.specFiles[idx]!
    const relSpec = manifest.specFiles[idx]
    if (!relSpec) {
      return void res.status(404).json({ error: 'fileIndex out of range' })
    }
    relPath = join(manifest.specDir, relSpec)
  }

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

  let live: { path: string; content: string; size: number; mtime: string }
  try {
    live = await readGateFile(absPath, relPath)
  } catch (err) {
    return void res
      .status(500)
      .json({ error: `Failed to read file: ${(err as Error).message}` })
  }

  const drifted = live.content !== snapshotFile.content

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

export { router as gateRouter }
